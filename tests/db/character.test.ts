import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createDb, asUser } from './load-schema'

// Migration 000900: tủ đồ, shop vật phẩm nhân vật 3D
const U = '00000000-0000-0000-0000-0000000000d1'
const F = '00000000-0000-0000-0000-0000000000d2'

async function seed(db: PGlite) {
  await db.exec(`
    insert into auth.users (id, email) values ('${U}', 'u@x.vn'), ('${F}', 'f@x.vn');
    insert into public.profiles (id, display_name, xu, xp, level, created_at) values
      ('${U}', 'Nam', 0, 0, 1, now()), ('${F}', 'Nữ', 0, 0, 1, now());
    insert into public.user_avatar (user_id, gender) values ('${F}', 'female');
  `)
}

type State = { gender: string; equipped: Record<string, string>; level: number; balance: number
  items: { code: string; slot: string; owned: boolean; price_xu: number; unlock_level: number }[] }
const rpc = async <T = Record<string, unknown>>(db: PGlite, uid: string, sql: string, params: unknown[] = []) =>
  (await asUser<T>(db, uid, '/rpc', sql, params)).rows
const fails = async (db: PGlite, uid: string, sql: string, params: unknown[] = []) => {
  try { await asUser(db, uid, '/rpc', sql, params) } catch (e) { return (e as Error).message }
  return 'OK'
}
const state = async (db: PGlite, uid: string) => (await rpc<{ s: State }>(db, uid, `select public.character_state() as s`))[0].s
const give = (db: PGlite, uid: string, amount: number, key: string) =>
  db.query(`select private.ledger_post('TEST_SEED', $3, 'seed', null,
    jsonb_build_array(jsonb_build_object('account_id', $1::uuid, 'coin_kind', 'BONUS', 'amount', $2::numeric),
                      jsonb_build_object('account_id', private.system_account(), 'coin_kind', 'BONUS', 'amount', -$2::numeric)))`, [uid, amount, key])

describe('Nhân vật: tủ đồ & shop (000900)', () => {
  let db: PGlite
  beforeAll(async () => { db = await createDb({ withMigrations: true, runMigrationsTwice: true, seed }) }, 240_000)

  it('lần đầu mở: có bộ đồ mặc định theo giới tính, sở hữu đồ mặc định, chưa sở hữu đồ bán', async () => {
    const m = await state(db, U)
    expect(m).toMatchObject({ gender: 'male', level: 1, equipped: { hair: 'hair_short', top: 'top_tee_blue', bottom: 'bottom_shorts_black', socks: 'socks_crew_white', shoes: 'shoes_runner_blue' } })
    expect(m.items.length).toBeGreaterThanOrEqual(40)
    expect(m.items.find((i) => i.code === 'top_crop_coral')?.owned).toBe(true)          // đồ mặc định ai cũng có
    expect(m.items.find((i) => i.code === 'hat_cap_black')?.owned).toBe(false)
    expect(m.items.find((i) => i.code === 'top_singlet_level2')?.owned).toBe(false)     // chưa đủ cấp
    const f = await state(db, F)
    expect(f.equipped).toMatchObject({ hair: 'hair_ponytail', top: 'top_crop_coral', shoes: 'shoes_runner_coral' })
  })

  it('mua bằng Xu qua sổ cái; không đủ Xu, chưa đủ cấp, đã có thì từ chối; gửi lại không trừ 2 lần', async () => {
    expect(await fails(db, U, `select public.buy_avatar_item('hat_cap_black', 'buy-key-0001')`)).toContain('INSUFFICIENT_BALANCE')
    await give(db, U, 100, 'seed-u-100')
    const r = (await rpc<{ r: { balance: number } }>(db, U, `select public.buy_avatar_item('hat_cap_black', 'buy-key-0002') as r`))[0].r
    expect(Number(r.balance)).toBe(70)
    await rpc(db, U, `select public.buy_avatar_item('hat_cap_black', 'buy-key-0002')`)
    expect(Number((await db.query<{ b: string }>(`select private.balance($1) as b`, [U])).rows[0].b)).toBe(70)
    expect(await fails(db, U, `select public.buy_avatar_item('hat_cap_black', 'buy-key-0003')`)).toContain('ALREADY_OWNED')
    expect(await fails(db, U, `select public.buy_avatar_item('top_tee_gold', 'buy-key-0004')`)).toContain('LEVEL_TOO_LOW')
    expect(await fails(db, U, `select public.buy_avatar_item('khong_co', 'buy-key-0005')`)).toContain('ITEM_NOT_FOUND')
    expect((await db.query(`select type from public.ledger_transactions where idempotency_key = 'shop:buy-key-0002'`)).rows).toEqual([{ type: 'SHOP_ITEM' }])
  })

  it('lưu bộ đồ + ngoại hình: chỉ đồ đã sở hữu, đúng ô; bỏ mũ được, bỏ áo không được', async () => {
    const look = (await rpc<{ l: State }>(db, U, `select public.save_character($1::jsonb, $2::jsonb) as l`,
      [JSON.stringify({ skin_tone: '#c88a5c', hair_color: '#8b4513' }), JSON.stringify({ hat: 'hat_cap_black', hair: 'hair_spiky' })]))[0].l
    expect(look).toMatchObject({ skin_tone: '#c88a5c', hair_color: '#8b4513', equipped: { hat: 'hat_cap_black', hair: 'hair_spiky', top: 'top_tee_blue' } })
    expect(await fails(db, U, `select public.save_character('{}'::jsonb, '{"glasses": "glasses_shield_black"}'::jsonb)`)).toContain('ITEM_NOT_OWNED')
    expect(await fails(db, U, `select public.save_character('{}'::jsonb, '{"top": "bottom_shorts_black"}'::jsonb)`)).toContain('ITEM_NOT_OWNED')
    expect(await fails(db, U, `select public.save_character('{}'::jsonb, '{"top": null}'::jsonb)`)).toContain('SLOT_REQUIRED')
    expect(await fails(db, U, `select public.save_character('{}'::jsonb, '{"wings": "x"}'::jsonb)`)).toContain('INVALID_SLOT')
    expect(await fails(db, U, `select public.save_character('{"skin_tone": "red; drop"}'::jsonb, null)`)).toContain('INVALID_LOOK')
    const off = (await rpc<{ l: State }>(db, U, `select public.save_character('{}'::jsonb, '{"hat": null}'::jsonb) as l`))[0].l
    expect(off.equipped.hat).toBeUndefined()
  })

  it('lên cấp → vật phẩm thưởng cấp tự vào tủ đồ', async () => {
    await db.query(`update public.profiles set xp = 5200, level = 3 where id = $1`, [U])
    const m = await state(db, U)
    for (const code of ['top_singlet_level2', 'watch_sport_level2', 'bottom_split_level3', 'accessory_medal_level3'])
      expect(m.items.find((i) => i.code === code)?.owned).toBe(true)
    expect(m.items.find((i) => i.code === 'top_jacket_level4')?.owned).toBe(false)
  })

  it('người khác xem được ngoại hình, không ghi thẳng vào bảng', async () => {
    const other = (await rpc<{ c: State }>(db, F, `select public.get_character($1) as c`, [U]))[0].c
    expect(other.equipped).toMatchObject({ hair: 'hair_spiky' })
    expect(await fails(db, U, `insert into public.user_inventory (user_id, item_id) select $1, id from public.avatar_items where code = 'effect_aura_lime'`, [U]))
      .toMatch(/permission denied/)
    expect(await fails(db, U, `update public.avatar_items set price_xu = 0`)).toMatch(/permission denied/)
  })
})
