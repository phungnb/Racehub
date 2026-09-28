import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createDb, asUser } from './load-schema'

// Migration 009700: ngoài thử thách chỉ tự duyệt bài nghi vấn mức thấp; "chỉ tính phần có GPS"; lời báo thân thiện
const [RUNNER, OTHER, ADM] = ['00000000-0000-0000-0000-0000000097a1', '00000000-0000-0000-0000-0000000097a2', '00000000-0000-0000-0000-0000000097a3']
type R = { validation_status: string; validation_reason: string | null; activity_id: string; earned_xp: number; earned_xu: number; distance_m: number }
type Row = Record<string, any>

async function seed(db: PGlite) {
  await db.exec(`
    insert into auth.users (id, email) values ('${RUNNER}', 'r97@x.vn'), ('${OTHER}', 'o97@x.vn'), ('${ADM}', 'a97@x.vn');
    insert into public.profiles (id, display_name, xu, xp, level, created_at) values
      ('${RUNNER}', 'Runner', 0, 0, 1, now()), ('${OTHER}', 'Khác', 0, 0, 1, now()), ('${ADM}', 'Admin', 0, 0, 1, now()) on conflict do nothing;
    update public.profiles set role = 'SYSTEM_ADMIN' where id = '${ADM}';
  `)
}
// Tuyến GPS 5 giây một điểm; đoạn [giây, m/s, mất tín hiệu?]
function track(start: Date, segments: [number, number, boolean?][]) {
  const pts = [{ latitude: 21.03, longitude: 105.85, recorded_at: start.toISOString() }]
  let t = 0, lat = 21.03
  for (const [dur, mps, gap] of segments) {
    if (gap) { t += dur; lat += (mps * dur) / 111_320; pts.push({ latitude: lat, longitude: 105.85, recorded_at: new Date(start.getTime() + t * 1000).toISOString() }); continue }
    for (let k = 0; k < dur; k += 5) {
      t += 5; lat += (mps * 5) / 111_320
      pts.push({ latitude: lat, longitude: 105.85, recorded_at: new Date(start.getTime() + t * 1000).toISOString() })
    }
  }
  return { pts, seconds: t }
}
const rpc = async <T = Row>(db: PGlite, uid: string, sql: string, params: unknown[] = []) => (await asUser<{ r: T }>(db, uid, '/rpc', sql, params)).rows[0]?.r as T
const fails = async (p: Promise<unknown>) => { try { await p } catch (e) { return (e as Error).message } return 'OK' }

describe('tự duyệt chỉ mức thấp + chỉ tính phần có GPS (009700)', () => {
  let db: PGlite
  let hoursBack = 60
  const submit = (segments: [number, number, boolean?][]) => {
    const start = new Date(Date.now() - (hoursBack -= 3) * 3600_000)
    const { pts, seconds } = track(start, segments)
    return rpc<R>(db, RUNNER, `select public.submit_and_process_activity(p_title => 'Chạy', p_source => 'DIRECT_GPS', p_started_at => $1, p_ended_at => $2,
         p_elapsed_s => $3, p_moving_s => $3, p_distance_m => 0, p_avg_pace_s => 0, p_track_points => $4::jsonb) as r`,
      [start.toISOString(), new Date(start.getTime() + seconds * 1000).toISOString(), seconds, JSON.stringify(pts)])
  }
  beforeAll(async () => { db = await createDb({ withMigrations: true, runMigrationsTwice: true, seed }) }, 240_000)

  it('bài như ảnh: 2,99 / 3,01 km là đoạn mất GPS nối thẳng → không còn tự duyệt, không cộng Xu / XP; lời báo dễ hiểu', async () => {
    const r = await submit([[10, 2], [870, 3.44, true]])
    expect(r.validation_status).toBe('PENDING')
    expect(Number(r.earned_xp)).toBe(0)
    expect(r.validation_reason).toContain('mất tín hiệu GPS')
    expect(r.validation_reason).not.toMatch(/Mức nghi vấn|Tự duyệt|trình duyệt/)
    const info = await rpc(db, RUNNER, `select public.activity_review_info($1) as r`, [r.activity_id])
    expect(info).toMatchObject({ status: 'PENDING', can_accept_verified: true })
    expect(Number(info.verified_distance_m)).toBeLessThan(200)
    expect(await fails(rpc(db, OTHER, `select public.activity_review_info($1) as r`, [r.activity_id]))).toContain('FORBIDDEN')
    // Chọn "chỉ tính phần có GPS": phần kiểm chứng < 200 m → không ghi nhận
    const a = await rpc(db, RUNNER, `select public.accept_verified_distance($1) as r`, [r.activity_id])
    expect(a).toMatchObject({ status: 'REJECTED', earned_xp: 0 })
  })

  it('mất GPS một đoạn giữa bài: chỉ tính phần có GPS → duyệt ngay, cộng Xu / XP theo km đã kiểm chứng', async () => {
    const r = await submit([[600, 3], [600, 3, true], [300, 3]])       // 1,8 km + 1,8 km mất tín hiệu + 0,9 km
    expect(r.validation_status).toBe('PENDING')
    expect(await fails(rpc(db, OTHER, `select public.accept_verified_distance($1) as r`, [r.activity_id]))).toContain('FORBIDDEN')
    const a = await rpc(db, RUNNER, `select public.accept_verified_distance($1) as r`, [r.activity_id])
    expect(a.status).toBe('APPROVED')
    expect(Number(a.distance_m)).toBeGreaterThan(2500)
    expect(Number(a.distance_m)).toBeLessThan(2900)
    expect(Number(a.earned_xp)).toBeGreaterThan(0)
    expect(a.reason).toContain('Chỉ tính phần có tín hiệu GPS')
    expect(await fails(rpc(db, RUNNER, `select public.accept_verified_distance($1) as r`, [r.activity_id]))).toContain('NOT_ELIGIBLE')
  })

  it('bài có tốc độ giống đi xe: không cho "chỉ tính phần có GPS", phải chờ xác minh', async () => {
    const r = await submit([[600, 3], [120, 12], [600, 3]])
    expect(r.validation_status).toBe('PENDING')
    expect(r.validation_reason).toContain('tốc độ khác với chạy bộ')
    expect(r.validation_reason).not.toContain('km/h')
    expect((await rpc(db, RUNNER, `select public.activity_review_info($1) as r`, [r.activity_id])).can_accept_verified).toBe(false)
  })

  it('bài bình thường vẫn duyệt ngay, không có lời báo; admin nới ngưỡng thì bài mất GPS lại được tự duyệt', async () => {
    const ok = await submit([[1500, 3]])
    expect(ok.validation_status).toBe('APPROVED')
    expect(ok.validation_reason ?? '').not.toMatch(/Mức nghi vấn|Tự duyệt/)
    expect(await fails(rpc(db, ADM, `select public.admin_publish_ops_policy($1::jsonb) as r`, [JSON.stringify({ antiCheat: { autoApproveMaxScore: 101 } })]))).toContain('INVALID_CONFIG')
    await rpc(db, ADM, `select public.admin_publish_ops_policy($1::jsonb) as r`, [JSON.stringify({ antiCheat: { autoApproveMaxScore: 45 } })])
    const g = await submit([[600, 3], [600, 3, true], [300, 3]])
    expect(g.validation_status).toBe('APPROVED')
  })
})
