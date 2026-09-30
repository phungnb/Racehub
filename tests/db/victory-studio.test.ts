import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createDb, asUser } from './load-schema'

// Migration 011600: Victory Studio — số liệu do máy chủ điền, mã xác thực, BTC vinh danh linh hoạt
const [A, B, M] = [1, 2, 3].map((n) => `00000000-0000-0000-0000-0000001160${String(n).padStart(2, '0')}`)
const CH = '00000000-0000-0000-0000-00000011600a'
type Row = Record<string, any>

async function seed(db: PGlite) {
  await db.exec(`
    insert into auth.users (id, email) values ('${A}', 'a116@x.vn'), ('${B}', 'b116@x.vn'), ('${M}', 'm116@x.vn');
    insert into public.profiles (id, display_name) values ('${A}', 'An'), ('${B}', 'Bình'), ('${M}', 'Mai BTC') on conflict do nothing;
  `)
}
const rpc = async <T = Row>(db: PGlite, uid: string | null, sql: string, params: unknown[] = []) => (await asUser<{ r: T }>(db, uid, '/rpc', sql, params)).rows[0].r
const fails = async (p: Promise<unknown>) => { try { await p } catch (e) { return (e as Error).message } return 'OK' }
let h = 400
const run = (db: PGlite, uid: string, km: number, paceS: number) => db.query<{ id: string }>(`
  insert into public.activities (user_id, title, source, started_at, ended_at, distance_m, moving_distance_m, moving_time_s, avg_pace_s, validation_status, status)
  values ($1, 'Chạy sáng', 'DIRECT_GPS', now() - make_interval(hours => $4), now() - make_interval(hours => $4) + interval '1 hour', $2::numeric, $2::numeric, $3::int, $5::int, 'APPROVED', 'READY')
  returning id`, [uid, km * 1000, Math.round(km * paceS), (h -= 5), paceS]).then((r) => r.rows[0].id)

describe('Victory Studio (011600)', () => {
  let db: PGlite
  beforeAll(async () => {
    db = await createDb({ withMigrations: true, runMigrationsTwice: true, seed })
    await db.query(`insert into public.challenges (id, title, start_date, end_date, target_value, objective, format, status, created_by)
      values ($1, 'Thử thách 100 KM tháng 9', now() - interval '30 days', now() - interval '1 day', 100, 'DISTANCE', 'RANKED', 'ACTIVE', $2)`, [CH, M])
    await db.query(`insert into public.challenge_participants (challenge_id, profile_id, status, current_progress, distance_m, moving_s, run_count, streak_days, completed_at)
      values ($1, $2, 'JOINED', 104.5, 104500, 36000, 14, 12, now() - interval '3 days'), ($1, $3, 'JOINED', 60, 60000, 20000, 8, 7, null)`, [CH, A, B])
  }, 300_000)

  it('thử thách: số liệu chính thức, chọn được nhiều thông số; người ngoài không xem được', async () => {
    const f = await rpc(db, A, `select public.victory_facts('CHALLENGE', $1) as r`, [CH])
    expect(f).toMatchObject({ state: 'COMPLETED', headline: 'Hoàn thành thử thách', title: 'Thử thách 100 KM tháng 9', can_award: false,
      person: { display_name: 'An' } })
    const stats = Object.fromEntries(f.stats.map((s: Row) => [s.key, s.value]))
    expect(stats).toMatchObject({ score: '104,5 km', rank: '1/2', time: '10:00:00', runs: '14', days: '12', goal: '100 km', pace: '5:44/km' })
    expect(await fails(rpc(db, M, `select public.victory_facts('CHALLENGE', $1) as r`, [CH]))).toContain('NOT_PARTICIPANT')
    expect(await fails(rpc(db, B, `select public.victory_facts('CHALLENGE', $1, $2) as r`, [CH, A]))).toContain('FORBIDDEN')
  })

  it('mã xác thực: cấp một lần, cấp lại giữ mã; trang công khai xem được kể cả khi chưa đăng nhập; thu hồi', async () => {
    const r1 = await rpc(db, A, `select public.issue_victory('CHALLENGE', $1) as r`, [CH])
    expect(r1.code).toMatch(/^[A-Z0-9]{8}$/)
    expect(r1.new).toBe(true)
    const r2 = await rpc(db, A, `select public.issue_victory('CHALLENGE', $1, null, null, '{"template":"gold"}'::jsonb) as r`, [CH])
    expect(r2).toMatchObject({ code: r1.code, new: false })
    const v = await rpc(db, null, `select public.verify_victory($1) as r`, [r1.code.toLowerCase()])
    expect(v).toMatchObject({ code: r1.code, kind: 'CHALLENGE', person: { display_name: 'An' }, facts: { title: 'Thử thách 100 KM tháng 9' } })
    await rpc(db, A, `select public.record_victory_export($1, '{"format":"story"}'::jsonb) as r`, [r1.code])
    expect((await rpc<Row[]>(db, A, `select public.my_victories() as r`))[0]).toMatchObject({ code: r1.code, exports: 1, mine: true })
    // Runner không tự đặt danh hiệu
    expect(await fails(rpc(db, A, `select public.issue_victory('CHALLENGE', $1, null, 'Vô địch thế giới') as r`, [CH]))).toContain('FORBIDDEN')
    expect(await fails(rpc(db, B, `select public.revoke_victory($1) as r`, [r1.code]))).toContain('NOT_FOUND')
    await rpc(db, A, `select public.revoke_victory($1) as r`, [r1.code])
    expect(await rpc(db, null, `select public.verify_victory($1) as r`, [r1.code])).toBeNull()
  })

  it('BTC vinh danh linh hoạt: chọn người + danh hiệu tự đặt, người được vinh danh nhận thông báo', async () => {
    const f = await rpc(db, M, `select public.victory_facts('CHALLENGE', $1, $2) as r`, [CH, B])
    expect(f).toMatchObject({ state: 'FINISHED', headline: 'Về đích thử thách', can_award: true, person: { display_name: 'Bình' } })
    const r = await rpc(db, M, `select public.issue_victory('CHALLENGE', $1, $2, '  Runner bền bỉ nhất  ') as r`, [CH, B])
    expect(r).toMatchObject({ award: 'Runner bền bỉ nhất', new: true })
    const v = await rpc(db, null, `select public.verify_victory($1) as r`, [r.code])
    expect(v).toMatchObject({ award: 'Runner bền bỉ nhất', issued_by: 'Mai BTC', person: { display_name: 'Bình' } })
    const n = (await db.query<{ n: number }>(`select count(*)::int n from public.notifications where user_id = $1 and kind = 'VICTORY'`, [B])).rows[0].n
    expect(n).toBe(1)
    expect((await rpc(db, M, `select public.victory_sources() as r`)).managed.map((x: Row) => x.ref)).toContain(CH)
  })

  it('bài chạy mốc + kỷ lục cá nhân, tổng km, level, huy hiệu; không đủ điều kiện thì từ chối', async () => {
    const slow = await run(db, A, 10.2, 360)
    const fast = await run(db, A, 10.5, 300)
    expect(await rpc(db, A, `select public.victory_facts('RUN', $1) as r`, [fast])).toMatchObject({ headline: 'Kỷ lục cá nhân', title: '10K' })
    expect(await rpc(db, A, `select public.victory_facts('RUN', $1) as r`, [slow])).toMatchObject({ headline: 'Chinh phục 10K' })
    expect(await fails(rpc(db, B, `select public.victory_facts('RUN', $1) as r`, [fast]))).toContain('NOT_FOUND')
    await run(db, A, 42.3, 330)
    await run(db, A, 40, 330)
    const t = await rpc(db, A, `select public.victory_facts('TOTAL_KM', '100') as r`)
    expect(t).toMatchObject({ title: '100 KM', headline: 'Cột mốc hành trình' })
    expect(await fails(rpc(db, A, `select public.victory_facts('TOTAL_KM', '200') as r`))).toContain('NOT_ELIGIBLE')
    await db.query(`update public.profiles set level = 3 where id = $1`, [A])
    expect(await rpc(db, A, `select public.victory_facts('LEVEL', '3') as r`)).toMatchObject({ title: 'Level 3' })
    expect(await fails(rpc(db, A, `select public.victory_facts('LEVEL', '4') as r`))).toContain('NOT_ELIGIBLE')
    await db.query(`insert into public.achievements (code, title, description, icon, tier) values ('vic_test', 'Chiến binh 100K', 'Chạy đủ 100 km', '🏅', 'gold')`)
    await db.query(`insert into public.user_achievements (user_id, achievement_id) select $1, id from public.achievements where code = 'vic_test'`, [A])
    const b = await rpc(db, A, `select public.victory_facts('BADGE', 'vic_test') as r`)
    expect(b).toMatchObject({ title: 'Chiến binh 100K', icon: '🏅' })
    expect(b.stats.find((s: Row) => s.key === 'tier').value).toBe('Vàng')
    const src = await rpc(db, A, `select public.victory_sources() as r`)
    expect(src.challenges[0]).toMatchObject({ ref: CH, state: 'COMPLETED' })
    expect(src.runs.map((r: Row) => r.title)).toContain('Marathon')
    expect(src.totals.map((r: Row) => r.ref)).toEqual(['100', '50'])
    expect(src.levels.map((r: Row) => r.ref)).toEqual(['3', '2'])
    expect(src.badges[0]).toMatchObject({ ref: 'vic_test' })
  })

  it('người chưa đăng nhập không cấp được mã; bảng mã không đọc trực tiếp được', async () => {
    expect(await fails(rpc(db, null, `select public.issue_victory('LEVEL', '2') as r`))).not.toBe('OK')
    expect(await fails(asUser(db, A, '/rest', `select * from public.victory_certificates`))).not.toBe('OK')
  })
})
