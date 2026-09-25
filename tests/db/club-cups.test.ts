import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createDb, asUser } from './load-schema'

// Migration 003600: Thách đấu CLB (nhiều CLB) — duyệt admin, chỉ ban quản trị CLB đăng ký
const id = (n: number) => `00000000-0000-0000-0000-0000000036${String(n).padStart(2, '0')}`
const [OA, OB, OC, A1, B1, C1, U, AD] = [1, 2, 3, 4, 5, 6, 7, 8].map(id)
const CA = '00000000-0000-0000-0000-0000000036c1', CB = '00000000-0000-0000-0000-0000000036c2', CC = '00000000-0000-0000-0000-0000000036c3'

async function seed(db: PGlite) {
  const users = [OA, OB, OC, A1, B1, C1, U, AD]
  await db.exec(`
    insert into auth.users (id, email) values ${users.map((u, i) => `('${u}', 'cup${i}@x.vn')`).join(', ')};
    insert into public.profiles (id, display_name, xu, xp, level, created_at) values
      ${users.map((u, i) => `('${u}', 'R${i}', 0, 0, 1, now())`).join(', ')} on conflict do nothing;
    insert into public.clubs (id, name, owner_id, invite_code) values
      ('${CA}', 'Hồ Tây', '${OA}', 'cup001'), ('${CB}', 'Sông Hồng', '${OB}', 'cup002'), ('${CC}', 'Tây Hồ', '${OC}', 'cup003');
    insert into public.club_members (club_id, user_id, role, status, joined_at) values
      ('${CA}', '${OA}', 'OWNER', 'APPROVED', now() - interval '30 days'), ('${CA}', '${A1}', 'MEMBER', 'APPROVED', now() - interval '30 days'),
      ('${CB}', '${OB}', 'OWNER', 'APPROVED', now() - interval '30 days'), ('${CB}', '${B1}', 'MEMBER', 'APPROVED', now() - interval '30 days'),
      ('${CB}', '${A1}', 'MEMBER', 'APPROVED', now() - interval '5 days'),
      ('${CC}', '${OC}', 'OWNER', 'APPROVED', now() - interval '30 days'), ('${CC}', '${C1}', 'MEMBER', 'APPROVED', now() - interval '30 days')
      on conflict do nothing;
  `)
}

type Standing = { rank: number; club_id: string; km: number; avg_km: number; runners: number; members: number }
type Cup = { id: string; status: string; clubs: number; standings: Standing[] | null; my_clubs: { id: string; staff: boolean; joined: boolean }[] }
const rpc = async <T,>(db: PGlite, uid: string, sql: string, params: unknown[] = []) => (await asUser<{ r: T }>(db, uid, '/rpc', sql, params)).rows[0].r
const fails = async (p: Promise<unknown>) => { try { await p } catch (e) { return (e as Error).message } return 'OK' }
const notes = async (db: PGlite, uid: string) => (await db.query(`select 1 from public.notifications where user_id = $1 and kind = 'CLUB_CUP'`, [uid])).rows.length
const body = (extra: Record<string, unknown> = {}) => JSON.stringify({ title: 'Cúp Hồ Gươm tháng 11', metric: 'AVG_KM', max_clubs: 10,
  start_at: new Date(Date.now() + 3600_000).toISOString(), end_at: new Date(Date.now() + 7 * 86400_000).toISOString(), ...extra })
const create = `select public.create_club_cup($1::jsonb) as r`

describe('Thách đấu CLB (003600)', () => {
  let db: PGlite
  let userCup = '', hostCup = ''
  beforeAll(async () => {
    db = await createDb({ withMigrations: true, runMigrationsTwice: true, seed })
    await db.query(`update public.profiles set role = 'SYSTEM_ADMIN' where id = $1`, [AD])
  }, 240_000)

  it('người dùng thường tạo → chờ admin duyệt; chưa ai thấy / đăng ký được; admin duyệt → mở', async () => {
    const c = await rpc<Cup>(db, U, create, [body()])
    userCup = c.id
    expect(c.status).toBe('PENDING_REVIEW')
    expect(await notes(db, AD)).toBe(1)
    expect(await rpc<Cup[]>(db, OA, `select public.list_club_cups('ACTIVE') as r`)).toEqual([])
    expect(await fails(rpc(db, OA, `select public.join_club_cup($1, $2) as r`, [userCup, CA]))).toContain('CUP_NOT_FOUND')
    expect(await fails(rpc(db, U, `select public.review_club_cup($1, true) as r`, [userCup]))).toContain('FORBIDDEN')
    expect(await fails(rpc(db, AD, `select public.review_club_cup($1, false, '') as r`, [userCup]))).toContain('REASON_REQUIRED')
    expect((await rpc<Cup[]>(db, AD, `select public.list_club_cups('REVIEW') as r`)).map((x) => x.id)).toEqual([userCup])
    expect((await rpc<Cup>(db, AD, `select public.review_club_cup($1, true) as r`, [userCup])).status).toBe('OPEN')
    expect(await notes(db, U)).toBe(1)
    expect((await rpc<Cup[]>(db, OA, `select public.list_club_cups('ACTIVE') as r`)).map((x) => x.id)).toEqual([userCup])
  })

  it('ban quản trị CLB tạo dưới tên CLB → mở ngay, CLB chủ nhà tự vào; người thường không được gắn CLB', async () => {
    expect(await fails(rpc(db, A1, create, [body({ host_club_id: CA })]))).toContain('FORBIDDEN')
    const c = await rpc<Cup>(db, OA, create, [body({ host_club_id: CA, title: 'Hồ Tây mở rộng' })])
    hostCup = c.id
    expect(c).toMatchObject({ status: 'OPEN', clubs: 1 })
    expect(await rpc<Cup>(db, AD, create, [body({ title: 'Cúp RaceHub' })])).toMatchObject({ status: 'OPEN', clubs: 0 })   // admin: mở ngay
    expect(await fails(rpc(db, U, create, [body({ title: 'x' })]))).toContain('INVALID_TITLE')
  })

  it('chỉ ban quản trị của CLB đó đăng ký CLB; không đăng ký trùng; đủ chỗ thì chặn', async () => {
    const join = `select public.join_club_cup($1, $2) as r`
    expect(await fails(rpc(db, A1, join, [hostCup, CB]))).toContain('CLUB_STAFF_REQUIRED')     // thành viên thường
    expect(await fails(rpc(db, OA, join, [hostCup, CB]))).toContain('CLUB_STAFF_REQUIRED')     // BQT CLB khác
    const c = await rpc<Cup>(db, OB, join, [hostCup, CB])
    expect(c.clubs).toBe(2)
    expect(c.my_clubs.find((m) => m.id === CB)).toMatchObject({ staff: true, joined: true })
    expect(await fails(rpc(db, OB, join, [hostCup, CB]))).toContain('ALREADY_JOINED')
    expect(await notes(db, B1)).toBe(1)                                                         // thành viên CB được báo
    await db.query(`update public.club_cups set max_clubs = 2 where id = $1`, [hostCup])
    expect(await fails(rpc(db, OC, join, [hostCup, CC]))).toContain('CUP_FULL')
    await db.query(`update public.club_cups set max_clubs = 10 where id = $1`, [hostCup])
    await rpc(db, OC, join, [hostCup, CC])
  })

  it('bảng điểm: km trung bình / thành viên; người ở 2 CLB chỉ tính cho CLB vào trước; tất toán + báo hạng', async () => {
    await db.query(`update public.club_cups set start_at = now() - interval '3 days', reg_close_at = now() - interval '3 days', end_at = now() + interval '1 day' where id = $1`, [hostCup])
    const run = (uid: string, km: number) => db.query(`
      insert into public.activities (user_id, title, source, started_at, ended_at, distance_m, moving_distance_m, moving_time_s, avg_pace_s, validation_status, status)
      values ($1, 'Chạy', 'DIRECT_GPS', now() - interval '1 day', now() - interval '1 day' + interval '1 hour', $2::numeric, $2::numeric, 3600, 360, 'APPROVED', 'READY')`, [uid, km * 1000])
    await run(OA, 10); await run(A1, 30)                 // A1 thuộc cả Hồ Tây (vào trước) và Sông Hồng → chỉ tính Hồ Tây
    await run(B1, 12); await run(C1, 50)
    const c = await rpc<Cup>(db, U, `select public.club_cup($1) as r`, [hostCup])
    const by = Object.fromEntries(c.standings!.map((s) => [s.club_id, s]))
    expect(by[CA]).toMatchObject({ members: 2, runners: 2, km: 40, avg_km: 20 })
    expect(by[CB]).toMatchObject({ members: 2, runners: 1, km: 12, avg_km: 6 })              // A1 không tính cho CB
    expect(by[CC]).toMatchObject({ km: 50, avg_km: 25, rank: 1 })
    expect(await fails(rpc(db, OB, `select public.leave_club_cup($1, $2) as r`, [hostCup, CB]))).toContain('CUP_STARTED')

    await db.query(`update public.club_cups set end_at = now() - interval '3 hours' where id = $1`, [hostCup])
    const done = await rpc<Cup>(db, U, `select public.club_cup($1) as r`, [hostCup])
    expect(done.status).toBe('FINISHED')
    expect(done.standings!.map((s) => s.club_id)).toEqual([CC, CA, CB])
    const champion = await db.query<{ title: string }>(`select title from public.notifications where user_id = $1 and kind = 'CLUB_CUP' order by created_at desc`, [C1])
    expect(champion.rows[0].title).toContain('vô địch')
  })

  it('hủy: người tạo / BQT CLB chủ nhà trước giờ bắt đầu', async () => {
    expect(await fails(rpc(db, OB, `select public.cancel_club_cup($1) as r`, [userCup]))).toContain('FORBIDDEN')
    expect((await rpc<Cup>(db, U, `select public.cancel_club_cup($1) as r`, [userCup])).status).toBe('CANCELLED')
  })
})
