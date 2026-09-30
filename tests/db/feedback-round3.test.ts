import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createDb, asUser } from './load-schema'

// Migration 011700: thành viên đăng ký thách đấu CLB, cảm xúc tin nhắn, runner soạn bài + thưởng Xu, tìm admin theo email
const id = (n: number) => `00000000-0000-0000-0000-0000001170${String(n).padStart(2, '0')}`
const [OA, A1, A2, OB, B1, AD, W] = [1, 2, 3, 4, 5, 6, 7].map(id)
const CA = '00000000-0000-0000-0000-0000001170c1', CB = '00000000-0000-0000-0000-0000001170c2'
type Row = Record<string, any>

async function seed(db: PGlite) {
  const users = [OA, A1, A2, OB, B1, AD, W]
  await db.exec(`
    insert into auth.users (id, email) values ${users.map((u, i) => `('${u}', 'r3u${i}@x.vn')`).join(', ')};
    insert into public.profiles (id, display_name) values ${users.map((u, i) => `('${u}', 'R3 ${i}')`).join(', ')} on conflict do nothing;
    update public.profiles set role = 'SYSTEM_ADMIN' where id = '${AD}';
    insert into public.clubs (id, name, owner_id, invite_code) values ('${CA}', 'Hồ Tây', '${OA}', 'r3c001'), ('${CB}', 'Sông Hồng', '${OB}', 'r3c002');
    insert into public.club_members (club_id, user_id, role, status, joined_at) values
      ('${CA}', '${OA}', 'OWNER', 'APPROVED', now() - interval '30 days'), ('${CA}', '${A1}', 'MEMBER', 'APPROVED', now() - interval '30 days'),
      ('${CA}', '${A2}', 'MEMBER', 'APPROVED', now() - interval '30 days'),
      ('${CB}', '${OB}', 'OWNER', 'APPROVED', now() - interval '30 days'), ('${CB}', '${B1}', 'MEMBER', 'APPROVED', now() - interval '30 days'),
      ('${CB}', '${A1}', 'MEMBER', 'APPROVED', now() - interval '20 days')
      on conflict do nothing;
  `)
}
const rpc = async <T = Row>(db: PGlite, uid: string, sql: string, params: unknown[] = []) => (await asUser<{ r: T }>(db, uid, '/rpc', sql, params)).rows[0].r
const fails = async (p: Promise<unknown>) => { try { await p } catch (e) { return (e as Error).message } return 'OK' }
const run = (db: PGlite, uid: string, km: number, daysAgo: number) => db.query(`
  insert into public.activities (user_id, title, source, started_at, ended_at, distance_m, moving_distance_m, moving_time_s, avg_pace_s, validation_status, status)
  values ($1, 'Chạy', 'DIRECT_GPS', now() - make_interval(days => $3), now() - make_interval(days => $3) + interval '1 hour', $2::numeric, $2::numeric, ($2::numeric * 0.36)::int, 360, 'APPROVED', 'READY')`,
  [uid, km * 1000, daysAgo])

describe('góp ý vòng 3 (011700)', () => {
  let db: PGlite
  beforeAll(async () => { db = await createDb({ withMigrations: true, runMigrationsTwice: true, seed }) }, 300_000)

  it('thách đấu CLB: chỉ thành viên đã đăng ký mới được tính; mỗi người một CLB; BXH chi tiết CLB', async () => {
    const cup = await rpc(db, OA, `select public.create_club_cup($1::jsonb) as r`, [JSON.stringify({ title: 'Cúp mùa thu Hà Nội', metric: 'TOTAL_KM', max_clubs: 10, host_club_id: CA,
      start_at: new Date(Date.now() + 3600_000).toISOString(), end_at: new Date(Date.now() + 7 * 86400_000).toISOString() })])
    expect(cup).toMatchObject({ require_signup: true })
    await rpc(db, OB, `select public.join_club_cup($1, $2) as r`, [cup.id, CB])
    // Người đăng ký CLB tự có tên; thành viên khác phải tự đăng ký
    expect((await rpc(db, OB, `select public.club_cup($1) as r`, [cup.id])).my_signup).toBe(CB)
    const mine = await rpc(db, A1, `select public.join_cup_as_member($1, $2) as r`, [cup.id, CB])
    expect(mine.my_signup).toBe(CB)
    expect(await fails(rpc(db, A1, `select public.join_cup_as_member($1, $2) as r`, [cup.id, CA]))).toContain('ALREADY_SIGNED_UP')
    expect(await fails(rpc(db, W, `select public.join_cup_as_member($1, $2) as r`, [cup.id, CA]))).toContain('NOT_A_MEMBER')
    // Rút trước giờ bắt đầu được
    expect((await rpc(db, A1, `select public.leave_cup_as_member($1) as r`, [cup.id])).my_signup).toBeNull()
    await rpc(db, A1, `select public.join_cup_as_member($1, $2) as r`, [cup.id, CA])
    await db.query(`update public.club_cups set start_at = now() - interval '5 days', reg_close_at = now() - interval '5 days' where id = $1`, [cup.id])
    expect(await fails(rpc(db, A1, `select public.leave_cup_as_member($1) as r`, [cup.id]))).toContain('CUP_STARTED')
    await run(db, OA, 10, 2); await run(db, A1, 8, 2); await run(db, A1, 6, 1); await run(db, A2, 50, 1); await run(db, B1, 20, 1); await run(db, OB, 5, 1)
    const c = await rpc(db, OA, `select public.club_cup($1) as r`, [cup.id])
    const by = Object.fromEntries(c.standings.map((s: Row) => [s.club_id, s]))
    expect(by[CA]).toMatchObject({ members: 2, km: 24 })          // OA + A1 (A2 chưa đăng ký → không tính 50 km)
    expect(by[CB]).toMatchObject({ members: 1, km: 5 })           // chỉ OB (B1 chưa đăng ký)
    const board = await rpc(db, B1, `select public.club_cup_club_board($1, $2) as r`, [cup.id, CA])
    expect(board.club.name).toBe('Hồ Tây')
    expect(board.rows.map((r: Row) => [r.display_name, Number(r.km), r.days, r.runs])).toEqual([['R3 1', 14, 2, 2], ['R3 0', 10, 1, 1]])
    expect(board.rows[0].pace_s).toBe(360)
  })

  it('tin nhắn: thả / đổi / bỏ cảm xúc; người ngoài cuộc trò chuyện không thả được', async () => {
    // Cùng CLB nên nhắn được
    const m = await rpc(db, A1, `select public.send_direct_message($1, 'Mai chạy nhé') as r`, [A2])
    expect((await rpc(db, A2, `select public.react_direct_message($1, '❤️') as r`, [m.id])).reactions).toEqual([{ emoji: '❤️', count: 1, mine: true }])
    expect((await rpc(db, A1, `select public.react_direct_message($1, '❤️') as r`, [m.id])).reactions).toEqual([{ emoji: '❤️', count: 2, mine: true }])
    expect((await rpc(db, A2, `select public.react_direct_message($1, '🔥') as r`, [m.id])).reactions).toHaveLength(2)
    expect((await rpc(db, A2, `select public.react_direct_message($1, '🔥') as r`, [m.id])).reactions).toEqual([{ emoji: '❤️', count: 1, mine: false }])
    expect(await fails(rpc(db, B1, `select public.react_direct_message($1, '😂') as r`, [m.id]))).toContain('NOT_FOUND')
    const t = await rpc(db, A2, `select public.direct_thread($1) as r`, [A1])
    expect(t.messages[0].reactions).toEqual([{ emoji: '❤️', count: 1, mine: false }])
  })

  it('runner soạn bài → gửi duyệt → admin đăng → tự cộng 30 Xu (một lần); tác giả xem trước được', async () => {
    const body = 'Chạy bộ buổi sáng giúp tinh thần sảng khoái. '.repeat(10)
    expect(await fails(rpc(db, W, `select public.knowledge_submit($1::jsonb) as r`, [JSON.stringify({ title: 'Ngắn', body })]))).toContain('TITLE_TOO_SHORT')
    const draft = await rpc(db, W, `select public.knowledge_submit($1::jsonb) as r`, [JSON.stringify({ title: 'Kinh nghiệm chạy 10K đầu tiên!', body: 'ngắn' })])
    expect(draft.status).toBe('DRAFT')
    expect(await fails(rpc(db, W, `select public.knowledge_submit($1::jsonb) as r`, [JSON.stringify({ id: draft.id, title: 'Kinh nghiệm chạy 10K đầu tiên!', body: 'ngắn', submit: true })])))
      .toContain('BODY_TOO_SHORT')
    const sent = await rpc(db, W, `select public.knowledge_submit($1::jsonb) as r`, [JSON.stringify({ id: draft.id, title: 'Kinh nghiệm chạy 10K đầu tiên!', body, submit: true })])
    expect(sent.status).toBe('REVIEW')
    expect(await fails(rpc(db, A1, `select public.knowledge_submit($1::jsonb) as r`, [JSON.stringify({ id: draft.id, title: 'Sửa bài người khác', body })]))).toContain('ARTICLE_NOT_FOUND')
    const mine = await rpc<Row[]>(db, W, `select public.knowledge_my_submissions() as r`)
    expect(mine[0]).toMatchObject({ status: 'REVIEW', reward_xu: 0 })
    expect(mine[0].slug).toMatch(/^kinh-nghiem-chay-10k-dau-tien-[0-9a-f]{5}$/)
    // Tác giả xem trước; người khác không thấy bài chưa đăng
    expect(await rpc(db, W, `select public.knowledge_article($1) as r`, [mine[0].slug])).toMatchObject({ preview: true, community: true })
    expect(await fails(rpc(db, A1, `select public.knowledge_article($1) as r`, [mine[0].slug]))).toContain('ARTICLE_NOT_FOUND')
    const notes = (await db.query<{ n: number }>(`select count(*)::int n from public.notifications where user_id = $1 and kind = 'CONTENT'`, [AD])).rows[0].n
    expect(notes).toBe(1)
    await rpc(db, AD, `select public.cms_set_status($1, 'PUBLISHED') as r`, [draft.id])
    const xu = async () => Number((await db.query<{ s: string }>(`select coalesce(sum(xu), 0) s from public.game_events where user_id = $1 and kind = 'CONTENT'`, [W])).rows[0].s)
    expect(await xu()).toBe(30)
    await rpc(db, AD, `select public.cms_set_status($1, 'ARCHIVED') as r`, [draft.id])
    await rpc(db, AD, `select public.cms_set_status($1, 'PUBLISHED') as r`, [draft.id])
    expect(await xu()).toBe(30)                                     // không cộng lần 2
    expect(await fails(rpc(db, W, `select public.knowledge_delete_submission($1) as r`, [draft.id]))).toContain('ARTICLE_NOT_FOUND')
    expect((await rpc<Row[]>(db, W, `select public.knowledge_my_submissions() as r`))[0]).toMatchObject({ status: 'PUBLISHED', reward_xu: 30 })
  })

  it('ebook cần tệp đính kèm https; tìm admin theo email chỉ dành cho admin', async () => {
    expect(await fails(rpc(db, W, `select public.knowledge_submit($1::jsonb) as r`, [JSON.stringify({ title: 'Ebook giáo án 5K', content_type: 'EBOOK',
      body: 'Giáo án 8 tuần cho người mới bắt đầu, có lịch từng ngày.', submit: true })]))).toContain('BODY_TOO_SHORT')
    const e = await rpc(db, W, `select public.knowledge_submit($1::jsonb) as r`, [JSON.stringify({ title: 'Ebook giáo án 5K', content_type: 'EBOOK',
      attachment_url: 'https://x.supabase.co/storage/v1/object/public/content-media/a.pdf', body: 'Giáo án 8 tuần cho người mới bắt đầu, có lịch từng ngày.', submit: true })])
    expect(e.status).toBe('REVIEW')
    expect(await fails(rpc(db, A1, `select public.admin_find_user_by_email('r3u6@x.vn') as r`))).not.toBe('OK')
    expect(await rpc(db, AD, `select public.admin_find_user_by_email(' R3U6@x.vn ') as r`)).toMatchObject({ id: W, display_name: 'R3 6' })
    expect(await rpc(db, AD, `select public.admin_find_user_by_email('khong-co@x.vn') as r`)).toBeNull()
  })
})
