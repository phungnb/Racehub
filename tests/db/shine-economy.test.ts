import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createDb, asUser } from './load-schema'

// Migration 004700: ví Tỏa sáng — trần theo người tặng, người tặng hợp lệ, đổi lượt tạo / khiên / vật phẩm, lời cảm ơn, bậc tỏa sáng
const R = '00000000-0000-0000-0000-0000000047a0'
const S = [1, 2, 3, 4, 5, 6].map((i) => `00000000-0000-0000-0000-0000000047b${i}`)
const [NEWBIE, ADMIN] = ['00000000-0000-0000-0000-0000000047c1', '00000000-0000-0000-0000-0000000047c2']
const ALL = [R, ...S, NEWBIE, ADMIN]

async function seed(db: PGlite) {
  await db.exec(`
    insert into auth.users (id, email) values ${ALL.map((id, i) => `('${id}', 's${i}@x.vn')`).join(', ')};
    insert into public.profiles (id, display_name, xu, xp, level, created_at) values
      ${ALL.map((id, i) => `('${id}', 'S${i}', 0, 0, 1, now() - interval '${id === NEWBIE ? 1 : 40} days')`).join(', ')};
  `)
}
type Row = Record<string, any>
const rpc = async <T = Row>(db: PGlite, uid: string, sql: string, params: unknown[] = []) => (await asUser<{ r: T }>(db, uid, '/rpc', sql, params)).rows[0]?.r
const fails = async (p: Promise<unknown>) => { try { await p } catch (e) { return (e as Error).message } return 'OK' }
let n = 0
const gift = (db: PGlite, from: string, code: string, qty = 1) =>
  rpc<Row>(db, from, `select public.send_gift($1, $2, $3, null, null, null, $4) as r`, [R, code, qty, `shine-test-${++n}`])
const shine = (db: PGlite, uid = R) => rpc<Row>(db, uid, `select public.my_shine() as r`)

describe('Ví Tỏa sáng (004700)', () => {
  let db: PGlite
  let g100: string, g10: string
  beforeAll(async () => {
    db = await createDb({ withMigrations: true, runMigrationsTwice: true, seed })
    await db.query(`update public.profiles set role = 'SYSTEM_ADMIN' where id = $1`, [ADMIN])
    for (const u of [...S, NEWBIE, R]) {
      await db.query(`select private.ledger_post('TEST_SEED', 'shine-seed-' || $1::text, 'seed', null,
        jsonb_build_array(jsonb_build_object('account_id', $1::uuid, 'coin_kind', 'BONUS', 'amount', 5000),
                          jsonb_build_object('account_id', private.system_account(), 'coin_kind', 'BONUS', 'amount', -5000)))`, [u])
    }
    // Người tặng hợp lệ: đã có ≥ 3 bài chạy hợp lệ (NEWBIE: tài khoản mới, không hợp lệ)
    for (const u of [...S, NEWBIE]) {
      for (let i = 0; i < 3; i++) {
        await db.query(`insert into public.activities (user_id, title, source, started_at, ended_at, distance_m, moving_distance_m, moving_time_s, avg_pace_s, validation_status, status)
          values ($1, 'Chạy', 'STRAVA', now() - make_interval(days => $2), now() - make_interval(days => $2) + interval '30 minutes', 5000, 5000, 1650, 330, 'APPROVED', 'READY')`, [u, 3 + i])
      }
    }
    const gifts = (await db.query<{ code: string; price_xu: number }>(`select code, price_xu from public.gift_catalog
      where is_active and vip_tier = 0 and season_from is null order by price_xu`)).rows
    g100 = gifts.find((g) => g.price_xu === 100)!.code
    g10 = gifts.find((g) => g.price_xu === 10)!.code
  }, 300_000)

  it('quà lớn vẫn cộng đủ Tỏa sáng tích lũy + bậc; phần đổi được tối đa 300 / người tặng / tuần; người tặng mới không tính', async () => {
    await gift(db, S[0], g100, 5)                          // 500 Xu
    let s = await shine(db)
    expect(s).toMatchObject({ total: 500, available: 300, tier: 1 })
    await gift(db, NEWBIE, g100, 1)
    s = await shine(db)
    expect(s).toMatchObject({ total: 600, available: 300, fans: 1 })
    const note = (await db.query(`select 1 from public.notifications where user_id = $1 and kind = 'SHINE'`, [R])).rows
    expect(note).toHaveLength(1)
    expect((await rpc<Row>(db, S[1], `select public.gift_wall($1) as r`, [R]))).toMatchObject({ tier: 1, shine: 600, hidden: false })
  })

  it('đổi lượt tạo cần đủ Tỏa sáng và ≥ 5 người tặng; đổi xong trừ ví, không trừ tích lũy; huy hiệu 5 người hâm mộ', async () => {
    expect(await fails(rpc(db, R, `select public.redeem_shine('PASS_20', 'redeem-000001') as r`))).toContain('INSUFFICIENT_SHINE')
    for (let i = 0; i < 3; i++) await gift(db, S[1], g100, 1)   // +300
    expect(await fails(rpc(db, R, `select public.redeem_shine('PASS_20', 'redeem-000002') as r`))).toContain('SHINE_NEED_SENDERS')
    for (const u of S.slice(2, 5)) await gift(db, u, g10, 1)
    const r = await rpc<Row>(db, R, `select public.redeem_shine('PASS_20', 'redeem-000003') as r`)
    expect(r).toMatchObject({ code: 'PASS_20', cost: 500, available: 130 })
    expect(await rpc<Row>(db, R, `select public.redeem_shine('PASS_20', 'redeem-000003') as r`)).toMatchObject({ duplicate: true })
    const pass = (await db.query<{ max_slots: number; remaining: number }>(`select max_slots, remaining from public.challenge_passes where owner_id = $1 and source_key like 'shine:%'`, [R])).rows
    expect(pass).toEqual([{ max_slots: 20, remaining: 1 }])
    const s = await shine(db)
    expect(s.total).toBe(930)
    expect(s.shop.find((x: Row) => x.code === 'PASS_20').used).toBe(1)
    expect((await db.query(`select 1 from public.user_achievements u join public.achievements a on a.id = u.achievement_id where u.user_id = $1 and a.code = 'FANS_5'`, [R])).rows).toHaveLength(1)
  })

  it('lời cảm ơn: chỉ gửi người đã tặng mình, mỗi người một lần / ngày', async () => {
    expect(await rpc<Row>(db, R, `select public.send_thanks($1) as r`, [S[0]])).toMatchObject({ thanks_left: 4 })
    expect(await fails(rpc(db, R, `select public.send_thanks($1) as r`, [S[0]]))).toContain('ALREADY_THANKED')
    expect(await fails(rpc(db, R, `select public.send_thanks($1) as r`, [ADMIN]))).toContain('NOT_A_SUPPORTER')
    expect((await db.query(`select 1 from public.notifications where user_id = $1 and kind = 'THANKS'`, [S[0]])).rows).toHaveLength(1)
  })

  it('vật phẩm chỉ đổi bằng Tỏa sáng: không mua bằng Xu được; tường quà ẩn chi tiết nhưng vẫn hiện bậc', async () => {
    const item = (await db.query<{ code: string }>(`select code from public.avatar_items where code is not null and is_active and price_xu > 0 order by code`)).rows[0]
    expect(await fails(rpc(db, R, `select public.admin_save_shine_item($1::jsonb) as r`, [JSON.stringify({ code: 'AURA', name: 'x', kind: 'COSMETIC', cost: 1 })]))).toContain('FORBIDDEN')
    await rpc(db, ADMIN, `select public.admin_save_shine_item($1::jsonb) as r`, [JSON.stringify({
      code: 'AURA_1', name: 'Hào quang hoa hồng', kind: 'COSMETIC', cost: 100, params: { item_code: item.code } })])
    expect(await fails(rpc(db, S[5], `select public.buy_avatar_item($1, 'buy-aura-01') as r`, [item.code]))).toContain('SHINE_ONLY')
    await db.query(`delete from public.user_inventory where user_id = $1 and item_id = (select id from public.avatar_items where code = $2)`, [R, item.code])
    expect(await rpc<Row>(db, R, `select public.redeem_shine('AURA_1', 'redeem-aura-1') as r`)).toMatchObject({ available: 30 })
    expect((await db.query(`select acquired_reason from public.user_inventory where user_id = $1 and item_id = (select id from public.avatar_items where code = $2)`, [R, item.code])).rows)
      .toEqual([{ acquired_reason: 'SHINE' }])

    await asUser(db, R, '/rest', `update public.profiles set gift_wall_public = false where id = $1`, [R])
    expect(await rpc<Row>(db, S[1], `select public.gift_wall($1) as r`, [R])).toMatchObject({ hidden: true, tier: 1, count: 0 })
    expect(await rpc<Row>(db, R, `select public.gift_wall($1) as r`, [R])).toMatchObject({ hidden: false, public: false })
    // Người dùng không tự sửa được điểm Tỏa sáng
    expect(await fails(asUser(db, R, '/rest', `update public.profiles set shine_total = 999999 where id = $1`, [R]))).toContain('permission denied')
    const ov = await rpc<Row>(db, ADMIN, `select public.admin_shine_overview() as r`)
    expect(ov.spent_30d).toBe(600)
    expect(ov.xu_equiv_30d).toBe(150)
  })
})
