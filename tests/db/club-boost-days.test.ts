import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createDb, asUser } from './load-schema'

// Migration 007700: ngày vàng ×2 — nhân km cho thử thách nội bộ CLB + BXH CLB, KHÔNG nhân XP / Xu
const OWN = '00000000-0000-0000-0000-0000000077a1'
const RUN = '00000000-0000-0000-0000-0000000077a2'
const CLUB = '00000000-0000-0000-0000-0000000077c1'
type Row = Record<string, any>
const iso = (h: number) => new Date(Date.now() + h * 3600_000).toISOString()

async function seed(db: PGlite) {
  await db.exec(`
    insert into auth.users (id, email) values ('${OWN}', 'o77@x.vn'), ('${RUN}', 'r77@x.vn');
    insert into public.profiles (id, display_name, xu, xp, level, created_at) values ('${OWN}', 'Chủ nhiệm', 0, 0, 1, now()), ('${RUN}', 'Runner', 0, 0, 1, now())
      on conflict do nothing;
    insert into public.clubs (id, name, owner_id, invite_code) values ('${CLUB}', 'CLB Ngày Vàng', '${OWN}', 'vang771');
    insert into public.club_members (club_id, user_id, role, status) values ('${CLUB}', '${OWN}', 'OWNER', 'APPROVED'), ('${CLUB}', '${RUN}', 'MEMBER', 'APPROVED')
      on conflict do nothing;
  `)
}
const rpc = async <T = Row>(db: PGlite, uid: string, sql: string, params: unknown[] = []) => (await asUser<{ r: T }>(db, uid, '/rpc', sql, params)).rows[0]?.r
const fails = async (p: Promise<unknown>) => { try { await p } catch (e) { return (e as Error).message } return 'OK' }
const today = async (db: PGlite) => (await db.query<{ d: string }>(`select (now() at time zone 'Asia/Ho_Chi_Minh')::date::text as d`)).rows[0].d

describe('ngày vàng của CLB (007700)', () => {
  let db: PGlite
  let ch: string
  beforeAll(async () => {
    db = await createDb({ withMigrations: true, runMigrationsTwice: true, seed })
    ch = (await rpc<{ challenge_id: string }>(db, OWN, `select public.create_challenge_v2($1::jsonb, 'key-771-aaaa') as r`, [JSON.stringify({
      title: 'Tuần vàng', format: 'RANKED', objective: 'DISTANCE', audience: 'CLUB_ONLY', club_id: CLUB, max_slots: 5,
      start_date: iso(-24), end_date: iso(24 * 5),
    })]))!.challenge_id
    await rpc(db, RUN, `select public.join_challenge($1) as r`, [ch])
  }, 240_000)

  it('chỉ ban quản trị đặt; phải từ ngày mai; hệ số hợp lệ; tối đa 4 ngày / tháng', async () => {
    const d = await today(db)
    const plus = (n: number) => new Date(Date.parse(d) + n * 86400_000).toISOString().slice(0, 10)
    expect(await fails(rpc(db, RUN, `select public.set_club_boost_day($1, $2::date, 2, 'Sinh nhật') as r`, [CLUB, plus(3)]))).toContain('FORBIDDEN')
    expect(await fails(rpc(db, OWN, `select public.set_club_boost_day($1, $2::date, 2, 'Hôm nay') as r`, [CLUB, d]))).toContain('BOOST_DAY_TOO_LATE')
    expect(await fails(rpc(db, OWN, `select public.set_club_boost_day($1, $2::date, 5, 'Quá') as r`, [CLUB, plus(3)]))).toContain('INVALID_MULTIPLIER')
    const list = await rpc<Row[]>(db, OWN, `select public.set_club_boost_day($1, $2::date, 2, 'Sinh nhật CLB') as r`, [CLUB, plus(40)])
    expect(list.at(-1)).toMatchObject({ multiplier: 2, title: 'Sinh nhật CLB', editable: true })
    expect((await db.query(`select 1 from public.notifications where user_id = $1 and kind = 'CLUB_BOOST_DAY'`, [RUN])).rows).toHaveLength(1)
    const month = plus(40).slice(0, 8)
    const days = ['20', '21', '22', '23', '24'].filter((x) => x !== plus(40).slice(8)).slice(0, 4)
    for (const day of days.slice(0, 3)) await rpc(db, OWN, `select public.set_club_boost_day($1, $2::date, 1.5, 'Thêm') as r`, [CLUB, month + day])
    expect(await fails(rpc(db, OWN, `select public.set_club_boost_day($1, $2::date, 2, 'Quá nhiều') as r`, [CLUB, month + days[3]]))).toContain('BOOST_DAYS_LIMIT')
  })

  it('km trong ngày vàng nhân ×2 ở thử thách CLB + BXH v2 (km thật giữ nguyên), XP không nhân', async () => {
    await db.query(`insert into public.club_boost_days (club_id, day, multiplier, title) values ($1, ((now() - interval '50 minutes') at time zone 'Asia/Ho_Chi_Minh')::date, 2, 'Hôm nay vàng')`, [CLUB])   // ngày của bài chạy bên dưới (không lệch khi chạy test lúc nửa đêm)
    await db.query(`insert into public.activities (user_id, title, source, started_at, ended_at, distance_m, moving_time_s, validation_status, status)
                    values ($1, 'Chạy ngày vàng', 'DIRECT_GPS', now() - interval '50 minutes', now() - interval '20 minutes', 5000, 1800, 'APPROVED', 'READY')`, [RUN])
    const p = (await db.query<{ current_progress: string }>(`select current_progress from public.challenge_participants where challenge_id = $1 and profile_id = $2`, [ch, RUN])).rows[0]
    expect(Number(p.current_progress)).toBe(10)                             // 5 km thật × 2
    const board = await rpc<Row[]>(db, RUN, `select public.club_leaderboard_v2($1, 'WEEK') as r`, [CLUB])
    expect(board[0]).toMatchObject({ user_id: RUN, rank: 1 })
    expect(Number(board[0].distance_m)).toBe(5000)
    expect(Number(board[0].bonus_m)).toBe(5000)
    const xp = (await db.query<{ earned_xp: string }>(`select earned_xp from public.activities where user_id = $1`, [RUN])).rows[0]
    expect(Number(xp.earned_xp)).toBe(50)                                   // 10 XP / km thật, không nhân
  })
})
