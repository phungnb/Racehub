import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createDb, asUser } from './load-schema'

// Migration 006100: Runner Nearby — quyền riêng tư vị trí, gợi ý, kết nối, chặn / báo cáo, buổi chạy công khai
const id = (n: number) => `00000000-0000-0000-0000-0000000061${String(n).padStart(2, '0')}`
const [A, B, C, D, E, ADM] = [1, 2, 3, 4, 5, 6].map(id)
const CLUB = '00000000-0000-0000-0000-0000000061c1'
const EV = '00000000-0000-0000-0000-0000000061e1'

async function seed(db: PGlite) {
  const users = [A, B, C, D, E, ADM]
  const names = ['Nguyễn Văn An', 'Trần Thị Bình', 'Lê Minh Châu', 'Phạm Dũng', 'Hoàng Em', 'Admin']
  await db.exec(`
    insert into auth.users (id, email) values ${users.map((u, i) => `('${u}', 'n${i}@x.vn')`).join(', ')};
    insert into public.profiles (id, display_name, xu, xp, level, created_at) values
      ${users.map((u, i) => `('${u}', '${names[i]}', 0, 0, 1, now())`).join(', ')} on conflict do nothing;
    insert into public.clubs (id, name, owner_id, invite_code) values ('${CLUB}', 'Hồ Tây Runners', '${C}', 'htr061');
  `)
}
type Row = Record<string, any>
const rpc = async <T = Row>(db: PGlite, uid: string, sql: string, params: unknown[] = []) => (await asUser<{ r: T }>(db, uid, '/rpc', sql, params)).rows[0]?.r
const fails = async (p: Promise<unknown>) => { try { await p } catch (e) { return (e as Error).message } return 'OK' }
const on = (db: PGlite, u: string, extra: object = {}) => rpc(db, u, `select public.set_discovery($1::jsonb) as r`, [JSON.stringify({ enabled: true, consent: true, ...extra })])
const at = (db: PGlite, u: string, lat: number, lng: number) => rpc(db, u, `select public.set_presence($1, $2, 'DEVICE', 'Tây Hồ', 168) as r`, [lat, lng])
const near = (db: PGlite, u: string, p: object = {}) => rpc<Row>(db, u, `select public.nearby_runners($1::jsonb) as r`, [JSON.stringify(p)])
const runs = async (db: PGlite, u: string, n: number, pace: number) => {
  for (let k = 0; k < n; k++) await db.query(`
    insert into public.activities (user_id, title, source, started_at, ended_at, distance_m, moving_distance_m, moving_time_s, avg_pace_s, validation_status, status)
    values ($1, 'Chạy', 'STRAVA', now() - make_interval(days => $2::int), now() - make_interval(days => $2::int) + interval '40 minutes', 5000, 5000, $3::int, $4::int, 'APPROVED', 'READY')`,
    [u, k + 1, pace * 5, pace])
}

describe('Runner Nearby (006100)', () => {
  let db: PGlite
  beforeAll(async () => {
    db = await createDb({ withMigrations: true, runMigrationsTwice: true, seed })
    await db.query(`update public.profiles set role = 'SYSTEM_ADMIN' where id = $1`, [ADM])
    await db.query(`update public.profiles set gender = case when id in ($1, $2) then 'female' else 'male' end`, [B, E])
    await runs(db, A, 3, 360); await runs(db, B, 3, 370); await runs(db, C, 4, 300); await runs(db, E, 3, 480); await runs(db, D, 1, 360)
    await db.exec(`insert into public.club_members (club_id, user_id, role, status) values ('${CLUB}', '${C}', 'OWNER', 'APPROVED') on conflict do nothing;`)
  }, 240_000)

  it('bật cần đồng ý + ≥ 3 bài hợp lệ; vị trí chỉ lưu ô ~1 km; đổi vị trí ≤ 3 lần / 24 giờ', async () => {
    expect(await fails(rpc(db, A, `select public.set_discovery('{"enabled": true}'::jsonb) as r`))).toContain('CONSENT_REQUIRED')
    expect(await fails(on(db, D))).toContain('NOT_ELIGIBLE')
    expect(await on(db, A, { goals: ['10K'], time_slots: ['EARLY'] })).toMatchObject({ enabled: true, eligible: true, visible_to: 'VERIFIED', valid_runs: 3 })
    await at(db, A, 21.06789, 105.82345)
    const cell = (await db.query<Row>(`select cell_lat::float8 as la, cell_lng::float8 as ln from public.runner_location_presence where user_id = $1`, [A])).rows[0]
    expect(cell).toEqual({ la: 21.07, ln: 105.82 })                                   // không lưu toạ độ gốc
    await at(db, A, 21.08, 105.83); await at(db, A, 21.09, 105.84); await at(db, A, 21.07, 105.82)
    expect(await fails(at(db, A, 21.20, 105.90))).toContain('TOO_MANY_MOVES')
    expect(await fails(rpc(db, A, `select * from public.runner_location_presence`))).toMatch(/permission|denied/i)
  })

  it('tìm runner: km cụ thể (số nguyên, có nhiễu cố định theo cặp), điểm phù hợp, không lộ toạ độ; ẩn theo "ai thấy tôi"', async () => {
    await on(db, B, { goals: ['10K'], time_slots: ['EARLY'] }); await at(db, B, 21.05, 105.84)        // ~2,6 km
    await on(db, C, { time_slots: ['EVENING'] }); await at(db, C, 21.03, 105.85)                         // ~5 km
    await on(db, E, { visible_to: 'SAME_GENDER' }); await at(db, E, 21.06, 105.83)
    const r = await near(db, A, { radius_km: 10 })
    const ids = (r.items as Row[]).map((x) => x.id)
    expect(ids).toEqual([B, C])                                                       // E chỉ cho người cùng giới (nữ) thấy
    const b = r.items[0]
    expect(b).toMatchObject({ name: 'Bình T.', connection: 'NONE' })
    expect(Number.isInteger(b.km)).toBe(true)
    expect(b.km).toBeGreaterThanOrEqual(2); expect(b.km).toBeLessThanOrEqual(4)
    expect(JSON.stringify(r)).not.toMatch(/cell_|lat|lng/)
    expect(b.reasons).toEqual(expect.arrayContaining(['PACE', 'SLOT', 'GOAL']))
    expect((await near(db, A, { radius_km: 10 })).items[0].km).toBe(b.km)            // cùng cặp → cùng số
    expect((await near(db, B, { radius_km: 10 })).items.map((x: Row) => x.id)).toEqual(expect.arrayContaining([A, E]))
    expect((await near(db, A, { radius_km: 2 })).items).toHaveLength(0)
    expect((await near(db, A, { pace: 'FAST' })).items.map((x: Row) => x.id)).toEqual([C])
  })

  it('kết nối 2 chiều: lời mời, không link, chấp nhận; mời ngược = chấp nhận luôn; từ chối thì 30 ngày không gửi lại', async () => {
    expect(await fails(rpc(db, A, `select public.send_connection($1, 'zalo mình nhé 09xx') as r`, [B]))).toContain('NO_LINKS')
    const req = await rpc<Row>(db, A, `select public.send_connection($1, 'Sáng mai chạy Hồ Tây không?') as r`, [B])
    expect(await fails(rpc(db, A, `select public.send_connection($1) as r`, [B]))).toContain('ALREADY_REQUESTED')
    expect((await rpc<Row>(db, B, `select public.my_connections() as r`)).incoming[0]).toMatchObject({ id: A, request_id: req.id })
    expect((await db.query(`select 1 from public.notifications where user_id = $1 and kind = 'RUNNER_CONNECT'`, [B])).rows).toHaveLength(1)
    await rpc(db, B, `select public.respond_connection($1, 'ACCEPT') as r`, [req.id])
    expect((await rpc<Row>(db, A, `select public.my_connections() as r`)).connections[0]).toMatchObject({ id: B, name: 'Trần Thị Bình' })
    expect((await near(db, A)).items.find((x: Row) => x.id === B).connection).toBe('CONNECTED')

    const r2 = await rpc<Row>(db, C, `select public.send_connection($1) as r`, [A])
    expect(await rpc<Row>(db, A, `select public.send_connection($1) as r`, [C])).toMatchObject({ id: r2.id, status: 'ACCEPTED' })
    await rpc(db, A, `select public.remove_connection($1)`, [C])
    const r3 = await rpc<Row>(db, C, `select public.send_connection($1) as r`, [A])
    await rpc(db, A, `select public.respond_connection($1, 'DECLINE') as r`, [r3.id])
    expect(await fails(rpc(db, C, `select public.send_connection($1) as r`, [A]))).toContain('REQUEST_COOLDOWN')
  })

  it('chặn: ẩn hai chiều, huỷ kết nối; 3 người báo cáo → tự ẩn, admin gỡ / khoá', async () => {
    await rpc(db, B, `select public.block_user($1)`, [A])
    expect((await near(db, A)).items.map((x: Row) => x.id)).not.toContain(B)
    expect((await near(db, B)).items.map((x: Row) => x.id)).not.toContain(A)
    expect((await rpc<Row>(db, A, `select public.my_connections() as r`)).connections).toHaveLength(0)
    expect(await fails(rpc(db, A, `select public.send_connection($1) as r`, [B]))).toContain('TARGET_UNAVAILABLE')
    await rpc(db, B, `select public.unblock_user($1)`, [A])

    for (const u of [A, B, C]) await rpc(db, u, `select public.report_user($1, 'SPAM', 'nhắn quá nhiều')`, [E])
    expect((await rpc<Row>(db, E, `select public.my_discovery() as r`))).toMatchObject({ enabled: false, suspended: true, presence: null })
    expect((await rpc<Row>(db, ADM, `select public.admin_inbox() as r`)).reports).toBe(1)
    const rep = (await rpc<Row[]>(db, ADM, `select public.admin_list_reports('OPEN') as r`))[0]
    expect(rep).toMatchObject({ target: E, target_reports: 3, target_suspended: true })
    await rpc(db, ADM, `select public.admin_resolve_report($1, 'DISMISS', 'Hiểu lầm')`, [rep.id])
    expect((await rpc<Row>(db, E, `select public.my_discovery() as r`)).suspended).toBe(false)
  })

  it('CLB: điểm tập + buổi chạy công khai — người ngoài thấy & đăng ký được; rủ người đã kết nối', async () => {
    await rpc(db, C, `select public.set_club_location($1, 21.052, 105.831, 'Hồ Tây')`, [CLUB])
    expect(await rpc<Row>(db, C, `select public.club_place($1) as r`, [CLUB])).toEqual({ area_label: 'Hồ Tây', lat: 21.05, lng: 105.83 })
    expect(await fails(rpc(db, A, `select public.club_place($1) as r`, [CLUB]))).toContain('FORBIDDEN')
    await db.query(`insert into public.club_events (id, club_id, created_by, title, starts_at, location_name, lat, lng, capacity)
                    values ($1, $2, $3, 'Long run Hồ Tây', now() + interval '2 days', 'Cổng Công viên nước', 21.06, 105.83, 20)`, [EV, CLUB, C])
    expect(await fails(rpc(db, A, `select public.rsvp_public_event($1, 'GOING') as r`, [EV]))).toContain('EVENT_NOT_FOUND')
    expect(await fails(rpc(db, A, `select public.set_club_event_visibility($1, 'PUBLIC')`, [EV]))).toContain('FORBIDDEN')
    await rpc(db, C, `select public.set_club_event_visibility($1, 'PUBLIC')`, [EV])
    expect((await rpc<Row[]>(db, A, `select public.nearby_clubs(10) as r`))[0]).toMatchObject({ name: 'Hồ Tây Runners', is_member: false, upcoming: 1 })
    const ev = (await rpc<Row[]>(db, A, `select public.nearby_events(10) as r`))[0]
    expect(ev).toMatchObject({ title: 'Long run Hồ Tây', club_name: 'Hồ Tây Runners', is_member: false })
    expect((await rpc<Row>(db, A, `select public.rsvp_public_event($1, 'GOING') as r`, [EV])).my_status).toBe('GOING')

    const req = await rpc<Row>(db, A, `select public.send_connection($1) as r`, [B])
    await rpc(db, B, `select public.respond_connection($1, 'ACCEPT') as r`, [req.id])
    await rpc(db, A, `select public.invite_to_run($1, $2)`, [B, EV])
    expect((await db.query<Row>(`select link from public.notifications where user_id = $1 and kind = 'RUNNER_INVITE'`, [B])).rows[0].link).toBe(`/nearby/events/${EV}`)
    expect(await rpc<Row>(db, E, `select public.club_event($1) as r`, [EV])).toMatchObject({ is_member: false, attendees: [], club_name: 'Hồ Tây Runners' })
    expect(await fails(rpc(db, A, `select public.invite_to_run($1, $2)`, [C, EV]))).toContain('NOT_CONNECTED')
    // tắt tính năng = xoá vị trí ngay
    await rpc(db, A, `select public.set_discovery('{"enabled": false}'::jsonb) as r`)
    expect((await db.query(`select 1 from public.runner_location_presence where user_id = $1`, [A])).rows).toHaveLength(0)
  })
})
