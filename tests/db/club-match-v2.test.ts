import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createDb, asUser, sanitize } from './load-schema'

// Migration 012700: thi đấu CLB v2 — trận 1–1 là thách đấu 2 CLB; luật (hình thức, đo bằng, trần, tối thiểu), thương lượng,
// đăng ký + chốt danh sách, kết quả tạm → chính thức, huy hiệu, điểm uy tín, chuyển trận cũ.
const id = (n: number) => `00000000-0000-0000-0000-0000000127${String(n).padStart(2, '0')}`
const [OA, A1, A2, A3, OB, B1, B2, BOTH, OC, C1, LATE, AD] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(id)
const CA = '00000000-0000-0000-0000-0000000127c1', CB = '00000000-0000-0000-0000-0000000127c2', CC = '00000000-0000-0000-0000-0000000127c3'

async function seed(db: PGlite) {
  const users = [OA, A1, A2, A3, OB, B1, B2, BOTH, OC, C1, LATE, AD]
  await db.exec(`
    insert into auth.users (id, email) values ${users.map((u, i) => `('${u}', 'm127_${i}@x.vn')`).join(', ')};
    insert into public.profiles (id, display_name, xu, xp, level, created_at) values
      ${users.map((u, i) => `('${u}', 'V${i}', 0, 0, 1, now())`).join(', ')} on conflict do nothing;
    insert into public.clubs (id, name, owner_id, invite_code) values
      ('${CA}', 'Hồ Tây', '${OA}', 'm12701'), ('${CB}', 'Sông Hồng', '${OB}', 'm12702'), ('${CC}', 'Tây Hồ', '${OC}', 'm12703');
    insert into public.club_members (club_id, user_id, role, status, joined_at) values
      ('${CA}', '${OA}', 'OWNER', 'APPROVED', now() - interval '60 days'), ('${CA}', '${A1}', 'MEMBER', 'APPROVED', now() - interval '60 days'),
      ('${CA}', '${A2}', 'MEMBER', 'APPROVED', now() - interval '60 days'), ('${CA}', '${A3}', 'MEMBER', 'APPROVED', now() - interval '60 days'),
      ('${CA}', '${BOTH}', 'MEMBER', 'APPROVED', now() - interval '60 days'),
      ('${CB}', '${OB}', 'OWNER', 'APPROVED', now() - interval '60 days'), ('${CB}', '${B1}', 'MEMBER', 'APPROVED', now() - interval '60 days'),
      ('${CB}', '${B2}', 'MEMBER', 'APPROVED', now() - interval '60 days'), ('${CB}', '${BOTH}', 'MEMBER', 'APPROVED', now() - interval '50 days'),
      ('${CC}', '${OC}', 'OWNER', 'APPROVED', now() - interval '60 days'), ('${CC}', '${C1}', 'MEMBER', 'APPROVED', now() - interval '60 days')
      on conflict do nothing;
  `)
}

type Standing = { rank: number; club_id: string; score: number | null; members: number; runners: number; km: number; forfeited: boolean; top: { user_id: string }[] }
type Match = {
  id: string; status: string; phase: string; kind: string; awaiting_club_id: string | null; terms_version: number; format: string; top_n: number | null
  negotiation: unknown[] | null; can_respond: boolean; my_signup: string | null; standings: Standing[] | null; winner_id: string | null
  mvp: { user_id: string } | null; decline_reason: string | null; pending_runs: number | null; min_roster: number
  my_clubs: { id: string; eligible: boolean; roster: number }[]
}
const rpc = async <T,>(db: PGlite, uid: string, sql: string, params: unknown[] = []) => (await asUser<{ r: T }>(db, uid, '/rpc', sql, params)).rows[0].r
const fails = async (p: Promise<unknown>) => { try { await p } catch (e) { return (e as Error).message } return 'OK' }
const notes = async (db: PGlite, uid: string, like = '%') =>
  (await db.query<{ title: string; body: string | null }>(`select title, body from public.notifications where user_id = $1 and title like $2 order by created_at`, [uid, like])).rows
const at = (h: number) => new Date(Date.now() + h * 3600_000).toISOString()
const terms = (extra: Record<string, unknown> = {}) => JSON.stringify({ format: 'AVG', measure: 'KM', min_roster: 2, lock_hours: 1,
  start_at: at(48), end_at: at(48 + 7 * 24), ...extra })
const duel = (club: string, opp: string) =>
  `select public.create_club_duel(($1::jsonb || jsonb_build_object('club_id', '${club}', 'opponent_id', '${opp}'))) as r`
const view = `select public.club_cup($1) as r`
const run = (db: PGlite, uid: string, km: number, hoursAgo: number, extra: { source?: string; status?: string; moving?: number } = {}) => db.query(`
  insert into public.activities (user_id, title, source, started_at, ended_at, distance_m, moving_distance_m, moving_time_s, avg_pace_s, validation_status, status)
  values ($1, 'Chạy', $3, now() - make_interval(hours => $4), now() - make_interval(hours => $4) + interval '1 hour', $2::numeric, $2::numeric,
          $5::int, 360, $6, 'READY')`, [uid, km * 1000, extra.source ?? 'DIRECT_GPS', hoursAgo, extra.moving ?? Math.round(km * 360), extra.status ?? 'APPROVED'])

describe('Thi đấu CLB v2 (012700)', () => {
  let db: PGlite
  let m1 = ''
  beforeAll(async () => {
    db = await createDb({ withMigrations: true, runMigrationsTwice: true, seed })
    await db.query(`update public.profiles set role = 'SYSTEM_ADMIN' where id = $1`, [AD])
  }, 300_000)

  it('tạo trận 1–1: chỉ ban quản trị; luật được kiểm tra; đối thủ đề xuất lại → bên kia nhận lời → mời mọi thành viên đăng ký', async () => {
    expect(await fails(rpc(db, A1, duel(CA, CB), [terms()]))).toContain('FORBIDDEN')
    expect(await fails(rpc(db, OA, duel(CA, CB), [terms({ format: 'TOP' })]))).toContain('INVALID_TOP_N')
    expect(await fails(rpc(db, OA, duel(CA, CB), [terms({ start_at: at(1), end_at: at(30) })]))).toContain('LOCK_TOO_SOON')
    expect(await fails(rpc(db, OA, duel(CA, CA), [terms()]))).toContain('INVALID_OPPONENT')

    const m = await rpc<Match>(db, OA, duel(CA, CB), [JSON.stringify({ ...JSON.parse(terms()), message: 'Thua mời cà phê' })])
    m1 = m.id
    expect(m).toMatchObject({ kind: 'DUEL', status: 'INVITED', awaiting_club_id: CB, terms_version: 1 })
    expect((await notes(db, OB, '%thách đấu%')).length).toBe(1)
    expect(await fails(rpc(db, OA, duel(CA, CB), [terms()]))).toContain('BATTLE_EXISTS')
    expect(await fails(rpc(db, OA, `select public.respond_club_duel($1, 'ACCEPT') as r`, [m1]))).toContain('FORBIDDEN')

    // Sông Hồng đề xuất lại: top 2 VĐV, bắt đầu muộn hơn
    const c = await rpc<Match>(db, OB, `select public.respond_club_duel($1, 'COUNTER', $2::jsonb) as r`,
      [m1, terms({ format: 'TOP', top_n: 2, start_at: at(72), end_at: at(72 + 7 * 24), note: 'Đấu top 2 cho máu' })])
    expect(c).toMatchObject({ status: 'INVITED', awaiting_club_id: CA, terms_version: 2, format: 'TOP', top_n: 2 })
    expect(c.negotiation).toHaveLength(2)
    expect((await notes(db, OA, '%đề xuất lại%')).length).toBe(1)
    expect(await fails(rpc(db, OB, `select public.respond_club_duel($1, 'ACCEPT') as r`, [m1]))).toContain('FORBIDDEN')

    const ok = await rpc<Match>(db, OA, `select public.respond_club_duel($1, 'ACCEPT') as r`, [m1])
    expect(ok.status).toBe('OPEN')
    expect(ok.phase).toBe('REGISTRATION')
    // Mọi thành viên hai CLB được mời đăng ký, có link tới trang trận
    for (const u of [A1, A2, B1, B2]) expect((await notes(db, u, '%đăng ký thi đấu%')).length).toBe(1)
    expect((await db.query(`select 1 from public.notifications where user_id = $1 and link = $2`, [B1, `/cups/${m1}`])).rows.length).toBeGreaterThan(0)
  })

  it('đăng ký: chỉ người vào CLB trước khi tạo trận; mỗi người một CLB; giới hạn số VĐV', async () => {
    await db.query(`insert into public.club_members (club_id, user_id, role, status, joined_at) values ($1, $2, 'MEMBER', 'APPROVED', now())`, [CA, LATE])
    expect(await fails(rpc(db, LATE, `select public.join_cup_as_member($1, $2) as r`, [m1, CA]))).toContain('JOINED_CLUB_TOO_LATE')
    const v = await rpc<Match>(db, LATE, view, [m1])
    expect(v.my_clubs.find((c) => c.id === CA)?.eligible).toBe(false)

    for (const u of [A1, A2]) await rpc(db, u, `select public.join_cup_as_member($1, $2) as r`, [m1, CA])
    await rpc(db, B1, `select public.join_cup_as_member($1, $2) as r`, [m1, CB])
    await rpc(db, BOTH, `select public.join_cup_as_member($1, $2) as r`, [m1, CB])
    expect(await fails(rpc(db, BOTH, `select public.join_cup_as_member($1, $2) as r`, [m1, CA]))).toContain('ALREADY_SIGNED_UP')

    await db.query(`update public.club_cups set max_roster = 3 where id = $1`, [m1])         // OA (tự đăng ký khi tạo) + A1 + A2 = 3
    expect(await fails(rpc(db, A3, `select public.join_cup_as_member($1, $2) as r`, [m1, CA]))).toContain('ROSTER_FULL')
    await db.query(`update public.club_cups set max_roster = null where id = $1`, [m1])

    const mine = await rpc<Match[]>(db, A1, `select public.my_club_matches() as r`)
    expect(mine.find((x) => x.id === m1)?.my_signup).toBe(CA)
    const sum = await rpc<{ active: Match[] }>(db, B2, `select public.club_match_summary($1) as r`, [CB])
    expect(sum.active.map((x) => x.id)).toContain(m1)
  })

  it('chốt danh sách → tính điểm top 2, trần 42 km/ngày, bài Strava ẩn / người chưa đăng ký không tính → kết quả tạm → chính thức + thưởng', async () => {
    await db.query(`update public.club_cups set start_at = now() - interval '3 days', roster_close_at = now() - interval '3 days 1 hour',
                    reg_close_at = now() - interval '3 days', end_at = now() + interval '1 day' where id = $1`, [m1])
    const live = await rpc<Match>(db, A1, view, [m1])
    expect(live.phase).toBe('LIVE')
    expect(await fails(rpc(db, A1, `select public.leave_cup_as_member($1) as r`, [m1]))).toContain('ROSTER_LOCKED')
    expect(await fails(rpc(db, A3, `select public.join_cup_as_member($1, $2) as r`, [m1, CA]))).toContain('ROSTER_LOCKED')
    expect((await notes(db, A1, 'Đã chốt danh sách%')).length).toBe(1)

    await run(db, A1, 50, 50); await run(db, A1, 10, 26)     // 50 → 42 (trần ngày) + 10 = 52
    await run(db, A2, 20, 26); await run(db, OA, 5, 26)        // top 2 Hồ Tây = 52 + 20 = 72
    await run(db, B1, 30, 30); await run(db, BOTH, 25, 26)      // top 2 Sông Hồng = 55
    await run(db, B2, 100, 26)                                  // chưa đăng ký → không tính
    await db.query(`insert into public.profile_settings (user_id, strava_share) values ($1, false)
                    on conflict (user_id) do update set strava_share = false`, [B1])
    await run(db, B1, 40, 20, { source: 'STRAVA' })             // tắt "Hiện bài Strava" → không tính
    await run(db, B1, 15, 10, { status: 'PENDING' })            // đang chờ duyệt
    const s = (await rpc<Match>(db, OB, view, [m1]))
    const by = Object.fromEntries(s.standings!.map((x) => [x.club_id, x]))
    expect(by[CA]).toMatchObject({ rank: 1, score: 72, members: 3, runners: 3 })
    expect(by[CB]).toMatchObject({ rank: 2, score: 55, members: 2, runners: 2 })
    expect(s.pending_runs).toBe(1)
    const board = await rpc<{ rows: { user_id: string; km: number; raw_km: number; counted: boolean }[] }>(db, B1,
      `select public.club_cup_club_board($1, $2) as r`, [m1, CA])
    expect(board.rows.find((r) => r.user_id === A1)).toMatchObject({ km: 52, raw_km: 60, counted: true })
    expect(board.rows.find((r) => r.user_id === OA)?.counted).toBe(false)          // ngoài top 2

    // Hết giờ → kết quả tạm; ban quản trị Sông Hồng được báo 1 bài đang chờ duyệt
    await db.query(`update public.club_cups set end_at = now() - interval '1 hour' where id = $1`, [m1])
    expect((await rpc<Match>(db, A1, view, [m1])).status).toBe('PROVISIONAL')
    expect((await notes(db, OB, '%đang chờ duyệt%')).length).toBe(1)
    expect((await notes(db, A2, 'Kết quả tạm%')).length).toBe(1)

    // Sau 48 giờ → chính thức: Hồ Tây thắng, MVP A1, huy hiệu, điểm uy tín, danh hiệu vô địch
    await db.query(`update public.club_cups set final_delay_hours = 0 where id = $1`, [m1])     // giả lập đã qua 48 giờ chờ
    const done = await rpc<Match>(db, B1, view, [m1])
    expect(done).toMatchObject({ status: 'FINISHED', winner_id: CA })
    expect(done.mvp?.user_id).toBe(A1)
    const badges = await db.query<{ user_id: string; code: string }>(`select ua.user_id, a.code from public.user_achievements ua
      join public.achievements a on a.id = ua.achievement_id where a.code like 'CLUB_MATCH_%' order by 2, 1`)
    expect(badges.rows.filter((b) => b.code === 'CLUB_MATCH_WIN').map((b) => b.user_id).sort()).toEqual([OA, A1, A2].sort())
    expect(badges.rows.filter((b) => b.code === 'CLUB_MATCH_MVP').map((b) => b.user_id)).toEqual([A1])
    const ratings = await db.query<{ club_id: string; rating: number; wins: number; losses: number }>(`select club_id, rating, wins, losses from public.club_match_ratings order by rating desc`)
    expect(ratings.rows).toEqual([{ club_id: CA, rating: 1016, wins: 1, losses: 0 }, { club_id: CB, rating: 984, wins: 0, losses: 1 }])
    const sum = await rpc<{ champion: { cup_id: string } | null; rating: { rating: number; streak: number } }>(db, A3, `select public.club_match_summary($1) as r`, [CA])
    expect(sum.champion?.cup_id).toBe(m1)
    expect(sum.rating).toMatchObject({ rating: 1016, streak: 1 })
    expect((await rpc<{ club_id: string }[]>(db, C1, `select public.club_duel_ladder() as r`)).map((x) => x.club_id)).toEqual([CA, CB])
    expect((await notes(db, B2, 'Kết quả chính thức%')).length).toBe(1)
  })

  it('từ chối kèm lý do; lời mời quá hạn; thiếu VĐV lúc chốt → xử thua (hoặc hủy nếu cả hai thiếu)', async () => {
    const d = await rpc<Match>(db, OA, duel(CA, CC), [terms()])
    const no = await rpc<Match>(db, OC, `select public.respond_club_duel($1, 'DECLINE', '{"note": "Tuần này CLB đi giải"}'::jsonb) as r`, [d.id])
    expect(no).toMatchObject({ status: 'DECLINED', decline_reason: 'Tuần này CLB đi giải' })
    expect((await notes(db, OA, '%từ chối%'))[0].body).toContain('đi giải')

    const ex = await rpc<Match>(db, OA, duel(CA, CC), [terms()])
    await db.query(`update public.club_cups set roster_close_at = now() - interval '1 minute' where id = $1`, [ex.id])
    expect((await rpc<Match>(db, OC, view, [ex.id])).status).toBe('EXPIRED')

    const f = await rpc<Match>(db, OA, duel(CA, CC), [terms({ forfeit_rule: 'FORFEIT' })])
    await rpc(db, OC, `select public.respond_club_duel($1, 'ACCEPT') as r`, [f.id])        // OC tự vào danh sách Tây Hồ (1 < 2)
    await rpc(db, A3, `select public.join_cup_as_member($1, $2) as r`, [f.id, CA])          // Hồ Tây: OA + A3 = 2
    await db.query(`update public.club_cups set start_at = now() - interval '4 days', roster_close_at = now() - interval '4 days 1 hour',
                    reg_close_at = now() - interval '4 days', end_at = now() - interval '1 hour', final_delay_hours = 0 where id = $1`, [f.id])
    await run(db, OC, 30, 30); await run(db, C1, 30, 28)   // Tây Hồ chạy nhiều hơn nhưng thiếu người → xử thua
    const r = await rpc<Match>(db, A3, view, [f.id])
    expect(r.status).toBe('FINISHED')
    expect(r.winner_id).toBe(CA)
    expect(r.standings!.find((x) => x.club_id === CC)?.forfeited).toBe(true)

    const both = await rpc<Match>(db, OB, duel(CB, CC), [terms({ min_roster: 5 })])
    await rpc(db, OC, `select public.respond_club_duel($1, 'ACCEPT') as r`, [both.id])
    await db.query(`update public.club_cups set roster_close_at = now() - interval '1 minute' where id = $1`, [both.id])
    expect((await rpc<Match>(db, OB, view, [both.id])).status).toBe('CANCELLED')
  })

  it('đo bằng pace (đủ km tối thiểu mới xét) và thời gian; trần đóng góp % tổng đội', async () => {
    const mk = async (measure: string, extra = '') => (await db.query<{ id: string }>(`
      insert into public.club_cups (kind, rules_version, title, metric, start_at, end_at, reg_close_at, max_clubs, host_club_id, opponent_club_id,
                                    status, require_signup, format, measure, min_roster, lock_hours, roster_close_at, locked_at, pace_min_km ${extra ? ', ' + extra.split('=')[0] : ''})
      values ('DUEL', 2, 'Thử ${measure}', 'AVG_KM', now() - interval '30 days', now() - interval '25 days', now() - interval '30 days', 2, '${CA}', '${CB}',
              'OPEN', true, 'AVG', '${measure}', 1, 0, now() - interval '30 days', now(), 5 ${extra ? ', ' + extra.split('=')[1] : ''})
      returning id`)).rows[0].id
    const pace = await mk('PACE')
    for (const [c, u] of [[CA, A1], [CA, A2], [CB, B1], [CB, B2]]) {
      await db.query(`insert into public.club_cup_entries (cup_id, club_id) values ($1, $2) on conflict do nothing`, [pace, c])
      await db.query(`insert into public.club_cup_members (cup_id, user_id, club_id) values ($1, $2, $3)`, [pace, u, c])
    }
    await run(db, A1, 10, 28 * 24, { moving: 3000 })     // 5:00/km
    await run(db, A2, 2, 28 * 24, { moving: 480 })       // 4:00/km nhưng < 5 km → không xét
    await run(db, B1, 10, 28 * 24, { moving: 2700 })     // 4:30/km
    await run(db, B2, 10, 28 * 24, { moving: 3300 })     // 5:30/km → đội B 5:00/km
    const s = await rpc<Match>(db, OA, view, [pace])
    const by = Object.fromEntries(s.standings!.map((x) => [x.club_id, x]))
    expect(by[CA].score).toBe(300)
    expect(by[CB].score).toBe(300)
    // Cùng pace 5:00/km, cùng 2 người chạy (tiêu chí phụ) → đồng hạng
    expect([by[CA].rank, by[CB].rank]).toEqual([1, 1])

    const time = await mk('TIME', 'share_cap_pct=40')
    for (const [c, u] of [[CA, A1], [CA, A2], [CB, B1]]) {
      await db.query(`insert into public.club_cup_entries (cup_id, club_id) values ($1, $2) on conflict do nothing`, [time, c])
      await db.query(`insert into public.club_cup_members (cup_id, user_id, club_id) values ($1, $2, $3)`, [time, u, c])
    }
    const t = await rpc<Match>(db, OA, view, [time])
    const tb = Object.fromEntries(t.standings!.map((x) => [x.club_id, x]))
    // Hồ Tây: A1 3000 s, A2 480 s → tổng 3480, mỗi người tối đa 40% = 1392 → 1392 + 480 = 1872, chia 2 người = 936
    expect(tb[CA].score).toBe(936)
    expect(tb[CB].score).toBe(1080)                 // B1 một mình: 2700 → tối đa 40% = 1080
  })

  it('trận "CLB đấu CLB" cũ được chuyển sang: giữ id, mọi thành viên được tính, chốt sau 2 giờ; hàm cũ không tạo trận nữa', async () => {
    const legacy = '00000000-0000-0000-0000-00000012b001'
    await db.query(`insert into public.club_battles (id, challenger_id, opponent_id, metric, start_at, end_at, status, created_by, created_at)
                    values ($1, $2, $3, 'TOTAL_KM', now() - interval '10 days', now() + interval '1 day', 'ACCEPTED', $4, now() - interval '12 days')`,
      [legacy, CB, CC, OB])
    await db.exec(sanitize(fs.readFileSync(path.resolve(__dirname, '../../supabase/migrations/20261001012700_club_match_v2.sql'), 'utf8')))
    const m = await rpc<Match>(db, C1, view, [legacy])
    expect(m).toMatchObject({ kind: 'DUEL', status: 'OPEN' })
    expect(m.standings!.find((x) => x.club_id === CC)?.members).toBe(2)            // không cần đăng ký
    await db.query(`update public.club_cups set end_at = now() - interval '3 hours' where id = $1`, [legacy])
    expect((await rpc<Match>(db, C1, view, [legacy])).status).toBe('FINISHED')
    expect(await fails(rpc(db, OB, `select public.create_club_battle($1, $2, 'AVG_KM', now() + interval '1 day', now() + interval '8 days') as r`, [CB, CC])))
      .toContain('FEATURE_MOVED')
    expect(await rpc<unknown[]>(db, OB, `select public.club_battles_of($1) as r`, [CB])).toEqual([])
  })
})
