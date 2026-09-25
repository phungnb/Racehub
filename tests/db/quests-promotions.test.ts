import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createDb, asUser } from './load-schema'

// Migration 004300: admin tạo nhiệm vụ có thưởng; khuyến mãi (tặng hàng loạt, mã, giảm giá / tặng thêm khi nạp)
const [ADMIN, A, B, C] = ['00000000-0000-0000-0000-0000000043a1', '00000000-0000-0000-0000-0000000043a2',
  '00000000-0000-0000-0000-0000000043a3', '00000000-0000-0000-0000-0000000043a4']
const ALL = [ADMIN, A, B, C]

async function seed(db: PGlite) {
  await db.exec(`
    insert into auth.users (id, email) values ${ALL.map((id, i) => `('${id}', 'q${i}@x.vn')`).join(', ')};
    insert into public.profiles (id, display_name, xu, xp, level, created_at) values ${ALL.map((id, i) => `('${id}', 'Q${i}', 0, 0, 1, now() - interval '${i * 20} days')`).join(', ')};
  `)
}
type Row = Record<string, any>
const rpc = async <T = Row>(db: PGlite, uid: string, sql: string, params: unknown[] = []) => (await asUser<{ r: T }>(db, uid, '/rpc', sql, params)).rows[0]?.r
const fails = async (p: Promise<unknown>) => { try { await p } catch (e) { return (e as Error).message } return 'OK' }
const xu = async (db: PGlite, acc: string) => Number((await db.query<{ b: string }>(`select private.balance($1) as b`, [acc])).rows[0].b)
const run = async (db: PGlite, uid: string, km: number, hoursAgo = 1) => {
  const id = (await db.query<{ id: string }>(`
    insert into public.activities (user_id, title, source, started_at, ended_at, distance_m, moving_distance_m, moving_time_s, avg_pace_s, validation_status, status)
    values ($1, 'Chạy', 'STRAVA', now() - make_interval(hours => $2), now() - make_interval(hours => $2) + interval '40 minutes', $3::numeric, $3::numeric, $4::int, 330, 'APPROVED', 'READY')
    returning id`, [uid, hoursAgo, km * 1000, km * 330])).rows[0].id
  await db.query(`select private.reward_activity($1)`, [id])
}

describe('Nhiệm vụ do admin tạo + khuyến mãi (004300)', () => {
  let db: PGlite
  beforeAll(async () => {
    db = await createDb({ withMigrations: true, runMigrationsTwice: true, seed })
    await db.query(`update public.profiles set role = 'SYSTEM_ADMIN' where id = $1`, [ADMIN])
  }, 300_000)

  it('admin tạo nhiệm vụ sự kiện "Chạy 15 km tuần lễ" thưởng 50 Xu; hoàn thành một lần, không có XP', async () => {
    expect(await fails(rpc(db, A, `select public.admin_save_quest($1::jsonb) as r`, [JSON.stringify({ title: 'x', target: 1 })]))).toContain('FORBIDDEN')
    const id = await rpc<string>(db, ADMIN, `select public.admin_save_quest($1::jsonb) as r`, [JSON.stringify({
      title: 'Tuần lễ 15 km', period: 'EVENT', metric: 'TOTAL_KM', target: 15, reward_xu: 50, reward_xp: 500,
      starts_at: new Date(Date.now() - 86_400_000).toISOString(), ends_at: new Date(Date.now() + 6 * 86_400_000).toISOString() })])
    const before = await xu(db, A)
    await run(db, A, 8, 3)
    let mine = (await rpc<Row[]>(db, A, `select public.my_quests() as r`)).find((q) => q.id === id)!
    expect(mine).toMatchObject({ period: 'EVENT', progress: 8, completed: false })
    await run(db, A, 9, 1)
    mine = (await rpc<Row[]>(db, A, `select public.my_quests() as r`)).find((q) => q.id === id)!
    expect(mine).toMatchObject({ progress: 15, completed: true })
    const ev = (await db.query<{ xu: string; xp: number }>(`select xu, xp from public.game_events where user_id = $1 and kind = 'QUEST' and payload->>'quest_id' = $2`, [A, id])).rows
    expect(ev).toHaveLength(1)
    expect(Number(ev[0].xu)).toBe(50)
    expect(ev[0].xp).toBe(0)
    const run2 = (await xu(db, A)) - before - 50
    expect(run2).toBeGreaterThan(0)                    // Xu chạy vẫn cộng như thường
    const list = await rpc<Row[]>(db, ADMIN, `select public.admin_list_quests() as r`)
    expect(list.find((q) => q.id === id)).toMatchObject({ completions: 1, reward_xp: 0 })
  })

  it('nhiệm vụ chỉ cho VIP bị khóa với người thường; nhiệm vụ hết hạn không hiện', async () => {
    const vip = await rpc<string>(db, ADMIN, `select public.admin_save_quest($1::jsonb) as r`, [JSON.stringify({ title: 'VIP chạy 3 bài', period: 'WEEKLY', metric: 'RUN_COUNT', target: 3, reward_xu: 30, min_vip_tier: 1 })])
    const old = await rpc<string>(db, ADMIN, `select public.admin_save_quest($1::jsonb) as r`, [JSON.stringify({
      title: 'Đã qua', period: 'EVENT', metric: 'TOTAL_KM', target: 5, reward_xu: 5,
      starts_at: new Date(Date.now() - 10 * 86_400_000).toISOString(), ends_at: new Date(Date.now() - 86_400_000).toISOString() })])
    const mine = await rpc<Row[]>(db, B, `select public.my_quests() as r`)
    expect(mine.find((q) => q.id === vip)?.locked).toBe(true)
    expect(mine.find((q) => q.id === old)).toBeUndefined()
  })

  it('tặng hàng loạt theo nhóm: xem trước số người, mỗi người nhận một lần, có thông báo', async () => {
    const seg = { type: 'NEW', days: 45 }                           // ADMIN (0), A (20), B (40 ngày) — C (60 ngày) không thuộc nhóm
    const pv = await rpc<Row>(db, ADMIN, `select public.admin_preview_segment($1::jsonb) as r`, [JSON.stringify(seg)])
    expect(pv.count).toBe(3)                                           // ADMIN cũng mới
    const bBefore = await xu(db, B)
    const r = await rpc<Row>(db, ADMIN, `select public.admin_run_grant($1::jsonb) as r`, [JSON.stringify({
      title: 'Chào tân binh', message: 'Tặng 100 Xu và 1 lượt tạo', segment: seg, reward: { xu: 100, passes: { qty: 1, max_slots: 20, days: 30 } } })])
    expect(r.recipients).toBe(3)
    expect(await xu(db, B)).toBe(bBefore + 100)
    expect(await xu(db, C)).toBe(0)
    expect((await db.query(`select 1 from public.challenge_passes where owner_id = $1 and max_slots = 20`, [B])).rows).toHaveLength(1)
    expect((await db.query(`select 1 from public.notifications where user_id = $1 and kind = 'PROMO'`, [B])).rows).toHaveLength(1)
    expect(await fails(rpc(db, ADMIN, `select public.admin_run_grant($1::jsonb) as r`, [JSON.stringify({ title: 'Rỗng', reward: {} })]))).toContain('INVALID_REWARD')
    expect(await fails(rpc(db, ADMIN, `select public.admin_run_grant($1::jsonb) as r`, [JSON.stringify({ title: 'CLB', reward: { plan: { code: 'CLUB_PRO', months: 1 } } })]))).toContain('INVALID_REWARD')
  })

  it('mã khuyến mãi: dùng một lần mỗi người, giới hạn tổng lượt, sai mã bị đếm và khóa sau 10 lần', async () => {
    await rpc(db, ADMIN, `select public.admin_save_promo($1::jsonb) as r`, [JSON.stringify({ kind: 'CODE', title: 'Mã RUN2026', code: 'run2026', max_uses: 2, reward: { xu: 20 } })])
    const cBefore = await xu(db, C)
    const ok = await rpc<Row>(db, C, `select public.redeem_promo_code('RUN2026') as r`)
    expect(ok.title).toBe('Mã RUN2026')
    expect(await xu(db, C)).toBe(cBefore + 20)
    expect(await fails(rpc(db, C, `select public.redeem_promo_code('run2026') as r`))).toContain('PROMO_ALREADY_USED')
    await rpc(db, B, `select public.redeem_promo_code('RUN2026') as r`)
    expect(await fails(rpc(db, A, `select public.redeem_promo_code('RUN2026') as r`))).toContain('PROMO_USED_UP')
    for (let i = 0; i < 10; i++) expect((await rpc<Row>(db, A, `select public.redeem_promo_code($1) as r`, [`SAI${i}XX`])).error).toBe('PROMO_INVALID')
    expect(await fails(rpc(db, A, `select public.redeem_promo_code('SAI99XX') as r`))).toContain('TOO_MANY_ATTEMPTS')
  })

  it('đợt giảm giá: gói giảm 20%, nạp Xu tặng thêm 100%; đơn ghi giá gốc và đợt khuyến mãi', async () => {
    await rpc(db, ADMIN, `select public.admin_save_promo($1::jsonb) as r`, [JSON.stringify({ kind: 'SALE', title: 'Sale 9/9', discount_pct: 20, applies_to: 'PLAN' })])
    await rpc(db, ADMIN, `select public.admin_save_promo($1::jsonb) as r`, [JSON.stringify({ kind: 'SALE', title: 'Nạp x2', bonus_pct: 100, applies_to: 'XU' })])
    const sales = await rpc<Row[]>(db, C, `select public.active_sales() as r`)
    expect(sales).toHaveLength(2)
    const o = await rpc<Row>(db, C, `select public.create_order($1::jsonb) as r`, [JSON.stringify({ kind: 'PLAN', plan_code: 'VIP1', months: 1 })])
    expect(o).toMatchObject({ amount_vnd: 23000, list_price_vnd: 29000 })
    const pkg = (await db.query<{ id: string }>(`select id from public.xu_packages where xu = 1000`)).rows[0].id
    const x = await rpc<Row>(db, C, `select public.create_order($1::jsonb) as r`, [JSON.stringify({ kind: 'XU', package_id: pkg })])
    expect(x).toMatchObject({ amount_vnd: 100000, xu: 1000, bonus_xu: 1080 })
    expect(x.promotion_id).toBeTruthy()
    const list = await rpc<Row[]>(db, ADMIN, `select public.admin_list_promotions() as r`)
    expect(list.map((p) => p.kind).sort()).toEqual(['CODE', 'GRANT', 'SALE', 'SALE'])
  })
})
