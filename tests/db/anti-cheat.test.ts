import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createDb, asUser } from './load-schema'

// Migration 002300: chống gian lận — luật tốc độ duy trì cho bài GPS trong app + nhận kết luận phân tích cho bài Strava
const U = '00000000-0000-0000-0000-0000000003c1'

async function seed(db: PGlite) {
  await db.exec(`
    insert into auth.users (id, email) values ('${U}', 'ac@x.vn');
    insert into public.profiles (id, display_name, xu, xp, level, created_at) values ('${U}', 'AC', 0, 0, 1, now());
  `)
}

// Tuyến GPS 5 giây một điểm theo từng đoạn [giây, m/s]
function track(start: Date, segments: [number, number][]) {
  const pts = [{ latitude: 21.03, longitude: 105.85, recorded_at: start.toISOString() }]
  let t = 0, lat = 21.03
  for (const [dur, mps] of segments) {
    for (let k = 0; k < dur; k += 5) {
      t += 5; lat += (mps * 5) / 111_320
      pts.push({ latitude: lat, longitude: 105.85, recorded_at: new Date(start.getTime() + t * 1000).toISOString() })
    }
  }
  return { pts, seconds: t }
}

type R = { validation_status: string; validation_reason: string; activity_id: string; earned_xu: number }

describe('chống gian lận (002300)', () => {
  let db: PGlite
  let hoursBack = 30
  const submit = async (segments: [number, number][]) => {
    const start = new Date(Date.now() - (hoursBack -= 3) * 3600_000)
    const { pts, seconds } = track(start, segments)
    const r = await asUser<{ r: R }>(db, U, '/rpc/submit_and_process_activity',
      `select public.submit_and_process_activity(p_title => 'Chạy', p_source => 'DIRECT_GPS', p_started_at => $1, p_ended_at => $2,
         p_elapsed_s => $3, p_moving_s => $3, p_distance_m => 0, p_avg_pace_s => 0, p_track_points => $4::jsonb) as r`,
      [start.toISOString(), new Date(start.getTime() + seconds * 1000).toISOString(), seconds, JSON.stringify(pts)])
    return r.rows[0].r
  }
  const risk = async (id: string) => (await db.query<{ risk_level: string; risk_flags: { code: string; severity: string }[] | null }>(
    `select risk_level, risk_flags from public.activities where id = $1`, [id])).rows[0]

  beforeAll(async () => { db = await createDb({ withMigrations: true, runMigrationsTwice: true, seed }) }, 240_000)

  it('bài chạy GPS bình thường (có đoạn nước rút ngắn) → hợp lệ, không cờ', async () => {
    const r = await submit([[900, 3.2], [60, 5.8], [900, 3.2]])
    expect(r.validation_status).toBe('APPROVED')
    expect(await risk(r.activity_id)).toMatchObject({ risk_level: 'LOW', risk_flags: null })
  })

  it('giữ ≥ 20 km/h liên tục 3 phút → chờ duyệt, không thưởng', async () => {
    const r = await submit([[600, 3], [180, 6], [600, 3]])
    expect(r.validation_status).toBe('PENDING')
    expect(r.validation_reason).toContain('20 km/h')
    expect(Number(r.earned_xu)).toBe(0)
    expect((await risk(r.activity_id)).risk_flags).toEqual([expect.objectContaining({ code: 'SUSTAINED_SPEED', severity: 'SEVERE' })])
  })

  it('đoạn đi xe máy 35 km/h trong 1 phút → chờ duyệt (đoạn đi xe)', async () => {
    const r = await submit([[900, 3], [60, 9.7], [900, 3]])
    expect(r.validation_status).toBe('PENDING')
    expect(r.validation_reason).toContain('đi xe')
  })

  it('mất tín hiệu GPS (tắt màn hình): tuyến 2 điểm nối thẳng 3 km → chờ xác minh, cờ GPS_GAP; mất ngắn → vẫn duyệt, cờ INFO', async () => {
    const start = new Date(Date.now() - (hoursBack -= 3) * 3600_000)
    const pts = [{ latitude: 21.03, longitude: 105.85, recorded_at: start.toISOString() },
      { latitude: 21.03 + 3050 / 111_320, longitude: 105.85, recorded_at: new Date(start.getTime() + 1065_000).toISOString() }]
    const r = (await asUser<{ r: R }>(db, U, '/rpc/submit_and_process_activity',
      `select public.submit_and_process_activity(p_title => 'Chạy', p_source => 'DIRECT_GPS', p_started_at => $1, p_ended_at => $2,
         p_elapsed_s => 1174, p_moving_s => 1065, p_distance_m => 3050, p_avg_pace_s => 349, p_track_points => $3::jsonb) as r`,
      [start.toISOString(), new Date(start.getTime() + 1174_000).toISOString(), JSON.stringify(pts)])).rows[0].r
    expect(r.validation_status).toBe('PENDING')
    expect(r.validation_reason).toContain('Mất tín hiệu GPS')
    expect((await risk(r.activity_id)).risk_flags).toEqual([expect.objectContaining({ code: 'GPS_GAP', severity: 'HIGH' })])

    // Mất 80 giây (≈ 240 m, qua hầm) giữa bài ~5 km → vẫn hợp lệ, cờ INFO để tham khảo
    const s2 = new Date(Date.now() - (hoursBack -= 3) * 3600_000)
    const { pts: all, seconds } = track(s2, [[1700, 3]])
    const holed = all.filter((_, i) => i < 150 || i > 165)
    const ok = (await asUser<{ r: R }>(db, U, '/rpc/submit_and_process_activity',
      `select public.submit_and_process_activity(p_title => 'Chạy', p_source => 'DIRECT_GPS', p_started_at => $1, p_ended_at => $2,
         p_elapsed_s => $3, p_moving_s => $3, p_distance_m => 0, p_avg_pace_s => 0, p_track_points => $4::jsonb) as r`,
      [s2.toISOString(), new Date(s2.getTime() + seconds * 1000).toISOString(), seconds, JSON.stringify(holed)])).rows[0].r
    expect(ok.validation_status).toBe('APPROVED')
    expect((await risk(ok.activity_id)).risk_flags).toEqual([expect.objectContaining({ code: 'GPS_GAP', severity: 'INFO' })])
  })

  it('bài Strava: kết luận REVIEW của bộ phân tích → chờ duyệt kèm lý do; OK → duyệt ngay', async () => {
    await db.exec('set role service_role')
    try {
      const base = { title: 'Run', sport_type: 'Run', elapsed_s: 1900, moving_s: 1800, distance_m: 5000, has_gps: true }
      const bad = (await db.query<{ r: R }>(`select public.ingest_provider_activity($1, 'STRAVA', 'ac-1', $2::jsonb) as r`, [U, JSON.stringify({
        ...base, started_at: new Date(Date.now() - 50 * 3600_000).toISOString(),
        risk: { verdict: 'REVIEW', score: 70, level: 'HIGH', reason: 'Sải chân > 2.1 m liên tục 3 phút', flags: [{ code: 'STRIDE', severity: 'SEVERE' }] },
      })])).rows[0].r
      expect(bad).toMatchObject({ validation_status: 'PENDING' })
      expect(bad.validation_reason ?? (bad as unknown as { reason: string }).reason).toContain('Sải chân')
      const good = (await db.query<{ r: R }>(`select public.ingest_provider_activity($1, 'STRAVA', 'ac-2', $2::jsonb) as r`, [U, JSON.stringify({
        ...base, started_at: new Date(Date.now() - 60 * 3600_000).toISOString(), risk: { verdict: 'OK', score: 0, level: 'LOW' },
      })])).rows[0].r
      expect(good).toMatchObject({ validation_status: 'APPROVED' })
    } finally { await db.exec('reset role') }
    const row = (await db.query<{ risk_score: number; risk_level: string }>(
      `select risk_score, risk_level from public.activities where source_activity_id = 'ac-1'`)).rows[0]
    expect(row).toEqual({ risk_score: 70, risk_level: 'HIGH' })
  })
})
