import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createDb, asUser } from './load-schema'

// Migration 011500: sửa bình luận, theo dõi runner, bảng tin Đang theo dõi, tin nhắn 1-1
const [A, B, C, D] = [1, 2, 3, 4].map((n) => `00000000-0000-0000-0000-0000001150${String(n).padStart(2, '0')}`)
type Row = Record<string, any>

async function seed(db: PGlite) {
  await db.exec(`
    insert into auth.users (id, email) values ('${A}', 'a115@x.vn'), ('${B}', 'b115@x.vn'), ('${C}', 'c115@x.vn'), ('${D}', 'd115@x.vn');
    insert into public.profiles (id, display_name) values ('${A}', 'An'), ('${B}', 'Bình'), ('${C}', 'Chi'), ('${D}', 'Dũng') on conflict do nothing;
  `)
}
const rpc = async <T = Row>(db: PGlite, uid: string, sql: string, params: unknown[] = []) => (await asUser<{ r: T }>(db, uid, '/rpc', sql, params)).rows[0].r
const fails = async (p: Promise<unknown>) => { try { await p } catch (e) { return (e as Error).message } return 'OK' }
let h = 50
const run = (db: PGlite, uid: string, title: string) => db.query<{ id: string }>(`
  insert into public.activities (user_id, title, source, started_at, ended_at, distance_m, moving_distance_m, moving_time_s, avg_pace_s, validation_status, status)
  values ($1, $2, 'DIRECT_GPS', now() - make_interval(hours => $3), now() - make_interval(hours => $3) + interval '1 hour', 5000, 5000, 1800, 360, 'APPROVED', 'READY')
  returning id`, [uid, title, (h -= 1)]).then((r) => r.rows[0].id)

describe('mạng xã hội runner (011500)', () => {
  let db: PGlite
  let post: string
  const notes = async (uid: string, kind: string) => Number((await db.query<{ n: string }>(
    `select count(*) n from public.notifications where user_id = $1 and kind = $2`, [uid, kind])).rows[0].n)

  beforeAll(async () => {
    db = await createDb({ withMigrations: true, runMigrationsTwice: true, seed })
    const c = await rpc<{ id: string; invite_code: string }>(db, A, `select public.create_club('Hồ Tây', 'Chạy sáng') as r`)
    await db.query(`update public.clubs set join_policy = 'OPEN' where id = $1`, [c.id])
    await asUser(db, B, '/rpc', `select public.join_club_by_code($1)`, [c.invite_code])
    post = (await rpc<{ id: string }>(db, A, `select to_jsonb(public.create_club_post($1, 'Chạy xong 10 km!')) as r`, [c.id])).id
  }, 300_000)

  it('sửa bình luận: chỉ người viết, hiện đã sửa; chủ CLB xóa được nhưng không sửa được', async () => {
    const cm = (await rpc<{ id: string }>(db, B, `select to_jsonb(public.add_post_comment($1, 'Chúc mừng anh', null::uuid)) as r`, [post])).id
    const thread = (uid: string) => rpc<Row[]>(db, uid, `select public.club_post_comment_thread($1) as r`, [post])
    expect((await thread(B))[0]).toMatchObject({ can_edit: true, can_delete: true, edited_at: null })
    expect((await thread(A))[0]).toMatchObject({ can_edit: false, can_delete: true })
    expect(await fails(rpc(db, A, `select public.edit_post_comment($1, 'Sửa bậy') as r`, [cm]))).toContain('NOT_AUTHOR')
    expect(await fails(rpc(db, B, `select public.edit_post_comment($1, '   ') as r`, [cm]))).toContain('EMPTY_COMMENT')
    await rpc(db, B, `select public.edit_post_comment($1, 'Chúc mừng anh, đỉnh quá!') as r`, [cm])
    const t = (await thread(A))[0]
    expect(t.body).toBe('Chúc mừng anh, đỉnh quá!')
    expect(t.edited_at).not.toBeNull()
  })

  it('theo dõi / bỏ theo dõi: đếm, thông báo một lần, không tự theo dõi mình', async () => {
    expect(await fails(rpc(db, C, `select public.follow_runner($1) as r`, [C]))).toContain('INVALID_TARGET')
    const s = await rpc(db, C, `select public.follow_runner($1) as r`, [D])
    expect(s).toMatchObject({ following: true, followed_by: false, followers: 1 })
    await rpc(db, C, `select public.follow_runner($1) as r`, [D])      // bấm lại: không thông báo thêm
    expect(await notes(D, 'FOLLOW')).toBe(1)
    const list = await rpc<Row[]>(db, A, `select public.follow_list($1, 'FOLLOWERS') as r`, [D])
    expect(list.map((x) => x.id)).toEqual([C])
    expect((await rpc<Row[]>(db, A, `select public.follow_list($1, 'FOLLOWING') as r`, [C])).map((x) => x.id)).toEqual([D])
    expect(await rpc(db, C, `select public.unfollow_runner($1) as r`, [D])).toMatchObject({ following: false, followers: 0 })
  })

  it('bảng tin Đang theo dõi: bài của mình + người mình theo dõi; tôn trọng riêng tư và đồng ý chia sẻ Strava', async () => {
    const mine = await run(db, C, 'Của Chi')
    const pub = await run(db, D, 'Công khai')
    const hidden = await run(db, D, 'Strava chưa chia sẻ')
    await db.query(`update public.activities set shared = false where id = $1`, [hidden])
    const feed = async () => (await rpc<Row[]>(db, C, `select public.following_feed(null, 20) as r`)).map((x) => x.id)
    expect(await feed()).toEqual([mine])                              // chưa theo dõi ai
    await rpc(db, C, `select public.follow_runner($1) as r`, [D])
    expect(await feed()).toEqual([pub, mine])                         // mới nhất trước; bài Strava chưa chia sẻ bị ẩn
    const f = await rpc<Row[]>(db, C, `select public.following_feed(null, 20) as r`)
    expect(f.find((x) => x.id === pub)).toMatchObject({ is_me: false, distance_m: 5000, user: { id: D, display_name: 'Dũng' } })
    await db.query(`insert into public.profile_settings (user_id, activity_visibility) values ($1, 'PRIVATE')
                    on conflict (user_id) do update set activity_visibility = 'PRIVATE'`, [D])
    expect(await feed()).toEqual([mine])
    await db.query(`update public.profile_settings set activity_visibility = 'PUBLIC' where user_id = $1`, [D])
    // Phân trang theo thời gian
    expect(await rpc<Row[]>(db, C, `select public.following_feed(now() - interval '100 days', 20) as r`)).toEqual([])
  })

  it('tin nhắn: cần theo dõi / kết nối / cùng CLB; gửi, hộp thư, chưa đọc, đọc, thu hồi', async () => {
    // D chưa theo dõi C, không cùng CLB → C không nhắn được cho D
    expect(await fails(rpc(db, C, `select public.send_direct_message($1, 'Chào') as r`, [D]))).toContain('DM_NOT_ALLOWED')
    // C theo dõi D → D nhắn được cho C
    expect((await rpc(db, D, `select public.follow_status($1) as r`, [C])).can_message).toBe(true)
    expect(await fails(rpc(db, D, `select public.send_direct_message($1, '  ') as r`, [C]))).toContain('EMPTY_MESSAGE')
    const m1 = await rpc(db, D, `select public.send_direct_message($1, 'Chào Chi, mai chạy không?') as r`, [C])
    expect(m1).toMatchObject({ mine: true, body: 'Chào Chi, mai chạy không?' })
    await rpc(db, D, `select public.send_direct_message($1, 'Hồ Tây 5h nhé') as r`, [C])
    expect(await notes(C, 'DM')).toBe(1)                                // gộp lượt tin chưa đọc
    expect(await rpc(db, C, `select public.direct_unread_count() as r`)).toBe(2)
    const inbox = await rpc<Row[]>(db, C, `select public.direct_inbox() as r`)
    expect(inbox).toHaveLength(1)
    expect(inbox[0]).toMatchObject({ user: { id: D }, unread: 2, last: { body: 'Hồ Tây 5h nhé', mine: false } })
    // Người đã nhắn cho mình thì mình nhắn lại được
    const t = await rpc(db, C, `select public.direct_thread($1) as r`, [D])
    expect(t.can_message).toBe(true)
    expect(t.messages.map((x: Row) => x.body)).toEqual(['Chào Chi, mai chạy không?', 'Hồ Tây 5h nhé'])
    expect(await rpc(db, C, `select public.direct_unread_count() as r`)).toBe(0)
    await rpc(db, C, `select public.send_direct_message($1, 'Ok anh') as r`, [D])
    // Cùng CLB nhắn được
    expect((await rpc(db, A, `select public.follow_status($1) as r`, [B])).can_message).toBe(true)
    // Thu hồi: chỉ người gửi
    expect(await fails(rpc(db, C, `select public.delete_direct_message($1) as r`, [m1.id]))).toContain('NOT_AUTHOR')
    await rpc(db, D, `select public.delete_direct_message($1) as r`, [m1.id])
    const t2 = await rpc(db, D, `select public.direct_thread($1) as r`, [C])
    expect(t2.messages[0]).toMatchObject({ deleted: true, body: null })
    // Người ngoài không đọc được bảng tin nhắn trực tiếp
    expect(await fails(asUser(db, A, '/rest', `select * from public.direct_messages`))).not.toBe('OK')
    // Báo cáo từ tin nhắn
    await rpc(db, C, `select public.report_user($1, 'SPAM', null, 'DM') as r`, [D])
  })

  it('chặn: bỏ theo dõi hai chiều, không nhắn tin, không theo dõi lại, ẩn khỏi hộp thư', async () => {
    await rpc(db, D, `select public.follow_runner($1) as r`, [C])
    await rpc(db, C, `select public.block_user($1) as r`, [D])
    const n = (await db.query<{ n: number }>(`select count(*)::int n from public.runner_follows where $1 in (follower_id, followee_id)`, [C])).rows[0].n
    expect(n).toBe(0)
    expect(await fails(rpc(db, D, `select public.send_direct_message($1, 'Sao chặn?') as r`, [C]))).toContain('BLOCKED')
    expect(await fails(rpc(db, D, `select public.follow_runner($1) as r`, [C]))).toContain('BLOCKED')
    expect(await rpc(db, C, `select public.direct_inbox() as r`)).toEqual([])
    expect(await rpc(db, D, `select public.direct_thread($1) as r`, [C])).toMatchObject({ can_message: false, blocked: true, blocked_by_me: false })
  })

  it('gợi ý theo dõi: người cùng CLB', async () => {
    const s = await rpc<Row[]>(db, A, `select public.follow_suggestions() as r`)
    expect(s.map((x) => x.id)).toContain(B)
  })

  it('thông báo bài chạy mới: câu chúc mừng', async () => {
    await db.query(`insert into public.activities (user_id, title, source, source_activity_id, started_at, ended_at, distance_m, moving_distance_m, moving_time_s, validation_status, status)
      values ($1, 'Strava', 'STRAVA', 'st-115-1', now() - interval '2 hours', now() - interval '1 hour', 8000, 8000, 2800, 'APPROVED', 'READY')`, [A])
    const r = (await db.query<{ title: string; body: string }>(`select title, body from public.notifications where user_id = $1 and kind = 'RUN_SYNCED'`, [A])).rows
    expect(r).toHaveLength(1)
    expect(r[0].title).toMatch(/chúc mừng/i)
    expect(r[0].body).toMatch(/^8,00 km · Pace/)
  })
})
