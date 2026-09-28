import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createDb, asUser } from './load-schema'

// Migration 009400: điểm CLB — ban quản trị tự soạn luật, có phiên bản, BXH điểm, chi tiết điểm từng bài
const [OWN, CAP, MEM, OUT] = ['00000000-0000-0000-0000-0000000094a1', '00000000-0000-0000-0000-0000000094a2',
  '00000000-0000-0000-0000-0000000094a3', '00000000-0000-0000-0000-0000000094a4']
const CLUB = '00000000-0000-0000-0000-0000000094c1'
type Row = Record<string, any>

async function seed(db: PGlite) {
  await db.exec(`
    insert into auth.users (id, email) values ('${OWN}', 'o94@x.vn'), ('${CAP}', 'c94@x.vn'), ('${MEM}', 'm94@x.vn'), ('${OUT}', 'x94@x.vn');
    insert into public.profiles (id, display_name, xu, xp, level, created_at) values
      ('${OWN}', 'Chủ nhiệm', 0, 0, 1, now()), ('${CAP}', 'Quản trị', 0, 0, 1, now()), ('${MEM}', 'Runner', 0, 0, 1, now()), ('${OUT}', 'Người ngoài', 0, 0, 1, now())
      on conflict do nothing;
  `)
}
const rpc = async <T = Row>(db: PGlite, uid: string, sql: string, params: unknown[] = []) => (await asUser<{ r: T }>(db, uid, '/rpc', sql, params)).rows[0]?.r as T
const fails = async (p: Promise<unknown>) => { try { await p } catch (e) { return (e as Error).message } return 'OK' }
// Bài chạy lúc hh:mm giờ VN, n ngày trước
const run = (db: PGlite, uid: string, km: number, daysAgo: number, hhmm: string) =>
  db.query(`insert into public.activities (user_id, title, source, started_at, ended_at, distance_m, moving_time_s, validation_status, status)
            values ($1, $4, 'DIRECT_GPS', (((now() at time zone 'Asia/Ho_Chi_Minh')::date - $3::int) + $5::time) at time zone 'Asia/Ho_Chi_Minh',
                    (((now() at time zone 'Asia/Ho_Chi_Minh')::date - $3::int) + $5::time + interval '1 hour') at time zone 'Asia/Ho_Chi_Minh',
                    $2::numeric, $2::numeric * 0.36, 'APPROVED', 'READY')`, [uid, km * 1000, daysAgo, `${km} km`, hhmm])
const RULES = [
  { name: 'Mỗi buổi từ 5 km', per: 'RUN', points: 10, min_km: 5 },
  { name: 'Chạy sáng sớm', per: 'RUN', points: 5, from_hour: 5, to_hour: 7 },
  { name: 'Mỗi km', per: 'KM', points: 1, min_km: 1 },
]
const board = async (db: PGlite, uid = MEM) => (await rpc<{ rows: Row[] }>(db, uid, `select public.club_points_board($1, 'ALL') as r`, [CLUB])).rows

describe('điểm CLB (009400)', () => {
  let db: PGlite
  beforeAll(async () => {
    db = await createDb({ withMigrations: true, runMigrationsTwice: true, seed })
    await db.exec(`
      insert into public.clubs (id, name, owner_id, invite_code) values ('${CLUB}', 'CLB Điểm', '${OWN}', 'diem941');
      insert into public.club_members (club_id, user_id, role, status) values ('${CLUB}', '${OWN}', 'OWNER', 'APPROVED'),
        ('${CLUB}', '${CAP}', 'CAPTAIN', 'APPROVED'), ('${CLUB}', '${MEM}', 'MEMBER', 'APPROVED') on conflict do nothing;
    `)
    await run(db, MEM, 10, 3, '06:00')      // 10 + 5 + 10 = 25
    await run(db, MEM, 5, 3, '19:00')       // 10 + 0 + 5  = 15 (cùng ngày)
    await run(db, MEM, 2, 2, '20:00')       // 0 + 0 + 2   = 2
  }, 240_000)

  it('chưa có luật: BXH trống; chỉ ban quản trị (chủ nhiệm + quản trị viên) được sửa luật; luật sai bị chặn', async () => {
    expect(await rpc(db, MEM, `select public.club_points_board($1, 'ALL') as r`, [CLUB])).toMatchObject({ has_rules: false, rows: [] })
    expect(await fails(rpc(db, OUT, `select public.club_points_board($1, 'ALL') as r`, [CLUB]))).toContain('NOT_A_MEMBER')
    expect(await fails(rpc(db, MEM, `select public.save_club_point_rules($1, $2::jsonb, 'ALL') as r`, [CLUB, JSON.stringify({ rules: RULES })]))).toContain('FORBIDDEN')
    for (const bad of [[], [{ name: 'x', per: 'RUN', points: 1 }], [{ name: 'Sai', per: 'KM', points: 500 }], [{ name: 'Giờ', per: 'RUN', points: 1, from_hour: 9, to_hour: 7 }],
      [{ name: 'Thứ', per: 'RUN', points: 1, days: [8] }]]) {
      expect(await fails(rpc(db, OWN, `select public.save_club_point_rules($1, $2::jsonb, 'ALL') as r`, [CLUB, JSON.stringify({ rules: bad })]))).toContain('INVALID_RULES')
    }
  })

  it('quản trị viên lưu luật → BXH tự tính; thành viên xem được luật và vì sao được điểm; cả CLB được báo', async () => {
    expect(await rpc<number>(db, CAP, `select public.save_club_point_rules($1, $2::jsonb, 'ALL') as r`, [CLUB, JSON.stringify({ rules: RULES, note: 'Mùa giải mới' })])).toBe(1)
    const b = await board(db)
    expect(b).toEqual([expect.objectContaining({ rank: 1, user_id: MEM, points: 42, runs: 3, me: true })])
    const mine = await rpc<Row[]>(db, MEM, `select public.club_points_mine($1, 'ALL') as r`, [CLUB])
    const first = mine.find((x) => Number(x.km) === 10)!
    expect(Number(first.points)).toBe(25)
    expect(first.hits.map((h: Row) => h.name)).toEqual(['Mỗi buổi từ 5 km', 'Chạy sáng sớm', 'Mỗi km'])
    const rules = await rpc(db, MEM, `select public.club_point_rules_get($1) as r`, [CLUB])
    expect(rules).toMatchObject({ can_edit: false, current: { version: 1, by: 'Quản trị', note: 'Mùa giải mới' } })
    expect((await db.query(`select 1 from public.club_posts where club_id = $1 and title like 'Cập nhật luật tính điểm CLB%'`, [CLUB])).rows).toHaveLength(1)
  })

  it('buổi chạy nhóm có điểm danh, trần điểm ngày, ngày vàng', async () => {
    const ev = (await db.query<{ id: string }>(`insert into public.club_events (club_id, created_by, title, starts_at)
      values ($1, $2, 'Chạy nhóm', (((now() at time zone 'Asia/Ho_Chi_Minh')::date - 2) + time '19:30') at time zone 'Asia/Ho_Chi_Minh') returning id`, [CLUB, OWN])).rows[0].id
    await db.query(`insert into public.club_event_rsvps (event_id, user_id, status, checked_in_at, checkin_method) values ($1, $2, 'GOING', now(), 'QR')`, [ev, MEM])
    await db.query(`insert into public.club_boost_days (club_id, day, multiplier, title) values ($1, (now() at time zone 'Asia/Ho_Chi_Minh')::date - 3, 2, 'Ngày vàng')`, [CLUB])
    await rpc(db, OWN, `select public.save_club_point_rules($1, $2::jsonb, 'ALL') as r`, [CLUB, JSON.stringify({
      rules: [...RULES, { name: 'Đi chạy nhóm', per: 'RUN', points: 20, group_only: true }], daily_cap: 60, use_boost: true })])
    // ngày -3: (25 + 15) × 2 = 80 → trần 60; ngày -2: 2 + 20 (chạy nhóm) = 22
    expect((await board(db))[0].points).toBe(82)
  })

  it('phiên bản: luật mới "từ bây giờ" không đổi điểm bài cũ; tắt luật cho mọi bài thì BXH trống', async () => {
    await rpc(db, OWN, `select public.save_club_point_rules($1, $2::jsonb, 'NOW') as r`, [CLUB, JSON.stringify({ rules: [{ name: 'Chỉ 1 điểm', per: 'RUN', points: 1 }] })])
    expect((await board(db))[0].points).toBe(82)
    await run(db, MEM, 3, 0, '23:59')
    await db.query(`update public.activities set started_at = now() + interval '1 second' where user_id = $1 and distance_m = 3000`, [MEM])
    expect((await board(db))[0].points).toBe(83)
    await rpc(db, OWN, `select public.save_club_point_rules($1, $2::jsonb, 'ALL') as r`, [CLUB, JSON.stringify({ enabled: false, rules: RULES })])
    expect(await board(db)).toEqual([])
    const h = await rpc<{ history: Row[] }>(db, OWN, `select public.club_point_rules_get($1) as r`, [CLUB])
    expect(h.history.map((x) => x.version)).toEqual([4, 3, 2, 1])
  })
})
