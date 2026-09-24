import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createDb, asUser } from './load-schema'

// Migration 003900: quà tặng ảo đốt Xu (không chuyển Xu P2P), tường quà, quà VIP, trần ngày
const [A, B, ADMIN] = ['00000000-0000-0000-0000-0000000039a1', '00000000-0000-0000-0000-0000000039a2', '00000000-0000-0000-0000-0000000039a3']

async function seed(db: PGlite) {
  await db.exec(`
    insert into auth.users (id, email) values ('${A}', 'ga@x.vn'), ('${B}', 'gb@x.vn'), ('${ADMIN}', 'gadm@x.vn');
    insert into public.profiles (id, display_name, xu, xp, level, created_at) values ('${A}', 'An', 0, 0, 1, now()), ('${B}', 'Bình', 0, 0, 1, now()), ('${ADMIN}', 'Admin', 0, 0, 1, now());
  `)
}
type Row = Record<string, any>
const rpc = async <T = Row>(db: PGlite, uid: string, sql: string, params: unknown[] = []) => (await asUser<{ r: T }>(db, uid, '/rpc', sql, params)).rows[0].r
const fails = async (p: Promise<unknown>) => { try { await p } catch (e) { return (e as Error).message } return 'OK' }
const xu = async (db: PGlite, acc: string) => Number((await db.query<{ b: string }>(`select private.balance($1) as b`, [acc])).rows[0].b)
const gift = (db: PGlite, from: string, to: string, code: string, qty: number, key: string) =>
  rpc<Row>(db, from, `select public.send_gift($1, $2, $3, 'Cố lên!', null, null, $4) as r`, [to, code, qty, key])

describe('Quà tặng (003900)', () => {
  let db: PGlite
  beforeAll(async () => {
    db = await createDb({ withMigrations: true, runMigrationsTwice: true, seed })
    await db.query(`update public.profiles set role = 'SYSTEM_ADMIN' where id = $1`, [ADMIN])
    await db.query(`select private.ledger_post('TEST_SEED', 'gift-seed-a', 'seed', null,
      jsonb_build_array(jsonb_build_object('account_id', $1::uuid, 'coin_kind', 'BONUS', 'amount', 500),
                        jsonb_build_object('account_id', private.system_account(), 'coin_kind', 'BONUS', 'amount', -500)))`, [A])
  }, 300_000)

  it('kho quà có 4 tầng, không có bia; quà theo mùa chỉ hiện đúng mùa; quà VIP bị khóa với người thường', async () => {
    const cat = await rpc<Row>(db, A, `select public.gift_catalog() as r`)
    const codes = cat.gifts.map((g: Row) => g.code)
    expect(codes).toEqual(expect.arrayContaining(['clap', 'water', 'coffee', 'rose', 'energy_drink', 'trophy', 'rocket', 'crown']))
    expect(codes.some((c: string) => c.includes('beer'))).toBe(false)
    expect(new Set(cat.gifts.map((g: Row) => g.tier))).toEqual(new Set(['CHEER', 'BOOST', 'HYPE', 'LEGEND']))
    expect(cat.gifts.find((g: Row) => g.code === 'vip_star').locked).toBe(true)
    const inSeason = (await db.query<{ t: boolean; n: boolean }>(`select private.gift_in_season(g, '2027-02-01') as t, private.gift_in_season(g, '2027-06-01') as n
                                                                  from public.gift_catalog g where g.code = 'lucky_money'`)).rows[0]
    expect(inSeason).toEqual({ t: true, n: false })
  })

  it('tặng quà: Xu người tặng bị đốt, người nhận KHÔNG nhận Xu; tường quà + điểm tỏa sáng + thông báo; gửi lại không trừ 2 lần', async () => {
    const r = await gift(db, A, B, 'coffee', 5, 'gift-key-0001')
    expect(r).toMatchObject({ total_xu: 50, qty: 5, emoji: '☕' })
    await gift(db, A, B, 'coffee', 5, 'gift-key-0001')
    expect(await xu(db, A)).toBe(450)
    expect(await xu(db, B)).toBe(0)
    await gift(db, A, B, 'trophy', 1, 'gift-key-0002')
    const wall = await rpc<Row>(db, A, `select public.gift_wall($1) as r`, [B])
    expect(wall).toMatchObject({ shine: 150, count: 6 })
    expect(wall.gifts.map((g: Row) => [g.code, g.count])).toEqual([['trophy', 1], ['coffee', 5]])
    expect(wall.top_supporters[0]).toMatchObject({ user_id: A, shine: 150 })
    expect((await db.query(`select 1 from public.notifications where user_id = $1 and kind = 'GIFT'`, [B])).rows).toHaveLength(2)
    expect((await db.query(`select 1 from public.game_events where user_id = $1 and kind = 'GIFT_IN'`, [B])).rows).toHaveLength(2)
  })

  it('chặn: tự tặng mình, số lượng lạ, thiếu Xu, quà VIP, cổ vũ Xu kiểu cũ, vượt trần ngày', async () => {
    expect(await fails(gift(db, A, A, 'clap', 1, 'gift-key-0003'))).toContain('CANNOT_GIFT_SELF')
    expect(await fails(gift(db, A, B, 'clap', 3, 'gift-key-0004'))).toContain('INVALID_QTY')
    expect(await fails(gift(db, A, B, 'crown', 1, 'gift-key-0005'))).toContain('INSUFFICIENT_BALANCE')
    expect(await fails(gift(db, A, B, 'vip_star', 1, 'gift-key-0006'))).toContain('VIP_REQUIRED')
    expect(await fails(rpc(db, A, `select public.send_cheer($1, 5, null, null, null, 'cheer-old-01')`, [B]))).toContain('CHEER_REPLACED_BY_GIFTS')
    await rpc(db, ADMIN, `select public.admin_publish_config('economy_global_config', $1::jsonb)`, [JSON.stringify({ giftDailyCapXu: 200 })])
    expect(await fails(gift(db, A, B, 'trophy', 1, 'gift-key-0007'))).toContain('GIFT_DAILY_LIMIT')
  })

  it('admin sửa / thêm quà; người thường không được', async () => {
    const body = JSON.stringify({ code: 'coffee', name: 'Cà phê sữa đá', emoji: '🧋', price_xu: 12, tier: 'CHEER', sort: 13 })
    expect(await fails(rpc(db, A, `select public.admin_save_gift($1::jsonb)`, [body]))).toMatch(/FORBIDDEN/)
    await rpc(db, ADMIN, `select public.admin_save_gift($1::jsonb)`, [body])
    const list = await rpc<Row[]>(db, ADMIN, `select public.admin_list_gifts() as r`)
    expect(list.find((g) => g.code === 'coffee')).toMatchObject({ name: 'Cà phê sữa đá', price_xu: 12, sent_30d: 5, burn_30d: 50 })   // gửi trùng khóa không tính
  })
})
