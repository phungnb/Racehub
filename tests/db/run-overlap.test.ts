import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createDb, asUser } from './load-schema'

// Migration 009900: một tài khoản ghi nhiều bài trùng giờ (nhiều thiết bị) → mỗi thời điểm chỉ tính một bài, bài dài nhất
const U = '00000000-0000-0000-0000-0000000099a1'
type R = { validation_status: string; validation_reason: string | null; activity_id: string; earned_xp: number; earned_xu: number; distance_m: number }
type Row = { validation_status: string; validation_reason: string | null; review_detail: string | null; earned_xu: string | null; earned_xp: number | null }

async function seed(db: PGlite) {
  await db.exec(`
    insert into auth.users (id, email) values ('${U}', 'u99@x.vn');
    insert into public.profiles (id, display_name, xu, xp, level, created_at) values ('${U}', 'Runner', 0, 0, 1, now()) on conflict do nothing;
  `)
}
// Tuyến GPS đều 3 m/s, 5 giây một điểm
function track(start: Date, seconds: number, mps = 3) {
  const pts = []
  for (let t = 0; t <= seconds; t += 5) pts.push({ latitude: 21.03 + (mps * t) / 111_320, longitude: 105.85, recorded_at: new Date(start.getTime() + t * 1000).toISOString() })
  return pts
}
const at = (hoursAgo: number, plusMin = 0) => new Date(Date.now() - hoursAgo * 3600_000 + plusMin * 60_000)

describe('bài chạy trùng giờ trên nhiều thiết bị (009900)', () => {
  let db: PGlite
  const submit = async (start: Date, seconds: number, mps = 3) => (await asUser<{ r: R }>(db, U, '/rpc',
    `select public.submit_and_process_activity(p_title => 'Chạy', p_source => 'DIRECT_GPS', p_started_at => $1, p_ended_at => $2,
       p_elapsed_s => $3, p_moving_s => $3, p_distance_m => 0, p_avg_pace_s => 0, p_track_points => $4::jsonb) as r`,
    [start.toISOString(), new Date(start.getTime() + seconds * 1000).toISOString(), seconds, JSON.stringify(track(start, seconds, mps))])).rows[0].r
  const row = async (id: string) => (await db.query<Row>(
    `select validation_status, validation_reason, review_detail, earned_xu, earned_xp from public.activities where id = $1`, [id])).rows[0]
  const wallet = async () => (await db.query<{ xu: string; xp: number }>(`select private.balance($1) as xu, xp from public.profiles where id = $1`, [U])).rows[0]
  const fails = async (p: Promise<unknown>) => { try { await p } catch (e) { return (e as Error).message } return 'OK' }
  const strava = async (id: string, start: Date, seconds: number, meters: number) => {
    await db.exec('set role service_role')
    try {
      return (await db.query<{ r: { result: string; activity_id?: string; validation_status?: string } }>(
        `select public.ingest_provider_activity($1, 'STRAVA', $2, $3::jsonb) as r`, [U, id, JSON.stringify({
          title: 'Run', sport_type: 'Run', started_at: start.toISOString(), elapsed_s: seconds, moving_s: seconds, distance_m: meters,
          has_gps: true, risk: { verdict: 'OK', score: 0, level: 'LOW' } })])).rows[0].r
    } finally { await db.exec('reset role') }
  }
  beforeAll(async () => { db = await createDb({ withMigrations: true, runMigrationsTwice: true, seed }) }, 240_000)

  it('máy B gửi bài ngắn trước, máy A gửi bài 2 giờ sau → tính bài 2 giờ, thu hồi Xu / XP bài ngắn', async () => {
    const short = await submit(at(100, 30), 1800)                         // 30 phút ≈ 5,4 km, nằm trong khung 2 giờ
    expect(short.validation_status).toBe('APPROVED')
    expect(Number(short.earned_xu)).toBeGreaterThan(0)
    const long = await submit(at(100), 7200)                              // 2 giờ ≈ 21,6 km
    expect(long.validation_status).toBe('APPROVED')
    const old = await row(short.activity_id)
    expect(old).toMatchObject({ validation_status: 'REJECTED', validation_reason: 'Trùng giờ với bài chạy khác.' })
    expect(Number(old.earned_xu)).toBe(0)
    expect(old.review_detail).toContain(long.activity_id)
    const w = await wallet()
    expect(Number(w.xu)).toBeCloseTo(Number(long.earned_xu), 1)          // chỉ còn thưởng của bài 2 giờ
    expect(w.xp).toBe(Number(long.earned_xp))
  })

  it('bài 2 giờ đã tính, máy khác gửi bài ngắn trong khung đó → lưu vào lịch sử nhưng không tính', async () => {
    const before = await wallet()
    const dup = await submit(at(100, 60), 900)
    expect(dup).toMatchObject({ validation_status: 'REJECTED', validation_reason: 'Trùng giờ với bài chạy khác.', earned_xu: 0, earned_xp: 0 })
    expect(await wallet()).toEqual(before)
  })

  it('gửi lại đúng bài cũ (mạng chập chờn) → ACTIVITY_DUPLICATE, không tạo bài mới', async () => {
    const start = at(90)
    await submit(start, 1200)
    expect(await fails(submit(start, 1200))).toContain('ACTIVITY_DUPLICATE')
    expect(Number((await db.query<{ n: string }>(`select count(*) n from public.activities where user_id = $1 and started_at = $2`, [U, start.toISOString()])).rows[0].n)).toBe(1)
  })

  it('bài dài hơn nhưng nghi vấn (tốc độ đi xe) không được thay bài đã tính — chờ duyệt (013700)', async () => {
    const ok = await submit(at(80, 10), 1800)
    const fast = await submit(at(80), 3600, 9)                           // 32 km/h suốt 1 giờ
    expect(fast.validation_status).toBe('PENDING')                      // 013700: chờ duyệt, không bị loại ngay
    expect((await row(ok.activity_id)).validation_status).toBe('APPROVED')
  })

  it('hai bài nối tiếp (chồng nhau ≤ 60 giây do lệch đồng hồ) đều được tính', async () => {
    const a = await submit(at(70), 1200)
    const b = await submit(at(70, 19.5), 1200)
    expect([a.validation_status, b.validation_status]).toEqual(['APPROVED', 'APPROVED'])
  })

  it('Strava: cùng buổi chạy đã ghi bằng app → bỏ qua; đồng hồ ghi dài hơn hẳn → tính bài Strava, bỏ bài app', async () => {
    const app = await submit(at(60), 1800)
    expect((await strava('ov-1', at(60), 1800, 5400)).result).toBe('SKIPPED')
    const s = await strava('ov-2', at(60, -10), 5400, 16000)
    expect(s).toMatchObject({ result: 'IMPORTED', validation_status: 'APPROVED' })
    expect((await row(app.activity_id)).validation_status).toBe('REJECTED')
  })
})
