import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createDb, asUser } from './load-schema'

// Migration 006600: quãng đường = số app đo (distance_m tích luỹ từng điểm), kẹp theo hình học tuyến; từng km trên máy chủ
const U = '00000000-0000-0000-0000-0000000066a1'

async function seed(db: PGlite) {
  await db.exec(`
    insert into auth.users (id, email) values ('${U}', 'gd@x.vn');
    insert into public.profiles (id, display_name, xu, xp, level, created_at) values ('${U}', 'GD', 0, 0, 1, now());
  `)
}

type P = { latitude: number; longitude: number; recorded_at: string; distance_m?: number; altitude?: number }
type R = { validation_status: string; distance_m: number; activity_id: string }

/** Tuyến zig-zag (nhiễu GPS ±6 m ngang) chạy thẳng 3 m/s, 5 giây một điểm; `claim` = quãng đường app báo mỗi điểm */
function zigzag(start: Date, seconds: number, claim: (trueM: number) => number | undefined) {
  const pts: P[] = []
  for (let t = 0; t <= seconds; t += 5) {
    const m = t * 3
    const side = (t / 5) % 2 ? 6 : -6
    const c = claim(m)
    pts.push({ latitude: 21.03 + m / 111_320, longitude: 105.85 + side / 104_000, recorded_at: new Date(start.getTime() + t * 1000).toISOString(),
      altitude: 10, ...(c === undefined ? {} : { distance_m: c }) })
  }
  return pts
}

describe('quãng đường theo app, kẹp theo tuyến (006600)', () => {
  let db: PGlite
  let hoursBack = 40
  const submit = async (pts: P[]) => {
    const start = new Date(Date.now() - (hoursBack -= 3) * 3600_000)
    const t0 = Date.parse(pts[0].recorded_at)
    const fixed = pts.map((p) => ({ ...p, recorded_at: new Date(start.getTime() + Date.parse(p.recorded_at) - t0).toISOString() }))
    const seconds = (Date.parse(fixed.at(-1)!.recorded_at) - start.getTime()) / 1000
    const r = await asUser<{ r: R }>(db, U, '/rpc/submit_and_process_activity',
      `select public.submit_and_process_activity(p_title => 'Chạy', p_source => 'DIRECT_GPS', p_started_at => $1, p_ended_at => $2,
         p_elapsed_s => $3, p_moving_s => $3, p_distance_m => 0, p_avg_pace_s => 0, p_track_points => $4::jsonb) as r`,
      [start.toISOString(), new Date(start.getTime() + seconds * 1000).toISOString(), seconds, JSON.stringify(fixed)])
    return r.rows[0].r
  }

  beforeAll(async () => { db = await createDb({ withMigrations: true, runMigrationsTwice: true, seed }) }, 240_000)

  it('app gửi quãng đường đã hiệu chỉnh → lưu đúng số đó (không cộng nhiễu zig-zag); có từng km', async () => {
    const base = new Date(0)
    const noisy = await submit(zigzag(base, 1000, () => undefined))            // app cũ: cộng đoạn thẳng
    expect(Number(noisy.distance_m)).toBeGreaterThan(3100)                        // dư vì zig-zag
    const r = await submit(zigzag(base, 1000, (m) => m))
    expect(Number(r.distance_m)).toBe(3000)
    expect(r.validation_status).toBe('APPROVED')
    const d = (await db.query<{ splits: { distance_m: number; moving_s: number }[] }>(
      `select splits from public.activity_details where activity_id = $1`, [r.activity_id])).rows[0]
    expect(d.splits.map((s) => s.distance_m)).toEqual([1000, 1000, 1000])
    expect(d.splits[0].moving_s).toBeGreaterThanOrEqual(330)
    expect(d.splits[0].moving_s).toBeLessThanOrEqual(336)
    const last = (await db.query<{ distance_m: string }>(
      `select distance_m from public.activity_track_points where activity_id = $1 order by sequence desc`, [r.activity_id])).rows[0]
    expect(Number(last.distance_m)).toBe(3000)
  })

  it('khai khống (gấp đôi quãng đường) → bị kẹp, không vượt tuyến GPS', async () => {
    const r = await submit(zigzag(new Date(0), 1000, (m) => m * 2))
    const geo = await submit(zigzag(new Date(0), 1000, () => undefined))
    expect(Number(r.distance_m)).toBeLessThanOrEqual(Number(geo.distance_m))
  })
})
