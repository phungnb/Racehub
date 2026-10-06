import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createDb, asUser } from './load-schema'

// Migration 013100: chỉnh sửa lần 6
const id = (n: number) => `00000000-0000-0000-0000-0000000131${String(n).padStart(2, '0')}`
const [A, B, C, D] = [1, 2, 3, 4].map(id)   // A chạy; B theo dõi A (khác CLB); C cùng CLB với A; D không liên quan
const CLUB = '00000000-0000-0000-0000-0000000131c1'
const CH = '00000000-0000-0000-0000-0000000131d1'
const CH2 = '00000000-0000-0000-0000-0000000131d2'
type Row = Record<string, any>

async function seed(db: PGlite) {
  const users = [A, B, C, D]
  await db.exec(`
    insert into auth.users (id, email) values ${users.map((u, i) => `('${u}', 'r6${i}@x.vn')`).join(', ')};
    insert into public.profiles (id, display_name, xu, xp, level, created_at) values
      ${users.map((u, i) => `('${u}', 'Runner ${i}', 0, 0, 1, now() - interval '90 days')`).join(', ')} on conflict do nothing;
  `)
}
const rpc = async <T = Row>(db: PGlite, uid: string, sql: string, params: unknown[] = []) => (await asUser<{ r: T }>(db, uid, '/rpc', sql, params)).rows[0]?.r as T
const fails = async (p: Promise<unknown>) => { try { await p } catch (e) { return (e as Error).message } return 'OK' }

describe('chỉnh sửa lần 6 (013100)', () => {
  let db: PGlite
  let run: string
  let post: string
  beforeAll(async () => {
    db = await createDb({ withMigrations: true, runMigrationsTwice: true, seed })
    await db.exec(`
      insert into public.clubs (id, name, owner_id, invite_code) values ('${CLUB}', 'CLB 131', '${A}', 'r6c131');
      insert into public.club_members (club_id, user_id, role, status) values ('${CLUB}', '${A}', 'OWNER', 'APPROVED'), ('${CLUB}', '${C}', 'MEMBER', 'APPROVED') on conflict do nothing;
      insert into public.runner_follows (follower_id, followee_id) values ('${B}', '${A}');
    `)
    run = (await db.query<{ id: string }>(`insert into public.activities (user_id, title, source, source_activity_id, started_at, ended_at, distance_m, moving_distance_m, moving_time_s, avg_pace_s, validation_status, status, shared)
      values ($1, 'Chạy sáng', 'STRAVA', 'r6-1', now() - interval '3 hours', now() - interval '2 hours', 10000, 10000, 3300, 330, 'APPROVED', 'READY', true) returning id`, [A])).rows[0].id
    post = (await db.query<{ id: string }>(`select id from public.club_posts where activity_id = $1 and kind = 'AUTO_RUN'`, [run])).rows[0]?.id
    if (!post) {
      post = (await db.query<{ id: string }>(`insert into public.club_posts (club_id, author_id, kind, title, activity_id) values ($1, $2, 'AUTO_RUN', 'Chạy sáng', $3) returning id`, [CLUB, A, run])).rows[0].id
    }
  }, 240_000)

  it('bảng tin Đang theo dõi trả kèm bài AUTO_RUN; người theo dõi thích / bình luận được dù khác CLB, người lạ thì không', async () => {
    const feed = await rpc<Row[]>(db, B, `select public.following_feed(null, 20) as r`)
    const item = feed.find((x) => x.id === run)!
    expect(item.post).toMatchObject({ id: post, kind: 'AUTO_RUN', club: { id: CLUB }, reacted: false })

    expect(await rpc(db, B, `select public.toggle_post_reaction($1) as r`, [post])).toMatchObject({ reacted: true, count: 1 })
    const c = await rpc(db, B, `select to_jsonb(public.add_post_comment($1, 'Chạy tốt quá', null)) as r`, [post])
    expect(c.body).toBe('Chạy tốt quá')
    expect(await rpc<Row[]>(db, B, `select public.club_post_comment_thread($1) as r`, [post])).toHaveLength(1)
    expect(await rpc(db, B, `select public.post_engagement($1) as r`, [post])).toMatchObject({ like_count: 1 })
    expect(await rpc(db, C, `select public.toggle_post_comment_like($1) as r`, [c.id])).toMatchObject({ liked: true })

    expect(await fails(rpc(db, D, `select public.toggle_post_reaction($1) as r`, [post]))).toContain('NOT_A_MEMBER')
    // Bỏ theo dõi → mất quyền
    await db.query(`delete from public.runner_follows where follower_id = $1`, [B])
    expect(await fails(rpc(db, B, `select public.toggle_post_reaction($1) as r`, [post]))).toContain('NOT_A_MEMBER')
    await db.query(`insert into public.runner_follows (follower_id, followee_id) values ($1, $2)`, [B, A])
  })

  it('bài viết thường của CLB vẫn chỉ thành viên CLB tương tác được', async () => {
    const p = (await db.query<{ id: string }>(`insert into public.club_posts (club_id, author_id, kind, title, body) values ($1, $2, 'POST', 'Thông tin', 'x') returning id`, [CLUB, A])).rows[0].id
    expect(await fails(rpc(db, B, `select public.toggle_post_reaction($1) as r`, [p]))).toContain('NOT_A_MEMBER')
    expect(await rpc(db, C, `select public.toggle_post_reaction($1) as r`, [p])).toMatchObject({ reacted: true })
  })

  it('bài Strava chờ duyệt: báo người chạy kèm lý do; người chạy giải trình, ban quản trị CLB đọc được', async () => {
    const pending = (await db.query<{ id: string }>(`insert into public.activities (user_id, title, source, source_activity_id, started_at, ended_at, distance_m, moving_distance_m, moving_time_s, avg_pace_s, validation_status, status, validation_reason, shared)
      values ($1, 'Chạy tối', 'STRAVA', 'r6-2', now() - interval '1 hour', now() - interval '20 minutes', 8000, 8000, 2400, 300, 'PENDING', 'PROCESSING',
              'Mức nghi vấn: Cao. Bài nhập tay — không có dữ liệu thiết bị. Bài được tính sau khi ban quản trị CLB hoặc admin xác minh.', true) returning id`, [C])).rows[0].id
    const n = (await db.query<Row>(`select * from public.notifications where user_id = $1 and kind = 'RUN_PENDING'`, [C])).rows
    expect(n).toHaveLength(1)
    expect(n[0].body).toContain('Bài nhập tay — không có dữ liệu thiết bị.')
    expect(n[0].body).not.toContain('Mức nghi vấn')
    expect(n[0].link).toBe(`/activities/${pending}`)

    expect(await fails(rpc(db, A, `select public.explain_pending_run($1, 'không phải bài của tôi') as r`, [pending]))).toContain('FORBIDDEN')
    expect(await fails(rpc(db, C, `select public.explain_pending_run($1, 'ok') as r`, [pending]))).toContain('INVALID_NOTE')
    await rpc(db, C, `select public.explain_pending_run($1, 'Đồng hồ hết pin, tôi nhập lại từ Garmin') as r`, [pending])
    expect(await rpc(db, C, `select public.activity_review_info($1) as r`, [pending])).toMatchObject({ owner_note: 'Đồng hồ hết pin, tôi nhập lại từ Garmin' })
    const list = await rpc<Row[]>(db, A, `select public.club_pending_activities($1) as r`, [CLUB])
    expect(list.find((x) => x.id === pending)).toMatchObject({ owner_note: 'Đồng hồ hết pin, tôi nhập lại từ Garmin' })

    // Bài trong app và bài cũ không báo
    await db.query(`insert into public.activities (user_id, title, source, started_at, ended_at, distance_m, moving_distance_m, moving_time_s, avg_pace_s, validation_status, status)
      values ($1, 'GPS', 'DIRECT_GPS', now() - interval '1 hour', now() - interval '30 minutes', 5000, 5000, 1800, 360, 'PENDING', 'PROCESSING')`, [D])
    await db.query(`insert into public.activities (user_id, title, source, source_activity_id, started_at, ended_at, distance_m, moving_distance_m, moving_time_s, avg_pace_s, validation_status, status)
      values ($1, 'Cũ', 'STRAVA', 'r6-3', now() - interval '10 days', now() - interval '10 days' + interval '30 minutes', 5000, 5000, 1800, 360, 'PENDING', 'PROCESSING')`, [D])
    expect((await db.query(`select 1 from public.notifications where user_id = $1 and kind = 'RUN_PENDING'`, [D])).rows).toHaveLength(0)
  })

  it('vinh danh theo cự ly: bài tốt nhất có cự ly ≥ hạng mục, thời gian quy đổi theo pace', async () => {
    await db.exec(`
      insert into public.challenges (id, title, start_date, end_date, target_value, target_km, min_km, status, created_by, target_audience)
        values ('${CH}', 'Tháng 10', now() - interval '5 days', now() - interval '1 day', 100, 100, 1, 'ACTIVE', '${A}', 'PUBLIC');
      insert into public.challenge_participants (challenge_id, profile_id, status) values ('${CH}', '${B}', 'JOINED'), ('${CH}', '${C}', 'JOINED'), ('${CH}', '${D}', 'JOINED');
    `)
    // B: 21,5 km trong 2:00:00; C: 22 km trong 1:50:00; D: chỉ 15 km
    for (const [u, m, s, k] of [[B, 21500, 7200, 'h1'], [C, 22000, 6600, 'h2'], [D, 15000, 4000, 'h3']] as const) {
      await db.query(`insert into public.activities (user_id, title, source, source_activity_id, started_at, ended_at, distance_m, moving_distance_m, moving_time_s, avg_pace_s, validation_status, status)
        values ($1, 'Half', 'STRAVA', $4, now() - interval '3 days', now() - interval '3 days' + interval '2 hours', $2, $2, $3, 330, 'APPROVED', 'READY')`, [u, m, s, `r6-${k}`])
    }
    const rows = (await db.query<Row>(`select h.* from public.challenges c, private.honor_compute(c, '[{"key":"DIST21097","count":3}]'::jsonb) h where c.id = $1 order by rank`, [CH])).rows
    expect(rows.map((r) => r.user_id)).toEqual([C, B])
    expect(Number(rows[0].value)).toBe(Math.round(6600 * 21097 / 22000))
    expect((await db.query<{ r: Row[] }>(`select private.honor_categories('[{"key":"DIST21097","title":"Top Half","count":3}]'::jsonb) as r`)).rows[0].r[0]).toMatchObject({ key: 'DIST21097', title: 'Top Half' })
    expect(await fails(db.query(`select private.honor_categories('[{"key":"DIST100"}]'::jsonb)`))).toContain('INVALID_HONOR_CATEGORIES')
  })

  it('sửa thử thách: chỉ BTC, chỉ trước khi bắt đầu, tối đa 1 năm; báo người tham gia', async () => {
    await db.exec(`
      insert into public.challenges (id, title, start_date, end_date, target_value, target_km, min_km, status, created_by, target_audience, reg_deadline)
        values ('${CH2}', 'Sắp chạy', now() + interval '2 days', now() + interval '9 days', 50, 50, 1, 'ACTIVE', '${A}', 'PUBLIC', now() + interval '9 days');
      insert into public.challenge_participants (challenge_id, profile_id, status) values ('${CH2}', '${A}', 'JOINED'), ('${CH2}', '${B}', 'JOINED');
    `)
    const upd = (uid: string, p: object) => rpc(db, uid, `select public.update_challenge($1, $2::jsonb) as r`, [CH2, JSON.stringify(p)])
    expect(await fails(upd(B, { title: 'Đổi tên' }))).toContain('FORBIDDEN')
    // 013300: được kéo dài (phí chỉ tính theo quy mô), tối đa 1 năm như lúc tạo
    expect(await fails(upd(A, { end_date: new Date(Date.now() + 400 * 86400_000).toISOString() }))).toContain('INVALID_TIME_RANGE')
    expect(await fails(upd(A, { min_pace: 9, max_pace: 5 }))).toContain('INVALID_PACE')
    const start = new Date(Date.now() + 3 * 86400_000).toISOString(), end = new Date(Date.now() + 8 * 86400_000).toISOString()
    await upd(A, { title: 'Chạy 40 km', description: 'Mới', target_value: 40, start_date: start, end_date: end })
    const c = (await db.query<Row>(`select * from public.challenges where id = $1`, [CH2])).rows[0]
    expect(c).toMatchObject({ title: 'Chạy 40 km', description: 'Mới' })
    expect(Number(c.target_value)).toBe(40)
    expect(new Date(c.reg_deadline).toISOString()).toBe(end)
    expect((await db.query(`select 1 from public.notifications where user_id = $1 and kind = 'CHALLENGE_UPDATED'`, [B])).rows).toHaveLength(1)

    await db.query(`update public.challenges set start_date = now() - interval '1 minute' where id = $1`, [CH2])
    expect(await fails(upd(A, { title: 'Muộn rồi' }))).toContain('CHALLENGE_STARTED')
  })
})
