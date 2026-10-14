import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createDb, asUser } from './load-schema'

// Migration 016000: giải online "Giao lưu các CLB" — bài tối thiểu + dải pace, ngưỡng hợp lệ mỗi thành viên, CLB cần đủ % thành viên
// hợp lệ mới được xếp hạng, giới hạn số runner đăng ký, CLB chờ ban tổ chức duyệt, BXH cá nhân, link form nhận giải.
const id = (n: number) => `00000000-0000-0000-0000-0000000160${String(n).padStart(2, '0')}`
const [OA, A1, A2, OB, B1, B2, OC, OD, AD, C1] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(id)
const CA = '00000000-0000-0000-0000-0000000160c1', CB = '00000000-0000-0000-0000-0000000160c2'
const CC = '00000000-0000-0000-0000-0000000160c3', CD = '00000000-0000-0000-0000-0000000160c4'

async function seed(db: PGlite) {
  const users = [OA, A1, A2, OB, B1, B2, OC, OD, AD, C1]
  await db.exec(`
    insert into auth.users (id, email) values ${users.map((u, i) => `('${u}', 'lg${i}@x.vn')`).join(', ')};
    insert into public.profiles (id, display_name, xu, xp, level, created_at) values
      ${users.map((u, i) => `('${u}', 'L${i}', 0, 0, 1, now())`).join(', ')} on conflict do nothing;
    insert into public.clubs (id, name, owner_id, invite_code) values
      ('${CA}', 'Hồ Tây', '${OA}', 'lg0001'), ('${CB}', 'Sông Hồng', '${OB}', 'lg0002'), ('${CC}', 'Tây Hồ', '${OC}', 'lg0003'), ('${CD}', 'Nhỏ xíu', '${OD}', 'lg0004');
    insert into public.club_members (club_id, user_id, role, status, joined_at) values
      ('${CA}', '${OA}', 'OWNER', 'APPROVED', now() - interval '60 days'), ('${CA}', '${A1}', 'MEMBER', 'APPROVED', now() - interval '60 days'),
      ('${CA}', '${A2}', 'MEMBER', 'APPROVED', now() - interval '60 days'),
      ('${CB}', '${OB}', 'OWNER', 'APPROVED', now() - interval '60 days'), ('${CB}', '${B1}', 'MEMBER', 'APPROVED', now() - interval '60 days'),
      ('${CB}', '${B2}', 'MEMBER', 'APPROVED', now() - interval '60 days'),
      ('${CC}', '${OC}', 'OWNER', 'APPROVED', now() - interval '60 days'), ('${CC}', '${C1}', 'MEMBER', 'APPROVED', now() - interval '60 days'), ('${CD}', '${OD}', 'OWNER', 'APPROVED', now() - interval '60 days')
      on conflict do nothing;
  `)
}

type Standing = { rank: number; club_id: string; score: number; members: number; valid: number; eligible: boolean; km: number }
type Cup = {
  id: string; status: string; clubs: number; winner_id: string | null; standings: Standing[] | null
  my_clubs: { id: string; joined: boolean; approved: boolean }[]
  league: null | {
    signed_runners: number; max_runners: number; has_reward_form: boolean; reward_form_url: string | null
    pending_clubs: { club_id: string; members: number }[] | null; my_prize: { qualified: boolean } | null
  }
}
type Board = { rows: { rank: number; user_id: string; km: number; valid: boolean; club_id: string }[]; total: number }
const rpc = async <T,>(db: PGlite, uid: string, sql: string, params: unknown[] = []) => (await asUser<{ r: T }>(db, uid, '/rpc', sql, params)).rows[0].r
const fails = async (p: Promise<unknown>) => { try { await p } catch (e) { return (e as Error).message } return 'OK' }
const at = (h: number) => new Date(Date.now() + h * 3600_000).toISOString()
const run = (db: PGlite, uid: string, km: number, hoursAgo: number, pace = 360) => db.query(`
  insert into public.activities (user_id, title, source, started_at, ended_at, distance_m, moving_distance_m, moving_time_s, avg_pace_s, validation_status, status)
  values ($1, 'Chạy', 'DIRECT_GPS', now() - make_interval(hours => $3), now() - make_interval(hours => $3) + interval '1 hour', $2::numeric, $2::numeric,
          ($2::numeric / 1000 * $4)::int, $4, 'APPROVED', 'READY')`, [uid, km * 1000, hoursAgo, pace])
const body = (extra: Record<string, unknown> = {}) => JSON.stringify({
  title: 'Giao lưu các CLB', format: 'AVG', measure: 'KM', min_roster: 2, lock_hours: 1, max_clubs: 10,
  start_at: at(48), end_at: at(48 + 30 * 24), min_run_km: 1, min_pace: 3, max_pace: 15, member_min_km: 10, min_valid_pct: 60,
  max_runners: 5, require_club_approval: true, prize_top_clubs: 2, prize_top_runners: 1, ...extra })
const create = `select public.create_club_cup($1::jsonb) as r`
const join = `select public.join_club_cup($1, $2) as r`
const member = `select public.join_cup_as_member($1, $2) as r`
const review = `select public.review_cup_club($1, $2, $3, $4) as r`
const view = `select public.club_cup($1) as r`

describe('Giải online Giao lưu các CLB (016000)', () => {
  let db: PGlite
  let cup = ''
  beforeAll(async () => {
    db = await createDb({ withMigrations: true, runMigrationsTwice: true, seed })
    await db.query(`update public.profiles set role = 'SYSTEM_ADMIN' where id = $1`, [AD])
  }, 300_000)

  it('tạo giải: luật giải online được kiểm tra và lưu', async () => {
    expect(await fails(rpc(db, AD, create, [body({ min_pace: 15, max_pace: 3 })]))).toContain('INVALID_LEAGUE')
    expect(await fails(rpc(db, AD, create, [body({ reward_form_url: 'http://x.vn/form' })]))).toContain('INVALID_FORM_URL')
    const c = await rpc<Cup>(db, AD, create, [body()])
    cup = c.id
    expect(c.status).toBe('OPEN')
    expect(c.league).toMatchObject({ max_runners: 5, signed_runners: 0, has_reward_form: false })
    // Giải thường không có phần league
    expect((await rpc<Cup>(db, AD, create, [JSON.stringify({ title: 'Giải thường', start_at: at(48), end_at: at(120) })])).league).toBeNull()
  })

  it('CLB đăng ký vào hàng chờ: phải đủ thành viên; ban tổ chức duyệt / từ chối; chưa duyệt thì chưa đăng ký thi đấu được', async () => {
    expect(await fails(rpc(db, OD, join, [cup, CD]))).toContain('CLUB_TOO_SMALL')             // 1 thành viên < 2
    const pending = await rpc<Cup>(db, OA, join, [cup, CA])
    expect(pending.my_clubs.find((m) => m.id === CA)).toMatchObject({ joined: true, approved: false })
    expect(pending.clubs).toBe(0)                                                              // chưa duyệt thì chưa tính
    expect(await fails(rpc(db, A1, member, [cup, CA]))).toContain('CLUB_PENDING_APPROVAL')
    expect(await fails(rpc(db, OA, review, [cup, CA, true, null]))).toContain('FORBIDDEN')    // CLB không tự duyệt mình
    const seen = await rpc<Cup>(db, AD, view, [cup])
    expect(seen.league?.pending_clubs?.map((p) => [p.club_id, p.members])).toEqual([[CA, 3]])

    const ok = await rpc<Cup>(db, AD, review, [cup, CA, true, null])
    expect(ok.clubs).toBe(1)
    expect(ok.league?.pending_clubs).toEqual([])
    expect(ok.league?.signed_runners).toBe(1)                                                  // OA tự có tên khi CLB được duyệt
    await rpc(db, A1, member, [cup, CA])
    await rpc(db, A2, member, [cup, CA])

    await rpc(db, OB, join, [cup, CB])
    await rpc(db, AD, review, [cup, CB, true, null])
    await rpc(db, OC, join, [cup, CC])
    expect(await fails(rpc(db, AD, review, [cup, CC, false, '']))).toContain('REASON_REQUIRED')
    const rej = await rpc<Cup>(db, AD, review, [cup, CC, false, 'Chưa đủ thành viên thật'])
    expect(rej.league?.pending_clubs).toEqual([])
    expect(await fails(rpc(db, AD, review, [cup, CC, true, null]))).toContain('ENTRY_NOT_PENDING')
  })

  it('giới hạn runner đăng ký: đủ thì chặn người mới, người đã đăng ký không bị ảnh hưởng', async () => {
    await rpc(db, B1, member, [cup, CB])
    const full = await rpc<Cup>(db, AD, view, [cup])
    expect(full.league?.signed_runners).toBe(5)                                                // OA, A1, A2, OB, B1
    expect(await fails(rpc(db, B2, member, [cup, CB]))).toContain('RUNNERS_FULL')
    expect(await fails(rpc(db, A1, member, [cup, CA]))).toBe('OK')                             // đã đăng ký: gọi lại không lỗi
    // Một người rút → còn chỗ cho người kế tiếp
    await rpc(db, B1, `select public.leave_cup_as_member($1) as r`, [cup])
    await rpc(db, B2, member, [cup, CB])
    await rpc(db, B1, member, [cup, CB]).then(() => { throw new Error('phải đầy') }, (e: Error) => expect(e.message).toContain('RUNNERS_FULL'))
    await rpc(db, B2, `select public.leave_cup_as_member($1) as r`, [cup])
    await rpc(db, B1, member, [cup, CB])
  })

  it('kết quả: bài dưới 1 km / pace ngoài 3–15 không tính; CLB thiếu % hợp lệ xếp sau và không thể vô địch; BXH cá nhân', async () => {
    await db.query(`update public.club_cups set reg_close_at = now() - interval '10 days', start_at = now() - interval '10 days', roster_close_at = now() - interval '10 days 1 hour',
      end_at = now() - interval '1 hour', locked_at = now() - interval '9 days' where id = $1`, [cup])
    await run(db, OA, 12, 120); await run(db, A1, 12, 120)
    await run(db, A2, 0.5, 120)                    // dưới 1 km: bỏ
    await run(db, OB, 30, 100)
    await run(db, B1, 4, 100); await run(db, B1, 6, 90, 120)   // pace 2:00/km < 3: bỏ
    await run(db, B1, 5, 80, 1000)                 // pace 16:40/km > 15: bỏ

    const c = await rpc<Cup>(db, AD, view, [cup])
    expect(c.status).toBe('PROVISIONAL')
    const [first, second] = c.standings!
    expect(first).toMatchObject({ club_id: CA, rank: 1, eligible: true, valid: 2, members: 3, km: 24, score: 8 })
    // Sông Hồng có điểm TB cao hơn (17) nhưng chỉ 1/2 = 50% < 60% thành viên đạt 10 km → xếp sau
    expect(second).toMatchObject({ club_id: CB, rank: 2, eligible: false, valid: 1, km: 34, score: 17 })

    const board = await rpc<Board>(db, A2, `select public.club_cup_runner_board($1) as r`, [cup])
    expect(board.total).toBe(5)
    expect(board.rows.map((r) => [r.user_id, r.km, r.valid])).toEqual([[OB, 30, true], [OA, 12, true], [A1, 12, true], [B1, 4, false], [A2, 0, false]])
    expect(await fails(rpc(db, OC, `select public.club_cup_runner_board($1, 2) as r`, [cup]))).toBe('OK')
  })

  it('kết thúc chính thức: CLB không đủ điều kiện không thắng; link form nhận giải chỉ hiện cho người đạt giải và ban tổ chức', async () => {
    expect(await fails(rpc(db, A1, `select public.set_cup_reward_form($1, 'https://forms.gle/abc') as r`, [cup]))).toContain('FORBIDDEN')
    expect(await fails(rpc(db, AD, `select public.set_cup_reward_form($1, 'ftp://x') as r`, [cup]))).toContain('INVALID_FORM_URL')
    const set = await rpc<Cup>(db, AD, `select public.set_cup_reward_form($1, 'https://forms.gle/abc') as r`, [cup])
    expect(set.league).toMatchObject({ has_reward_form: true, reward_form_url: 'https://forms.gle/abc' })
    expect((await rpc<Cup>(db, A1, view, [cup])).league).toMatchObject({ has_reward_form: true, reward_form_url: null })   // chưa kết thúc

    await db.query(`update public.club_cups set final_delay_hours = 0 where id = $1`, [cup])
    const fin = await rpc<Cup>(db, OA, view, [cup])
    expect(fin.status).toBe('FINISHED')
    expect(fin.winner_id).toBe(CA)
    expect(fin.league?.reward_form_url).toBe('https://forms.gle/abc')                         // OA: CLB hạng 1, 12 km ≥ 10
    expect((await rpc<Cup>(db, A1, view, [cup])).league?.my_prize?.qualified).toBe(true)
    expect((await rpc<Cup>(db, OB, view, [cup])).league?.reward_form_url).toBe('https://forms.gle/abc')   // cá nhân hạng 1 (30 km)
    expect((await rpc<Cup>(db, B1, view, [cup])).league?.reward_form_url).toBeNull()           // CLB không đủ điều kiện, 4 km
    expect((await rpc<Cup>(db, A2, view, [cup])).league?.reward_form_url).toBeNull()           // chưa đạt km hợp lệ
  })
})
