import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createDb, asUser } from './load-schema'

// Migration 010000: chính sách chống gian lận GPS V1 — ưu tiên công nhận, chỉ giữ bài có dấu hiệu rõ
const [U, ADM] = ['00000000-0000-0000-0000-00000010a0a1', '00000000-0000-0000-0000-00000010a0a2']
type R = { validation_status: string; validation_reason: string | null; activity_id: string; earned_xu: number; distance_m: number }
type Flag = { code: string; severity: string }

async function seed(db: PGlite) {
  await db.exec(`
    insert into auth.users (id, email) values ('${U}', 'v1@x.vn'), ('${ADM}', 'v1a@x.vn');
    insert into public.profiles (id, display_name, xu, xp, level, created_at) values ('${U}', 'Runner', 0, 0, 1, now()), ('${ADM}', 'Admin', 0, 0, 1, now()) on conflict do nothing;
    update public.profiles set role = 'SYSTEM_ADMIN' where id = '${ADM}';
  `)
}
// Đoạn [giây, m/s, kiểu]: 'gap' = mất tín hiệu (một bước nhảy thời gian), 'jump' = mỗi 60 giây có một điểm nhảy 1 km rồi quay lại
type Seg = [number, number, ('gap' | 'jump')?]
function track(start: Date, segs: Seg[]) {
  const at = (t: number) => new Date(start.getTime() + t * 1000).toISOString()
  const pts = [{ latitude: 21.03, longitude: 105.85, recorded_at: at(0) }]
  let t = 0, lat = 21.03
  for (const [dur, mps, kind] of segs) {
    if (kind === 'gap') { t += dur; lat += (mps * dur) / 111_320; pts.push({ latitude: lat, longitude: 105.85, recorded_at: at(t) }); continue }
    for (let k = 0; k < dur; k += 5) {
      t += 5; lat += (mps * 5) / 111_320
      const jump = kind === 'jump' && k % 60 === 30
      pts.push({ latitude: jump ? lat + 0.009 : lat, longitude: 105.85, recorded_at: at(t) })
    }
  }
  return { pts, seconds: t }
}

describe('chính sách GPS V1 (010000)', () => {
  let db: PGlite
  let hoursBack = 80
  const submit = async (segs: Seg[], clientMeters = 0) => {
    const start = new Date(Date.now() - (hoursBack -= 3) * 3600_000)
    const { pts, seconds } = track(start, segs)
    return (await asUser<{ r: R }>(db, U, '/rpc',
      `select public.submit_and_process_activity(p_title => 'Chạy', p_source => 'DIRECT_GPS', p_started_at => $1, p_ended_at => $2,
         p_elapsed_s => $3, p_moving_s => $3, p_distance_m => $5, p_avg_pace_s => 0, p_track_points => $4::jsonb) as r`,
      [start.toISOString(), new Date(start.getTime() + seconds * 1000).toISOString(), seconds, JSON.stringify(pts), clientMeters])).rows[0].r
  }
  const flags = async (id: string) => ((await db.query<{ f: Flag[] | null }>(`select risk_flags f from public.activities where id = $1`, [id])).rows[0].f ?? [])
  beforeAll(async () => { db = await createDb({ withMigrations: true, runMigrationsTwice: true, seed }) }, 240_000)

  it('mất GPS một đoạn (≈ 40% bài), tốc độ hợp lý → duyệt ngay, tính ĐỦ quãng đường, chỉ ghi nhận dấu hiệu', async () => {
    const r = await submit([[600, 3], [600, 3, 'gap'], [300, 3]])      // 1,8 + 1,8 (mất GPS) + 0,9 km
    expect(r.validation_status).toBe('APPROVED')
    expect(Number(r.distance_m)).toBeGreaterThan(4300)
    expect(Number(r.earned_xu)).toBeGreaterThan(0)
    expect(await flags(r.activity_id)).toContainEqual(expect.objectContaining({ code: 'GPS_GAP', severity: 'INFO' }))
  })

  it('đoạn mất GPS nối thẳng nhanh như đi xe → chờ xác minh', async () => {
    const r = await submit([[600, 3], [300, 10, 'gap'], [600, 3]])      // 3 km trong 5 phút = 36 km/h
    expect(r.validation_status).toBe('PENDING')
    expect(r.validation_reason).toBe('Mất tín hiệu GPS một đoạn.')
  })

  it('mất GPS gần hết bài (kiểu bài xe máy tắt GPS) → chờ xác minh; admin đặt 100% thì không giữ vì mất GPS', async () => {
    const seg: Seg[] = [[10, 2], [870, 3.44, 'gap']]
    expect((await submit(seg)).validation_status).toBe('PENDING')
    await asUser(db, ADM, '/rpc', `select public.admin_publish_ops_policy($1::jsonb)`, [JSON.stringify({ antiCheat: { gapReviewPct: 100 } })])
    expect((await submit(seg)).validation_status).toBe('APPROVED')
    await asUser(db, ADM, '/rpc', `select public.admin_publish_ops_policy($1::jsonb)`, [JSON.stringify({ antiCheat: { gapReviewPct: 50 } })])
  })

  it('GPS nhảy xa vài lần → không làm tăng km, bài vẫn được duyệt', async () => {
    const r = await submit([[1500, 3, 'jump']])                         // 4,5 km thật, 25 lần nhảy 1 km
    expect(r.validation_status).toBe('APPROVED')
    expect(Number(r.distance_m)).toBeLessThan(4600)
    expect(await flags(r.activity_id)).toContainEqual(expect.objectContaining({ code: 'GPS_TELEPORT' }))
  })

  it('số km app gửi lệch tuyến GPS → vẫn duyệt theo km máy chủ tính, chỉ ghi nhận', async () => {
    const r = await submit([[1200, 3]], 9000)
    expect(r.validation_status).toBe('APPROVED')
    expect(Number(r.distance_m)).toBeLessThan(3800)
    expect(await flags(r.activity_id)).toContainEqual(expect.objectContaining({ code: 'DISTANCE_MISMATCH', severity: 'INFO' }))
  })

  it('tốc độ đi xe liên tục vẫn chờ xác minh', async () => {
    expect((await submit([[600, 3], [120, 12], [600, 3]])).validation_status).toBe('PENDING')
  })

  it('bài nhập tay từ Strava → chờ xác minh, chưa cộng Xu', async () => {
    await db.exec('set role service_role')
    try {
      const r = (await db.query<{ r: { validation_status: string; earned_xu: number } }>(`select public.ingest_provider_activity($1, 'STRAVA', 'man-1', $2::jsonb) as r`, [U, JSON.stringify({
        title: 'Run', sport_type: 'Run', manual: true, has_gps: false, started_at: new Date(Date.now() - 20 * 3600_000).toISOString(),
        elapsed_s: 3000, moving_s: 3000, distance_m: 10000 })])).rows[0].r
      expect(r).toMatchObject({ validation_status: 'PENDING', earned_xu: 0 })
    } finally { await db.exec('reset role') }
  })
})
