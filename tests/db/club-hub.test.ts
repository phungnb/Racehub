import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createDb, asUser } from './load-schema'

// Migration 000500: CLB là một không gian riêng (bảng tin, chat, thông báo, BXH)
const OWNER = '00000000-0000-0000-0000-0000000000c1'
const CAPTAIN = '00000000-0000-0000-0000-0000000000c2'
const MEMBER = '00000000-0000-0000-0000-0000000000c3'
const OUTSIDER = '00000000-0000-0000-0000-0000000000c4'
const APPLICANT = '00000000-0000-0000-0000-0000000000c5'

async function seed(db: PGlite) {
  await db.exec(`
    insert into auth.users (id, email) values
      ('${OWNER}', 'o@x.vn'), ('${CAPTAIN}', 'c@x.vn'), ('${MEMBER}', 'm@x.vn'), ('${OUTSIDER}', 'x@x.vn'), ('${APPLICANT}', 'a@x.vn');
    insert into public.profiles (id, display_name, xu, xp, level, created_at) values
      ('${OWNER}', 'Chủ Nhiệm', 0, 0, 1, now()), ('${CAPTAIN}', 'Quản Trị', 0, 0, 1, now()),
      ('${MEMBER}', 'Thành Viên', 0, 0, 1, now()), ('${OUTSIDER}', 'Người Ngoài', 0, 0, 1, now()),
      ('${APPLICANT}', 'Người Xin', 0, 0, 1, now());
  `)
}

type Row = Record<string, unknown>
const one = async <T = Row>(db: PGlite, uid: string | null, sql: string, params: unknown[] = []) =>
  (await asUser<T>(db, uid, '/rpc', sql, params)).rows[0]
const fails = async (db: PGlite, uid: string | null, sql: string, params: unknown[] = []) => {
  try { await asUser(db, uid, '/rpc', sql, params) } catch (e) { return (e as Error).message }
  return 'OK'
}

describe('CLB lõi (000500)', () => {
  let db: PGlite
  let club: string
  let code: string

  beforeAll(async () => {
    db = await createDb({ withMigrations: true, runMigrationsTwice: true, seed })
    const c = await one<{ c: { id: string; invite_code: string } }>(db, OWNER, `select public.create_club('Hồ Tây Runners', 'Chạy sáng') as c`)
    club = c.c.id
    code = c.c.invite_code
    await db.query(`update public.clubs set join_policy = 'OPEN' where id = $1`, [club])
    for (const u of [CAPTAIN, MEMBER]) await asUser(db, u, '/rpc', `select public.join_club_by_code($1)`, [code])
    const cap = await db.query<{ id: string }>(`select id from public.club_members where club_id = $1 and user_id = $2`, [club, CAPTAIN])
    await asUser(db, OWNER, '/rpc', `select public.set_member_role($1, 'CAPTAIN')`, [cap.rows[0].id])
  }, 180_000)

  it('sửa lỗi production: gán được vai trò CAPTAIN và cấm được thành viên', async () => {
    expect((await db.query(`select role from public.club_members where club_id = $1 and user_id = $2`, [club, CAPTAIN])).rows[0])
      .toMatchObject({ role: 'CAPTAIN' })
    await db.query(`insert into public.club_members (club_id, user_id, role, status) values ($1, $2, 'MEMBER', 'BANNED')`, [club, OUTSIDER])
    await db.query(`delete from public.club_members where club_id = $1 and user_id = $2`, [club, OUTSIDER])
  })

  it('thành viên đăng bài; người ngoài không đọc, không đăng được', async () => {
    const p = await one<{ p: Row }>(db, MEMBER, `select to_jsonb(public.create_club_post($1, 'Sáng mai 5h chạy Hồ Tây nhé')) as p`, [club])
    expect(p.p).toMatchObject({ kind: 'POST', is_pinned: false })
    expect(await fails(db, OUTSIDER, `select public.create_club_post($1, 'spam')`, [club])).toContain('NOT_A_MEMBER')
    const seen = await asUser(db, OUTSIDER, '/club_posts', `select id from public.club_posts where club_id = $1`, [club])
    expect(seen.rows).toHaveLength(0)
    const mine = await asUser(db, MEMBER, '/club_posts', `select id from public.club_posts where club_id = $1`, [club])
    expect(mine.rows.length).toBeGreaterThan(0)
  })

  it('không ghi thẳng vào bảng tin / thông báo, phải qua RPC', async () => {
    expect(await fails(db, MEMBER, `insert into public.club_posts (club_id, body) values ($1, 'x')`, [club])).toMatch(/permission denied/)
    expect(await fails(db, MEMBER, `insert into public.notifications (user_id, kind, title) values ($1, 'X', 'x')`, [MEMBER])).toMatch(/permission denied/)
  })

  it('chỉ ban quản trị đăng thông báo ghim; mọi thành viên nhận thông báo quan trọng', async () => {
    expect(await fails(db, MEMBER, `select public.create_club_post($1, 'x', 'Thông báo', 'ANNOUNCEMENT')`, [club])).toContain('FORBIDDEN')
    const p = await one<{ p: Row }>(db, CAPTAIN, `select to_jsonb(public.create_club_post($1, 'Đóng quỹ tháng 10', 'Thông báo quỹ', 'ANNOUNCEMENT')) as p`, [club])
    expect(p.p).toMatchObject({ kind: 'ANNOUNCEMENT', is_pinned: true })
    const n = await asUser(db, MEMBER, '/notifications', `select kind, title from public.notifications where kind = 'CLUB_ANNOUNCEMENT'`)
    expect(n.rows).toEqual([{ kind: 'CLUB_ANNOUNCEMENT', title: 'Thông báo quỹ' }])
    const self = await asUser(db, CAPTAIN, '/notifications', `select 1 from public.notifications where kind = 'CLUB_ANNOUNCEMENT'`)
    expect(self.rows).toHaveLength(0)
  })

  it('mức thông báo NONE thì không nhận gì từ CLB đó', async () => {
    await asUser(db, OWNER, '/rpc', `select public.set_club_notification_level($1, 'NONE')`, [club])
    await asUser(db, CAPTAIN, '/rpc', `select public.create_club_post($1, 'Lần 2', 'Thông báo 2', 'ANNOUNCEMENT')`, [club])
    const n = await asUser(db, OWNER, '/notifications', `select 1 from public.notifications where title = 'Thông báo 2'`)
    expect(n.rows).toHaveLength(0)
    const other = await asUser(db, MEMBER, '/notifications', `select 1 from public.notifications where title = 'Thông báo 2'`)
    expect(other.rows).toHaveLength(1)
  })

  it('cổ vũ bật / tắt, đếm đúng, chỉ báo tác giả một lần', async () => {
    const post = (await db.query<{ id: string }>(`select id from public.club_posts where club_id = $1 and author_id = $2 and kind = 'POST'`, [club, MEMBER])).rows[0].id
    expect((await one<{ r: Row }>(db, OWNER, `select public.toggle_post_reaction($1) as r`, [post])).r).toEqual({ reacted: true, count: 1 })
    expect((await one<{ r: Row }>(db, OWNER, `select public.toggle_post_reaction($1) as r`, [post])).r).toEqual({ reacted: false, count: 0 })
    await asUser(db, OWNER, '/rpc', `select public.toggle_post_reaction($1)`, [post])
    const n = await asUser(db, MEMBER, '/notifications', `select 1 from public.notifications where kind = 'POST_CHEER'`)
    expect(n.rows).toHaveLength(1)
  })

  it('bình luận: tăng bộ đếm, người ngoài không bình luận được, tác giả hoặc quản trị xóa được', async () => {
    const post = (await db.query<{ id: string }>(`select id from public.club_posts where club_id = $1 and author_id = $2 and kind = 'POST'`, [club, MEMBER])).rows[0].id
    const c = await one<{ c: { id: string } }>(db, OWNER, `select to_jsonb(public.add_post_comment($1, 'Đi!')) as c`, [post])
    expect(await fails(db, OUTSIDER, `select public.add_post_comment($1, 'x')`, [post])).toContain('NOT_A_MEMBER')
    expect((await db.query(`select comment_count from public.club_posts where id = $1`, [post])).rows[0]).toMatchObject({ comment_count: 1 })
    expect(await fails(db, MEMBER, `select public.delete_post_comment($1)`, [c.c.id])).toContain('FORBIDDEN')
    await asUser(db, CAPTAIN, '/rpc', `select public.delete_post_comment($1)`, [c.c.id])
    expect((await db.query(`select comment_count from public.club_posts where id = $1`, [post])).rows[0]).toMatchObject({ comment_count: 0 })
  })

  it('chat: thành viên gửi được, người ngoài không; người được nhắc tên nhận thông báo', async () => {
    await asUser(db, MEMBER, '/club_messages',
      `insert into public.club_messages (club_id, body, mentions) values ($1, '@Quản Trị 5h nhé', array[$2, $3]::uuid[])`, [club, CAPTAIN, OUTSIDER])
    const m = await db.query<{ author_id: string; mentions: string[] }>(`select author_id, mentions from public.club_messages where club_id = $1`, [club])
    expect(m.rows[0]).toEqual({ author_id: MEMBER, mentions: [CAPTAIN] })   // người ngoài bị lọc khỏi danh sách nhắc
    const n = await asUser(db, CAPTAIN, '/notifications', `select kind from public.notifications where kind = 'CHAT_MENTION'`)
    expect(n.rows).toHaveLength(1)
    expect(await fails(db, OUTSIDER, `insert into public.club_messages (club_id, body) values ($1, 'hi')`, [club])).toMatch(/row-level security/)
    expect(await fails(db, MEMBER, `insert into public.club_messages (club_id, author_id, body) values ($1, $2, 'giả mạo')`, [club, OWNER]))
      .toMatch(/permission denied/)
    expect(await fails(db, MEMBER, `insert into public.club_messages (club_id, body) values ($1, '   ')`, [club])).toContain('EMPTY_MESSAGE')
  })

  it('chat: giới hạn 20 tin mỗi phút', async () => {
    for (let i = 0; i < 19; i++) {
      await asUser(db, OWNER, '/club_messages', `insert into public.club_messages (club_id, body) values ($1, $2)`, [club, `tin ${i}`])
    }
    await asUser(db, OWNER, '/club_messages', `insert into public.club_messages (club_id, body) values ($1, 'tin 20')`, [club])
    expect(await fails(db, OWNER, `insert into public.club_messages (club_id, body) values ($1, 'tin 21')`, [club])).toContain('RATE_LIMITED')
  })

  it('hộp thư: đếm tin chưa đọc, đọc xong về 0; thu hồi tin', async () => {
    const before = await one<{ unread_count: number }>(db, CAPTAIN, `select unread_count from public.my_clubs_inbox() where club_id = $1`, [club])
    expect(before.unread_count).toBe(21)
    await asUser(db, CAPTAIN, '/rpc', `select public.mark_club_read($1)`, [club])
    expect((await one<{ unread_count: number }>(db, CAPTAIN, `select unread_count from public.my_clubs_inbox() where club_id = $1`, [club])).unread_count).toBe(0)

    const msg = (await db.query<{ id: string }>(`select id from public.club_messages where author_id = $1 limit 1`, [MEMBER])).rows[0].id
    expect(await fails(db, OUTSIDER, `select public.delete_club_message($1)`, [msg])).toContain('FORBIDDEN')
    await asUser(db, CAPTAIN, '/rpc', `select public.delete_club_message($1)`, [msg])
    expect((await db.query(`select body, deleted_at is not null as gone from public.club_messages where id = $1`, [msg])).rows[0])
      .toEqual({ body: '', gone: true })
  })

  it('xin vào CLB duyệt: báo ban quản trị; được duyệt thì báo người xin và có bài chào mừng', async () => {
    await db.query(`update public.clubs set join_policy = 'APPROVAL' where id = $1`, [club])
    await asUser(db, APPLICANT, '/rpc', `select public.join_club_by_code($1)`, [code])
    const req = await asUser(db, CAPTAIN, '/notifications', `select link from public.notifications where kind = 'CLUB_JOIN_REQUEST'`)
    expect(req.rows).toEqual([{ link: `/clubs/${club}/members` }])
    // Chủ nhiệm đã tắt thông báo CLB (mức NONE) nên không nhận
    const muted = await asUser(db, OWNER, '/notifications', `select 1 from public.notifications where kind = 'CLUB_JOIN_REQUEST'`)
    expect(muted.rows).toHaveLength(0)
    const inbox = await one<{ member_status: string }>(db, APPLICANT, `select member_status from public.my_clubs_inbox() where club_id = $1`, [club])
    expect(inbox.member_status).toBe('PENDING')

    const mem = (await db.query<{ id: string }>(`select id from public.club_members where club_id = $1 and user_id = $2`, [club, APPLICANT])).rows[0].id
    await asUser(db, CAPTAIN, '/rpc', `select public.set_member_status($1, 'APPROVED')`, [mem])
    const ok = await asUser(db, APPLICANT, '/notifications', `select kind from public.notifications where kind = 'CLUB_APPROVED'`)
    expect(ok.rows).toHaveLength(1)
    const welcome = await db.query(`select 1 from public.club_posts where club_id = $1 and kind = 'AUTO_JOIN' and author_id = $2`, [club, APPLICANT])
    expect(welcome.rows).toHaveLength(1)
  })

  it('bài chạy được duyệt → tự đăng lên bảng tin CLB và vào BXH tuần; bị xóa → gỡ bài', async () => {
    await db.exec('set role service_role')
    await db.query(`select public.link_provider_connection($1, 'STRAVA', 'ath-m', 't', 'r', now() + interval '6 hours')`, [MEMBER])
    await db.exec('reset role')
    await db.query(`update public.connected_accounts set created_at = now() - interval '1 day' where user_id = $1`, [MEMBER])
    await db.exec('set role service_role')
    await db.query(`select public.ingest_provider_activity($1, 'STRAVA', 'r-1', $2::jsonb)`, [MEMBER, JSON.stringify({
      title: 'Chạy Hồ Tây', sport_type: 'Run', started_at: new Date(Date.now() - 3600_000).toISOString(),
      elapsed_s: 1900, moving_s: 1800, distance_m: 6000, has_gps: true,
    })])
    await db.exec('reset role')

    const post = await db.query<{ body: string; meta: { distance_m: number } }>(
      `select body, meta from public.club_posts where club_id = $1 and kind = 'AUTO_RUN'`, [club])
    expect(post.rows).toHaveLength(1)
    expect(post.rows[0].body).toBe('Chạy Hồ Tây')
    expect(Number(post.rows[0].meta.distance_m)).toBe(6000)

    const lb = await asUser<{ user_id: string; rank: number; distance_m: string; run_count: number }>(db, OWNER, '/rpc',
      `select user_id, rank, distance_m, run_count from public.club_leaderboard($1, 'WEEK')`, [club])
    expect(lb.rows[0]).toMatchObject({ user_id: MEMBER, rank: 1, run_count: 1 })
    expect(Number(lb.rows[0].distance_m)).toBe(6000)
    expect(await fails(db, OUTSIDER, `select * from public.club_leaderboard($1, 'WEEK')`, [club])).toContain('NOT_A_MEMBER')

    await db.exec('set role service_role')
    await db.query(`select public.remove_provider_activity('STRAVA', 'r-1')`)
    await db.exec('reset role')
    const gone = await asUser(db, OWNER, '/club_posts', `select 1 from public.club_posts where club_id = $1 and kind = 'AUTO_RUN'`, [club])
    expect(gone.rows).toHaveLength(0)
  })

  it('tổng kết tuần: chỉ service_role chạy được, chạy lại không tạo bài trùng', async () => {
    await db.query(`insert into public.activities (user_id, title, source, started_at, ended_at, distance_m, moving_time_s, validation_status, status)
                    values ($1, 'Tuần trước', 'DIRECT_GPS', now() - interval '8 days', now() - interval '8 days' + interval '30 minutes', 10000, 3000, 'APPROVED', 'READY')`, [OWNER])
    expect(await fails(db, OWNER, `select public.post_weekly_club_recaps()`)).toMatch(/permission denied/)
    await db.exec('set role service_role')
    const n1 = (await db.query<{ n: number }>(`select public.post_weekly_club_recaps() as n`)).rows[0].n
    const n2 = (await db.query<{ n: number }>(`select public.post_weekly_club_recaps() as n`)).rows[0].n
    await db.exec('reset role')
    const recap = await db.query<{ n: string }>(`select count(*) as n from public.club_posts where club_id = $1 and kind = 'RECAP'`, [club])
    expect(n2).toBe(0)
    expect(Number(recap.rows[0].n)).toBe(n1)
  })

  it('ảnh bài đăng phải nằm trong thư mục của CLB và của chính người đăng', async () => {
    expect(await fails(db, MEMBER, `select public.create_club_post($1, 'ảnh', null, 'POST', array[$2])`, [club, `${club}/${OWNER}/a.jpg`]))
      .toContain('INVALID_IMAGE_PATH')
    const ok = await one<{ p: Row }>(db, MEMBER, `select to_jsonb(public.create_club_post($1, '', null, 'POST', array[$2])) as p`, [club, `${club}/${MEMBER}/a.jpg`])
    expect(ok.p).toMatchObject({ image_paths: [`${club}/${MEMBER}/a.jpg`] })
  })
})
