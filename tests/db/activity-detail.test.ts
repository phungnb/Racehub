import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createDb, asUser } from './load-schema'

// Migration 001900 (+006700 quy định Strava): chi tiết bài chạy — quyền riêng tư bài / bản đồ, dữ liệu Strava, so sánh với bài trước
const ME = '00000000-0000-0000-0000-0000000000f1'
const OTHER = '00000000-0000-0000-0000-0000000000f2'
const STRAVA_RUN = '00000000-0000-0000-0000-00000000a001'
const GPS_RUN = '00000000-0000-0000-0000-00000000a002'
const OLD_RUN = '00000000-0000-0000-0000-00000000a003'

async function seed(db: PGlite) {
  await db.exec(`
    insert into auth.users (id, email) values ('${ME}', 'me@x.vn'), ('${OTHER}', 'o@x.vn');
    insert into public.profiles (id, display_name, xu, xp, level, created_at) values
      ('${ME}', 'Minh', 0, 0, 3, now()), ('${OTHER}', 'Lan', 0, 0, 1, now()) on conflict do nothing;
    insert into public.activities (id, user_id, source, source_activity_id, started_at, ended_at, distance_m, moving_distance_m, moving_time_s, avg_pace_s, validation_status, status)
    values
      ('${OLD_RUN}', '${ME}', 'STRAVA', '900', now() - interval '3 days', now() - interval '3 days' + interval '30 minutes', 5000, 5000, 1800, 360, 'APPROVED', 'READY'),
      ('${STRAVA_RUN}', '${ME}', 'STRAVA', '901', now() - interval '1 day', now() - interval '1 day' + interval '1 hour', 10000, 10000, 3300, 330, 'APPROVED', 'READY'),
      ('${GPS_RUN}', '${ME}', 'DIRECT_GPS', null, now() - interval '2 hours', now() - interval '1 hour', 2000, 2000, 720, 360, 'APPROVED', 'READY');
    insert into public.activity_track_points (activity_id, sequence, latitude, longitude, altitude, recorded_at)
    select '${GPS_RUN}', g, 21.03 + g * 0.0001, 105.85, 10, now() - interval '2 hours' + make_interval(secs => g * 3)
      from generate_series(1, 2500) g;
  `)
}

type Detail = Record<string, unknown> & { points: unknown[] | null; polyline: string | null; splits: unknown[] | null; compare: Record<string, unknown> }
const detail = async (db: PGlite, uid: string, id: string) =>
  (await asUser<{ r: Detail }>(db, uid, '/rpc', `select public.activity_detail($1) as r`, [id])).rows[0].r
const fails = async (db: PGlite, uid: string, sql: string, params: unknown[] = []) => {
  try { await asUser(db, uid, '/rpc', sql, params) } catch (e) { return (e as Error).message }
  return 'OK'
}

describe('Chi tiết bài chạy (001900)', () => {
  let db: PGlite
  beforeAll(async () => { db = await createDb({ withMigrations: true, runMigrationsTwice: true, seed }) }, 240_000)

  it('lưu chi tiết Strava: bản tóm tắt không ghi đè bản chi tiết; chỉ service_role ghi được', async () => {
    const full = { polyline: 'full_line', splits: [{ distance_m: 1000, moving_s: 330, elev_m: 2, hr: 150 }], max_heartrate: 172, detailed: true }
    expect((await db.query<{ r: string }>(`select public.save_activity_detail('STRAVA', '901', $1::jsonb) as r`, [JSON.stringify(full)])).rows[0].r).toBe(STRAVA_RUN)
    await db.query(`select public.save_activity_detail('STRAVA', '901', $1::jsonb)`, [JSON.stringify({ polyline: 'summary_line', detailed: false })])
    const row = (await db.query<{ polyline: string; detailed: boolean; splits: unknown[] }>(`select polyline, detailed, splits from public.activity_details where activity_id = $1`, [STRAVA_RUN])).rows[0]
    expect(row).toMatchObject({ polyline: 'full_line', detailed: true })
    expect(row.splits).toHaveLength(1)
    expect((await db.query<{ r: string | null }>(`select public.save_activity_detail('STRAVA', 'không-có', '{}'::jsonb) as r`)).rows[0].r).toBeNull()
    expect(await fails(db, ME, `select public.save_activity_detail('STRAVA', '901', '{}'::jsonb)`)).toMatch(/permission denied/)
    expect(await fails(db, ME, `select * from public.activity_details`)).toMatch(/permission denied/)
  })

  it('chủ bài xem đủ: tuyến, từng km, so sánh với bài trước', async () => {
    const d = await detail(db, ME, STRAVA_RUN)
    expect(d).toMatchObject({ is_mine: true, map_allowed: true, polyline: 'full_line', max_heartrate: 172, needs_detail: false })
    expect(d.compare).toMatchObject({ runs: 1, avg_distance_m: 5000, avg_pace_s: 360, longest_30d: true })
    // Bài GPS trong app: trả điểm GPS đã rút gọn (≤ ~1000), có thời gian để tính từng km
    const g = await detail(db, ME, GPS_RUN)
    expect(g.polyline).toBeNull()
    expect(g.points!.length).toBeGreaterThan(500)
    expect(g.points!.length).toBeLessThanOrEqual(1001)
    expect(g.needs_detail).toBe(false)
  })

  it('người khác: bản đồ mặc định riêng tư; bài riêng tư thì không thấy', async () => {
    // 007000 + 007400: chủ bài TẮT chia sẻ bài Strava → người khác không thấy
    await asUser(db, ME, '/rpc', `select public.set_strava_sharing(false)`)
    expect(await fails(db, OTHER, `select public.activity_detail($1)`, [STRAVA_RUN])).toContain('ACTIVITY_NOT_FOUND')
    await asUser(db, ME, '/rpc', `select public.set_strava_sharing(true)`)
    const d = await detail(db, OTHER, STRAVA_RUN)
    expect(d).toMatchObject({ is_mine: false, map_allowed: false, polyline: null, validation_reason: null, needs_detail: false })
    // 006700 (quy định API Strava): bài Strava của người khác chỉ có số tổng — không từng km, nhịp tim
    expect(d).toMatchObject({ strava_limited: true, splits: null, max_heartrate: null, distance_m: 10000 })
    await db.query(`insert into public.profile_settings (user_id, activity_visibility, map_visibility) values ($1, 'PUBLIC', 'PUBLIC')
                    on conflict (user_id) do update set activity_visibility = 'PUBLIC', map_visibility = 'PUBLIC'`, [ME])
    expect((await detail(db, OTHER, STRAVA_RUN)).polyline).toBeNull()          // kể cả khi bản đồ công khai
    const g = await detail(db, OTHER, GPS_RUN)                                     // bài ghi bằng app: xem bình thường
    expect(g).toMatchObject({ strava_limited: false, map_allowed: true })
    expect(g.points!.length).toBeGreaterThan(500)
    expect((await detail(db, ME, STRAVA_RUN))).toMatchObject({ strava_limited: false, polyline: 'full_line', max_heartrate: 172, strava_id: '901' })
    expect(d.strava_id).toBeNull()
    await db.query(`update public.profile_settings set activity_visibility = 'PRIVATE' where user_id = $1`, [ME])
    expect(await fails(db, OTHER, `select public.activity_detail($1)`, [STRAVA_RUN])).toContain('ACTIVITY_NOT_FOUND')
    expect(await fails(db, OTHER, `select public.activity_detail($1)`, [OTHER])).toContain('ACTIVITY_NOT_FOUND')
  })
})
