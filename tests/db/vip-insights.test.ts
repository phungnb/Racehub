import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createDb, asUser } from './load-schema'

// Migration 004000: quyền lợi VIP (xu hướng, kỷ lục, mẫu thử thách, xuất báo cáo) + chỉ số kinh tế cho admin
const [FREE, V1, V2, V3, ADMIN] = ['00000000-0000-0000-0000-0000000040a1', '00000000-0000-0000-0000-0000000040a2',
  '00000000-0000-0000-0000-0000000040a3', '00000000-0000-0000-0000-0000000040a4', '00000000-0000-0000-0000-0000000040a5']
const ALL = [FREE, V1, V2, V3, ADMIN]

async function seed(db: PGlite) {
  await db.exec(`
    insert into auth.users (id, email) values ${ALL.map((id, i) => `('${id}', 'v${i}@x.vn')`).join(', ')};
    insert into public.profiles (id, display_name, xu, xp, level, created_at) values ${ALL.map((id, i) => `('${id}', 'U${i}', 0, 0, 1, now())`).join(', ')};
  `)
}
type Row = Record<string, any>
const rpc = async <T = Row>(db: PGlite, uid: string, sql: string, params: unknown[] = []) => (await asUser<{ r: T }>(db, uid, '/rpc', sql, params)).rows[0].r
const fails = async (p: Promise<unknown>) => { try { await p } catch (e) { return (e as Error).message } return 'OK' }
const run = async (db: PGlite, uid: string, daysAgo: number, km: number, status = 'APPROVED') =>
  (await db.query<{ id: string }>(`
    insert into public.activities (user_id, title, source, started_at, ended_at, distance_m, moving_distance_m, moving_time_s, elapsed_time_s, avg_pace_s, validation_status, status)
    values ($1, 'Chạy', 'STRAVA', now() - make_interval(days => $2), now() - make_interval(days => $2) + interval '1 hour', $3::numeric, $3::numeric, $4::int, $4::int, 300, $5, 'READY')
    returning id`, [uid, daysAgo, km * 1000, Math.round(km * 300), status])).rows[0].id

describe('Phân tích VIP + chỉ số kinh tế (004000)', () => {
  let db: PGlite
  beforeAll(async () => {
    db = await createDb({ withMigrations: true, runMigrationsTwice: true, seed })
    await db.query(`update public.profiles set role = 'SYSTEM_ADMIN' where id = $1`, [ADMIN])
    for (const [uid, plan] of [[V1, 'VIP1'], [V2, 'VIP2'], [V3, 'VIP3']]) {
      await rpc(db, ADMIN, `select public.admin_grant_plan('USER', $1, $2, 1, 'Thử quyền lợi') as r`, [uid, plan])
    }
  }, 300_000)

  it('khóa theo bậc VIP ở máy chủ: miễn phí bị chặn, VIP1 chỉ xem xu hướng, VIP3 xem tất cả, admin luôn xem', async () => {
    expect(await fails(rpc(db, FREE, `select public.my_trends() as r`))).toContain('VIP_REQUIRED')
    expect(await fails(rpc(db, V1, `select public.my_trends() as r`))).toBe('OK')
    expect(await fails(rpc(db, V1, `select public.my_performance() as r`))).toContain('VIP_REQUIRED')
    expect(await fails(rpc(db, V2, `select public.my_challenge_templates() as r`))).toBe('OK')
    expect(await fails(rpc(db, V2, `select public.my_activity_export('2026-01-01', '2026-12-31') as r`))).toContain('VIP_REQUIRED')
    expect(await fails(rpc(db, V3, `select public.my_activity_export(current_date - 30, current_date) as r`))).toBe('OK')
    expect(await fails(rpc(db, ADMIN, `select public.my_performance() as r`))).toBe('OK')
    expect(await fails(rpc(db, V3, `select public.my_activity_export('2020-01-01', '2026-12-31') as r`))).toContain('INVALID_RANGE')
  })

  it('xu hướng: đủ 12 tuần + 12 tháng, chỉ tính bài hợp lệ', async () => {
    await run(db, V1, 0, 10)
    await run(db, V1, 0, 5)
    await run(db, V1, 0, 42, 'REJECTED')         // bị từ chối: không tính
    await run(db, V1, 21, 8)
    const t = await rpc<Row>(db, V1, `select public.my_trends() as r`)
    expect(t.weeks).toHaveLength(12)
    expect(t.months).toHaveLength(12)
    expect(t.weeks.at(-1)).toMatchObject({ km: 15, runs: 2 })
    expect(t.weeks.reduce((s: number, w: Row) => s + Number(w.km), 0)).toBe(23)
    expect(t.months.reduce((s: number, m: Row) => s + m.runs, 0)).toBe(3)
  })

  it('kỷ lục: trả về từng km đủ của mỗi bài (bỏ km lẻ), mới nhất trước', async () => {
    const id = await run(db, V2, 1, 5.3)
    await db.query(`insert into public.activity_details (activity_id, splits, detailed) values ($1, $2::jsonb, true)`, [id, JSON.stringify([
      { distance_m: 1000, moving_s: 300 }, { distance_m: 1001, moving_s: 290 }, { distance_m: 999, moving_s: 310 },
      { distance_m: 1000, moving_s: 305 }, { distance_m: 1000, moving_s: 295 }, { distance_m: 300, moving_s: 80 }])])
    await run(db, V2, 10, 3)
    const p = await rpc<Row[]>(db, V2, `select public.my_performance() as r`)
    expect(p).toHaveLength(2)
    expect(p[0]).toMatchObject({ id, km: 5.3, splits: [300, 290, 310, 305, 295] })
    expect(p[1].splits).toEqual([])
  })

  it('mẫu thử thách: chỉ thử thách mình tạo, kèm số ngày và tên đội', async () => {
    const c = await db.query<{ id: string }>(`
      insert into public.challenges (title, start_date, end_date, target_value, created_by, format, objective, max_slots, target_audience)
      values ('Tuần 50 km', now(), now() + interval '7 days', 50, $1, 'TEAM', 'DISTANCE', 20, 'PUBLIC') returning id`, [V2])
    await db.query(`insert into public.challenge_teams (challenge_id, name, position) values ($1, 'Đội Xanh', 0), ($1, 'Đội Đỏ', 1)`, [c.rows[0].id])
    await db.query(`insert into public.challenges (title, start_date, end_date, target_value, created_by, format) values ('Của người khác', now(), now() + interval '3 days', 10, $1, 'RANKED')`, [V3])
    const t = await rpc<Row[]>(db, V2, `select public.my_challenge_templates() as r`)
    expect(t).toHaveLength(1)
    expect(t[0]).toMatchObject({ title: 'Tuần 50 km', format: 'TEAM', days: 7, max_slots: 20, team_names: ['Đội Xanh', 'Đội Đỏ'] })
  })

  it('xuất báo cáo: bài trong khoảng ngày, cũ trước', async () => {
    await run(db, V3, 40, 12)
    await run(db, V3, 2, 6)
    const rows = await rpc<Row[]>(db, V3, `select public.my_activity_export(current_date - 30, current_date) as r`)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ km: 6, moving_s: 1800 })
  })

  it('chỉ số kinh tế: chỉ admin; đủ số tháng; tính Xu phát ra từ chạy, doanh thu đơn đã xác nhận, lượt tạo', async () => {
    expect(await fails(rpc(db, V3, `select public.admin_economy_metrics(3) as r`))).toContain('FORBIDDEN')
    const pkg = (await db.query<{ id: string }>(`select id from public.xu_packages where xu = 1000`)).rows[0].id
    const o = await rpc<Row>(db, FREE, `select public.create_order($1::jsonb) as r`, [JSON.stringify({ kind: 'XU', package_id: pkg })])
    await rpc(db, ADMIN, `select public.admin_confirm_order($1, 'VCB 123') as r`, [o.id])
    const act = await run(db, FREE, 0, 5)
    await db.query(`select private.reward_activity($1)`, [act])
    const m = await rpc<Row>(db, ADMIN, `select public.admin_economy_metrics(3) as r`)
    expect(m.months).toHaveLength(3)
    const cur = m.months.at(-1)
    expect(Number(cur.earn_run)).toBeGreaterThan(0)
    expect(Number(cur.purchased)).toBe(1080)
    expect(cur).toMatchObject({ revenue_vnd: 100000, orders_paid: 1, orders_created: 1 })
    expect(Number(cur.credits_issued)).toBeGreaterThan(0)          // VIP1–3 được cấp lượt tháng này
    expect(Number(cur.subs_active)).toBe(3)
    expect(Number(m.snapshot.holders)).toBeGreaterThan(0)
    expect(m.config.xuVnd).toBe(100)
  })

  it('quyền lợi đã có thật không còn chữ "sắp có"', async () => {
    const perks = (await db.query<{ p: string }>(`select string_agg(perks::text, ' ') as p from public.plans where code in ('VIP1', 'VIP2')`)).rows[0].p
    expect(perks).toContain('Phân tích xu hướng 12 tuần / 12 tháng')
    expect(perks).toContain('Kỷ lục 1K → 42K, phân bố pace')
    expect(perks).not.toMatch(/xu hướng tuần \/ tháng \(sắp có\)/)
  })
})
