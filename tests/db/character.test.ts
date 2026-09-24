import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createDb, asUser } from './load-schema'

// Migration 000900 (tủ đồ, shop) + 001000 (nhân vật 2D: bộ màu áo/quần/tất/giày, hoàn Xu đồ 3D ngừng bán)
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

type Item = { code: string; slot: string; owned: boolean; price_xu: number; unlock_level: number; render_kind: string; color: string | null }
type State = { gender: string; equipped: Record<string, string>; level: number; balance: number; items: Item[] }
const rpc = async <T = Record<string, unknown>>(db: PGlite, uid: string, sql: string, params: unknown[] = []) =>
  (await asUser<T>(db, uid, '/rpc', sql, params)).rows
const fails = async (db: PGlite, uid: string, sql: string, params: unknown[] = []) => {
  try { await asUser(db, uid, '/rpc', sql, params) } catch (e) { return (e as Error).message }
  return 'OK'
}
const state = async (db: PGlite, uid: string) => (await rpc<{ s: State }>(db, uid, `select public.character_state() as s`))[0].s
const balance = async (db: PGlite, uid: string, kind: string | null = null) =>
  Number((await db.query<{ b: string }>(`select private.balance($1, $2) as b`, [uid, kind])).rows[0].b)
const give = (db: PGlite, uid: string, amount: number, key: string, kind = 'BONUS') =>
  db.query(`select private.ledger_post('TEST_SEED', $3, 'seed', null,
    jsonb_build_array(jsonb_build_object('account_id', $1::uuid, 'coin_kind', $4::text, 'amount', $2::numeric),
                      jsonb_build_object('account_id', private.system_account(), 'coin_kind', $4::text, 'amount', -$2::numeric)))`, [uid, amount, key, kind])

describe('Nhân vật 2D: tủ đồ & shop (000900 + 001000)', () => {
  let db: PGlite
  beforeAll(async () => { db = await createDb({ withMigrations: true, runMigrationsTwice: true, seed }) }, 240_000)

  it('lần đầu mở: mặc bản nguyên bản của ảnh, chỉ còn đồ đổi màu áo/quần/tất/giày', async () => {
    const m = await state(db, U)
    expect(m).toMatchObject({ gender: 'male', level: 1,
      equipped: { top: 'top_original', bottom: 'bottom_original', socks: 'socks_original', shoes: 'shoes_original' } })
    expect(Object.keys(m.equipped).sort()).toEqual(['bottom', 'shoes', 'socks', 'top'])
    expect(new Set(m.items.filter((i) => i.render_kind === 'TINT').map((i) => i.slot))).toEqual(new Set(['top', 'bottom', 'socks', 'shoes']))
    // bộ đồ đội đầu (001300): 16 món lớp ảnh ở ô Mũ, có bản Nam + Nữ
    const hats = m.items.filter((i) => i.render_kind === 'LAYER')
    expect(hats).toHaveLength(16)
    expect(hats.every((i) => i.slot === 'hat')).toBe(true)
    expect(m.items.find((i) => i.code === 'hat_cap_legend')).toMatchObject({ unlock_level: 5, price_xu: 0, owned: false })
    expect(m.items.find((i) => i.code === 'top_original')).toMatchObject({ owned: true, color: null })
    expect(m.items.find((i) => i.code === 'top_crop_coral')?.owned).toBe(true)          // bộ màu miễn phí ai cũng có
    expect(m.items.find((i) => i.code === 'top_red')?.owned).toBe(false)
    expect(m.items.find((i) => i.code === 'hat_cap_black')).toBeUndefined()             // đồ 3D ngừng bán
    expect(m.items.find((i) => i.code === 'top_singlet_level2')?.owned).toBe(false)     // chưa đủ cấp
    expect((await state(db, F)).gender).toBe('female')
  })

  it('mua bằng Xu qua sổ cái; không đủ Xu, chưa đủ cấp, đã có, ngừng bán thì từ chối; gửi lại không trừ 2 lần', async () => {
    expect(await fails(db, U, `select public.buy_avatar_item('top_red', 'buy-key-0001')`)).toContain('INSUFFICIENT_BALANCE')
    await give(db, U, 100, 'seed-u-100')
    const r = (await rpc<{ r: { balance: number } }>(db, U, `select public.buy_avatar_item('top_red', 'buy-key-0002') as r`))[0].r
    expect(Number(r.balance)).toBe(70)
    await rpc(db, U, `select public.buy_avatar_item('top_red', 'buy-key-0002')`)
    expect(await balance(db, U)).toBe(70)
    expect(await fails(db, U, `select public.buy_avatar_item('top_red', 'buy-key-0003')`)).toContain('ALREADY_OWNED')
    expect(await fails(db, U, `select public.buy_avatar_item('top_tee_gold', 'buy-key-0004')`)).toContain('LEVEL_TOO_LOW')
    expect(await fails(db, U, `select public.buy_avatar_item('hat_cap_black', 'buy-key-0005')`)).toContain('ITEM_NOT_FOUND')
    expect((await db.query(`select type from public.ledger_transactions where idempotency_key = 'shop:buy-key-0002'`)).rows).toEqual([{ type: 'SHOP_ITEM' }])
  })

  it('lưu dáng người + bộ đồ: chỉ đồ đã sở hữu, đúng ô; ô áo/quần/tất/giày không được bỏ trống', async () => {
    const look = (await rpc<{ l: State }>(db, U, `select public.save_character($1::jsonb, $2::jsonb) as l`,
      [JSON.stringify({ gender: 'female' }), JSON.stringify({ top: 'top_red', socks: 'socks_crew_white' })]))[0].l
    expect(look).toMatchObject({ gender: 'female', equipped: { top: 'top_red', socks: 'socks_crew_white', shoes: 'shoes_original' } })
    expect(await fails(db, U, `select public.save_character('{}'::jsonb, '{"top": "top_sky"}'::jsonb)`)).toContain('ITEM_NOT_OWNED')
    expect(await fails(db, U, `select public.save_character('{}'::jsonb, '{"top": "bottom_original"}'::jsonb)`)).toContain('ITEM_NOT_OWNED')
    for (const slot of ['top', 'bottom', 'socks', 'shoes'])
      expect(await fails(db, U, `select public.save_character('{}'::jsonb, $1::jsonb)`, [JSON.stringify({ [slot]: null })])).toContain('SLOT_REQUIRED')
    expect(await fails(db, U, `select public.save_character('{}'::jsonb, '{"wings": "x"}'::jsonb)`)).toContain('INVALID_SLOT')
    expect(await fails(db, U, `select public.save_character('{"gender": "robot"}'::jsonb, null)`)).toContain('INVALID_LOOK')
    expect((await rpc<{ l: State }>(db, U, `select public.save_character('{}'::jsonb, '{"hat": null}'::jsonb) as l`))[0].l.equipped.hat).toBeUndefined()
  })

  it('lên cấp → bộ màu thưởng cấp tự vào tủ đồ', async () => {
    await db.query(`update public.profiles set xp = 5200, level = 3 where id = $1`, [U])
    const m = await state(db, U)
    for (const code of ['top_singlet_level2', 'socks_level2', 'bottom_split_level3', 'shoes_level3'])
      expect(m.items.find((i) => i.code === code)?.owned).toBe(true)
    expect(m.items.find((i) => i.code === 'top_jacket_level4')?.owned).toBe(false)
  })

  it('người khác xem được dáng + màu đang mặc, không ghi thẳng vào bảng', async () => {
    const other = (await rpc<{ c: State }>(db, F, `select public.get_character($1) as c`, [U]))[0].c
    expect(other.equipped).toMatchObject({ top: 'top_red' })
    expect(other.items.find((i) => i.code === 'top_red')).toMatchObject({ color: '#e11d48', slot: 'top' })
    expect(await fails(db, U, `insert into public.user_inventory (user_id, item_id) select $1, id from public.avatar_items where code = 'top_sky'`, [U]))
      .toMatch(/permission denied/)
    expect(await fails(db, U, `update public.avatar_items set price_xu = 0`)).toMatch(/permission denied/)
  })
})

describe('Chuyển 3D → 2D (001000): hoàn Xu đồ ngừng bán', () => {
  let db: PGlite
  beforeAll(async () => {
    db = await createDb({ withMigrations: true, until: '20261001000900', seed })
    // Trước 001000: U mua mũ 30 Xu (20 Xu thưởng + 10 Xu nạp) và đang đội, mua áo đen 20 Xu (món còn bán)
    await give(db, U, 20, 'seed-bonus-20')
    await give(db, U, 30, 'seed-paid-30', 'PAID')
    await rpc(db, U, `select public.buy_avatar_item('hat_cap_black', 'old-buy-hat-1')`)
    await rpc(db, U, `select public.buy_avatar_item('top_tee_black', 'old-buy-top-1')`)
    await rpc(db, U, `select public.save_character('{}'::jsonb, '{"hat": "hat_cap_black", "top": "top_tee_black"}'::jsonb)`)
    await rpc(db, F, `select public.character_state()`)
    expect(await balance(db, U)).toBe(0)
    const sql = fs.readFileSync(path.resolve(__dirname, '../../supabase/migrations/20261001001000_character_2d.sql'), 'utf8').replace(/notify pgrst[^;]*;/gi, '')
    await db.exec(sql)
    await db.exec(sql)                         // chạy lại không hoàn 2 lần
  }, 240_000)

  it('hoàn đúng loại Xu đã trả cho món ngừng bán, giữ món còn bán, gỡ món ngừng bán khỏi người', async () => {
    expect(await balance(db, U, 'BONUS')).toBe(20)
    expect(await balance(db, U, 'PAID')).toBe(10)
    const n = await db.query<{ c: number }>(`select count(*)::int as c from public.ledger_transactions where type = 'SHOP_REFUND' and created_by = $1`, [U])
    expect(n.rows[0].c).toBe(1)
    expect((await db.query(`select title, link from public.notifications where user_id = $1 and kind = 'ADMIN_XU'`, [U])).rows)
      .toEqual([{ title: 'Hoàn 30 Xu', link: '/wallet' }])
    const m = await state(db, U)
    expect(m.equipped).toEqual({ top: 'top_tee_black', bottom: 'bottom_shorts_black', socks: 'socks_crew_white', shoes: 'shoes_runner_blue' })
    expect(m.items.find((i) => i.code === 'top_tee_black')?.owned).toBe(true)
    const f = await state(db, F)
    expect(f.equipped).toMatchObject({ top: 'top_crop_coral', shoes: 'shoes_runner_coral' })
    expect(f.equipped.hair).toBeUndefined()
  })
})
