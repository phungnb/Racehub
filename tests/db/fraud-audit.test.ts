import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createDb, asUser } from './load-schema'

// Migration 012500: lưu phân tích + lịch sử quyết định, km theo quãng đường đã bỏ cú nhảy GPS, khôi phục bài loại nhầm
const RUN = '00000000-0000-0000-0000-0000000125a1'
const ADM = '00000000-0000-0000-0000-0000000125a2'
const OTHER = '00000000-0000-0000-0000-0000000125a3'

async function seed(db: PGlite) {
  await db.exec(`
    insert into auth.users (id, email) values ('${RUN}', 'fa1@x.vn'), ('${ADM}', 'fa2@x.vn'), ('${OTHER}', 'fa3@x.vn');
    insert into public.profiles (id, display_name, xu, xp, level, created_at) values
      ('${RUN}', 'Runner', 0, 0, 1, now()), ('${ADM}', 'Admin', 0, 0, 1, now()), ('${OTHER}', 'Other', 0, 0, 1, now()) on conflict do nothing;
  `)
}
const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000).toISOString()
const run = (over: Record<string, unknown> = {}) => ({
  title: 'Run', sport_type: 'Run', started_at: hoursAgo(3), elapsed_s: 2200, moving_s: 2100,
  distance_m: 7500, avg_speed_mps: 3.5, max_speed_mps: 5, manual: false, has_gps: true, ...over,
})
const analysis = (over: Record<string, unknown> = {}) => ({
  engine: 'ac-test', verdict: 'OK', basis: null, score: 5, level: 'LOW', independent: 0, clean_distance_m: null,
  flags: [], inputs: { distanceM: 7500 }, streams: null, ...over,
})

describe('Lưu vết chống gian lận + khôi phục (012500)', () => {
  let db: PGlite
  const ingest = async (ext: string, act: Record<string, unknown>) => {
    await db.exec('set role service_role')
    try {
      return (await db.query<{ r: Record<string, unknown> }>(
        `select public.ingest_provider_activity($1, 'STRAVA', $2, $3::jsonb) as r`, [RUN, ext, JSON.stringify(act)])).rows[0].r
    } finally { await db.exec('reset role') }
  }
  const row = async (ext: string) => (await db.query<Record<string, any>>(
    `select id, distance_m, validation_status, review_detail from public.activities where source_activity_id = $1`, [ext])).rows[0]
  const xu = async () => Number((await db.query<{ b: string }>(`select private.balance($1, null) as b`, [RUN])).rows[0].b)
  const fails = async (uid: string, sql: string, params: unknown[]) => {
    try { await asUser(db, uid, '/rpc/restore_activity', sql, params) } catch (e) { return (e as Error).message }
    return 'OK'
  }

  beforeAll(async () => {
    db = await createDb({ withMigrations: true, runMigrationsTwice: true, seed })
    await db.exec('set role service_role')
    await db.query(`select public.link_provider_connection($1, 'STRAVA', 'ath-125', 't', 'r', now() + interval '6 hours')`, [RUN])
    await db.exec('reset role')
    await db.query(`update public.connected_accounts set created_at = now() - interval '2 days' where user_id = $1`, [RUN])
    await db.query(`update public.profiles set role = 'SYSTEM_ADMIN' where id = $1`, [ADM])
  }, 240_000)

  it('GPS nhảy → km của Strava giữ nguyên (không sửa dữ liệu đối tác); lưu phân tích + quyết định của hệ thống', async () => {
    const r = await ingest('12501', run({ started_at: hoursAgo(5), risk: { verdict: 'OK', score: 5, level: 'LOW', clean_distance_m: 5500 },
      analysis: analysis({ clean_distance_m: 5500, flags: [{ code: 'GPS_DISTANCE_GAIN', tier: 'NOTE', evidence: { addedM: 2000 } }] }) }))
    expect(r.validation_status).toBe('APPROVED')
    const a = await row('12501')
    expect(Number(a.distance_m)).toBe(7500)
    expect(a.review_detail).toBeNull()
    const an = (await db.query<Record<string, any>>(`select engine, reported_distance_m, clean_distance_m, flags from public.activity_analyses where activity_id = $1`, [a.id])).rows[0]
    expect(an).toMatchObject({ engine: 'ac-test' })
    expect(Number(an.reported_distance_m)).toBe(7500)
    expect(Number(an.clean_distance_m)).toBe(5500)
    const dec = (await db.query<Record<string, any>>(`select actor_kind, to_status from public.activity_decisions where activity_id = $1`, [a.id])).rows
    expect(dec).toEqual([{ actor_kind: 'SYSTEM', to_status: 'APPROVED' }])
  })

  it('vị trí dịch chuyển (nghi vấn) → chờ duyệt, km vẫn giữ nguyên', async () => {
    const r = await ingest('12502', run({ started_at: hoursAgo(9), risk: { verdict: 'REVIEW', score: 60, level: 'HIGH', reason: 'Vị trí dịch chuyển 2000 m' },
      analysis: analysis({ verdict: 'REVIEW', basis: 'SUSPECT' }) }))
    expect(r.validation_status).toBe('PENDING')
    expect(Number((await row('12502')).distance_m)).toBe(7500)
  })

  it('bị giữ → người duyệt loại → khôi phục: phải ghi lý do, không tự khôi phục bài mình; trả Xu khi khôi phục; đủ lịch sử', async () => {
    await ingest('12503', run({ started_at: hoursAgo(14), risk: { verdict: 'REVIEW', score: 90, level: 'CRITICAL', reason: 'Nhanh hơn kỷ lục' },
      analysis: analysis({ verdict: 'REVIEW', basis: 'DISQUALIFY' }) }))
    const a = await row('12503')
    expect(a.validation_status).toBe('PENDING')
    await asUser(db, ADM, '/rpc/review_activity', `select public.review_activity($1, 'REJECTED')`, [a.id])
    expect((await row('12503')).validation_status).toBe('REJECTED')

    expect(await fails(ADM, `select public.restore_activity($1, $2)`, [a.id, ''])).toContain('NOTE_REQUIRED')
    expect(await fails(RUN, `select public.restore_activity($1, $2)`, [a.id, 'tự khôi phục'])).toContain('FORBIDDEN')
    expect(await fails(OTHER, `select public.restore_activity($1, $2)`, [a.id, 'không có quyền'])).toContain('FORBIDDEN')

    const before = await xu()
    await asUser(db, ADM, '/rpc/restore_activity', `select public.restore_activity($1, $2)`, [a.id, 'Xem tuyến: GPS trôi dưới cầu, bài thật'])
    expect((await row('12503')).validation_status).toBe('APPROVED')
    expect(await xu()).toBeGreaterThan(before)

    const kinds = (await db.query<{ actor_kind: string; to_status: string }>(
      `select actor_kind, to_status from public.activity_decisions where activity_id = $1 order by at, id`, [a.id])).rows
    expect(kinds).toEqual([
      { actor_kind: 'SYSTEM', to_status: 'PENDING' },
      { actor_kind: 'REVIEWER', to_status: 'REJECTED' },
      { actor_kind: 'RESTORE', to_status: 'APPROVED' },
    ])
    // Người chạy xem được lịch sử bài của mình (không thấy chi tiết kỹ thuật); admin thấy đủ
    const own = (await asUser<{ r: any }>(db, RUN, '/rpc/activity_audit', `select public.activity_audit($1) as r`, [a.id])).rows[0].r
    expect(own.decisions).toHaveLength(3)
    expect(own.decisions[0].detail).toBeNull()
    const adm = (await asUser<{ r: any }>(db, ADM, '/rpc/activity_audit', `select public.activity_audit($1) as r`, [a.id])).rows[0].r
    expect(adm.analyses[0]).toMatchObject({ engine: 'ac-test', basis: 'DISQUALIFY' })
  })

  it('không khôi phục bài trùng giờ với bài đang được tính', async () => {
    await ingest('12504', run({ started_at: hoursAgo(20), risk: { verdict: 'REVIEW', score: 70, level: 'HIGH', reason: 'x' }, analysis: analysis({ verdict: 'REVIEW' }) }))
    const a = await row('12504')
    await asUser(db, ADM, '/rpc/review_activity', `select public.review_activity($1, 'REJECTED')`, [a.id])
    await db.query(`insert into public.activities (user_id, source, started_at, ended_at, distance_m, moving_time_s, status, validation_status, rewarded_at)
                    values ($1, 'DIRECT_GPS', $2::timestamptz + interval '5 minutes', $2::timestamptz + interval '30 minutes', 5000, 1500, 'COMPLETED', 'APPROVED', now())`, [RUN, hoursAgo(20)])
    expect(await fails(ADM, `select public.restore_activity($1, $2)`, [a.id, 'thử khôi phục'])).toContain('OVERLAPS_COUNTED_RUN')
  })

  it('danh sách bài đã loại + thống kê tỷ lệ báo nhầm cho admin', async () => {
    const list = (await asUser<{ r: any[] }>(db, ADM, '/rpc/rejected_activities', `select public.rejected_activities(null, 30) as r`, [])).rows[0].r
    expect(list.some((x) => x.overlap === false)).toBe(true)
    const st = (await asUser<{ r: any }>(db, ADM, '/rpc/fraud_review_stats', `select public.fraud_review_stats(90) as r`, [])).rows[0].r
    expect(st).toMatchObject({ held: 3, restored: 1, still_pending: 1 })
    expect(st.approved_after_review).toBe(1)
    await expect(asUser(db, RUN, '/rpc/fraud_review_stats', `select public.fraud_review_stats(90)`, [])).rejects.toThrow()
  })
})
