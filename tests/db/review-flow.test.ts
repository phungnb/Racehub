import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createDb, asUser } from './load-schema'

// Migration 002400: chỉ bài nghi gian lận mới chờ duyệt (có mức nghi vấn) · quản trị CLB duyệt · thử thách bắt buộc nhịp tim
const [OWNER, RUNNER, OTHER] = ['00000000-0000-0000-0000-0000000004d1', '00000000-0000-0000-0000-0000000004d2', '00000000-0000-0000-0000-0000000004d3']
const CLUB = '00000000-0000-0000-0000-0000000004c1'

async function seed(db: PGlite) {
  await db.exec(`
    insert into auth.users (id, email) values ('${OWNER}', 'ow@x.vn'), ('${RUNNER}', 'rn@x.vn'), ('${OTHER}', 'ot@x.vn');
    insert into public.profiles (id, display_name, xu, xp, level, created_at) values
      ('${OWNER}', 'Chủ nhiệm', 0, 0, 1, now()), ('${RUNNER}', 'Runner', 0, 0, 1, now()), ('${OTHER}', 'Người ngoài', 0, 0, 1, now())
      on conflict do nothing;
    insert into public.clubs (id, name, owner_id, invite_code) values ('${CLUB}', 'CLB Duyệt', '${OWNER}', 'rv0001');
    insert into public.club_members (club_id, user_id, role, status) values
      ('${CLUB}', '${OWNER}', 'OWNER', 'APPROVED'), ('${CLUB}', '${RUNNER}', 'MEMBER', 'APPROVED')
      on conflict do nothing;
  `)
}

type R = { result: string; activity_id: string; validation_status: string; reason: string }
let h = 200
const ingest = async (db: PGlite, ext: string, over: Record<string, unknown> = {}, at?: string) => {
  await db.exec('set role service_role')
  try {
    return (await db.query<{ r: R }>(`select public.ingest_provider_activity($1, 'STRAVA', $2, $3::jsonb) as r`, [RUNNER, ext, JSON.stringify({
      title: 'Run', sport_type: 'Run', started_at: at ?? new Date(Date.now() - (h -= 3) * 3600_000).toISOString(),
      elapsed_s: 1900, moving_s: 1800, distance_m: 5000, has_gps: true, ...over,
    })])).rows[0].r
  } finally { await db.exec('reset role') }
}
const fails = async (p: Promise<unknown>) => { try { await p } catch (e) { return (e as Error).message } return 'OK' }

describe('duyệt bài chuyên nghiệp + nhịp tim (002400)', () => {
  let db: PGlite
  beforeAll(async () => { db = await createDb({ withMigrations: true, runMigrationsTwice: true, seed }) }, 240_000)

  it('chạy chậm / đi bộ (pace 18:00) không còn bị chờ duyệt', async () => {
    const r = await ingest(db, 'slow', { moving_s: 5400, elapsed_s: 5400 })
    expect(r.validation_status).toBe('APPROVED')
  })

  it('bài nhập tay → chờ duyệt, lý do có mức nghi vấn; báo người chạy và chủ nhiệm CLB', async () => {
    const r = await ingest(db, 'manual', { manual: true, has_gps: false })
    expect(r.validation_status).toBe('PENDING')
    expect(r.reason).toMatch(/^Mức nghi vấn: Cao\. Bài nhập tay/)
    const row = (await db.query<{ risk_level: string; risk_score: number }>(`select risk_level, risk_score from public.activities where id = $1`, [r.activity_id])).rows[0]
    expect(row).toEqual({ risk_level: 'HIGH', risk_score: 70 })
    const notes = (await db.query<{ user_id: string; kind: string }>(
      `select user_id, kind from public.notifications where kind in ('RUN_REVIEW', 'CLUB_RUN_REVIEW') order by kind`)).rows
    expect(notes).toEqual([{ user_id: RUNNER, kind: 'CLUB_RUN_REVIEW' }].map((x) => ({ ...x, user_id: OWNER })).concat([{ user_id: RUNNER, kind: 'RUN_REVIEW' }]))
  })

  it('chủ nhiệm CLB xem hàng chờ + duyệt; thành viên thường / người ngoài không được', async () => {
    const list = (await asUser<{ r: { id: string; risk_level: string; can_review: boolean }[] }>(db, OWNER, '/rpc',
      `select public.club_pending_activities($1) as r`, [CLUB])).rows[0].r
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ risk_level: 'HIGH', can_review: true })
    expect(await fails(asUser(db, RUNNER, '/rpc', `select public.club_pending_activities($1)`, [CLUB]))).toContain('FORBIDDEN')
    expect(await fails(asUser(db, OTHER, '/rpc', `select public.review_activity($1, 'APPROVED')`, [list[0].id]))).toContain('FORBIDDEN')
    expect(await fails(asUser(db, RUNNER, '/rpc', `select public.review_activity($1, 'APPROVED')`, [list[0].id]))).toContain('FORBIDDEN')

    await asUser(db, OWNER, '/rpc', `select public.review_activity($1, 'APPROVED')`, [list[0].id])
    const a = (await db.query<{ validation_status: string; reviewed_by: string }>(`select validation_status, reviewed_by from public.activities where id = $1`, [list[0].id])).rows[0]
    expect(a).toEqual({ validation_status: 'APPROVED', reviewed_by: OWNER })
    const note = (await db.query<{ title: string }>(`select title from public.notifications where user_id = $1 and kind = 'RUN_REVIEW' order by created_at desc, title`, [RUNNER])).rows
    expect(note.map((n) => n.title)).toContain('Bài chạy đã được xác minh')
  })

  it('thử thách bắt buộc nhịp tim: bài không có nhịp tim không được tính', async () => {
    const start = new Date(Date.now() + 3600_000).toISOString(), end = new Date(Date.now() + 7 * 86400_000).toISOString()
    const cid = (await asUser<{ r: { challenge_id: string } }>(db, OWNER, '/rpc', `select public.create_challenge_v2($1::jsonb, 'hr-key-0001') as r`, [JSON.stringify({
      title: 'Tuần có tim', format: 'RANKED', objective: 'DISTANCE', start_date: start, end_date: end, max_slots: 5 })])).rows[0].r.challenge_id
    expect(await fails(asUser(db, RUNNER, '/rpc', `select public.set_challenge_options($1, '{"require_hr":true}'::jsonb)`, [cid]))).toContain('FORBIDDEN')
    await asUser(db, OWNER, '/rpc', `select public.set_challenge_options($1, '{"require_hr":true}'::jsonb)`, [cid])
    await asUser(db, RUNNER, '/rpc', `select public.join_challenge($1)`, [cid])
    await db.query(`update public.challenges set start_date = now() - interval '1 day' where id = $1`, [cid])

    await ingest(db, 'nohr', {}, new Date(Date.now() - 5 * 3600_000).toISOString())
    await ingest(db, 'withhr', { avg_heartrate: 150 }, new Date(Date.now() - 2 * 3600_000).toISOString())
    const p = (await db.query<{ current_progress: string }>(`select current_progress from public.challenge_participants where challenge_id = $1 and profile_id = $2`, [cid, RUNNER])).rows[0]
    expect(Number(p.current_progress)).toBe(5)          // chỉ bài có nhịp tim
  })
})
