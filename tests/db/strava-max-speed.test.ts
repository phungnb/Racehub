import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createDb } from './load-schema'

// Migration 012400: "vận tốc tối đa" một điểm của Strava chỉ chặn bài khi KHÔNG có kết quả phân tích chi tiết
const U = '00000000-0000-0000-0000-0000000124e1'

async function seed(db: PGlite) {
  await db.exec(`
    insert into auth.users (id, email) values ('${U}', 'ms@x.vn');
    insert into public.profiles (id, display_name, xu, xp, level, created_at) values ('${U}', 'U', 0, 0, 1, now()) on conflict do nothing;
  `)
}
const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000).toISOString()
const run = (over: Record<string, unknown> = {}) => ({
  title: 'Morning Run', sport_type: 'Run', started_at: hoursAgo(3), elapsed_s: 2200, moving_s: 2140,
  distance_m: 7460, avg_speed_mps: 3.48, max_speed_mps: 20.3, manual: false, has_gps: true, ...over,
})
const OK_RISK = { verdict: 'OK', score: 14, level: 'LOW', reason: null, flags: [] }

describe('Strava: một điểm GPS nhảy không làm bài bị chặn (012400)', () => {
  let db: PGlite
  const ingest = async (ext: string, act: Record<string, unknown>) => {
    await db.exec('set role service_role')
    try {
      return (await db.query<{ r: Record<string, unknown> }>(
        `select public.ingest_provider_activity($1, 'STRAVA', $2, $3::jsonb) as r`, [U, ext, JSON.stringify(act)])).rows[0].r
    } finally { await db.exec('reset role') }
  }
  beforeAll(async () => {
    db = await createDb({ withMigrations: true, runMigrationsTwice: true, seed })
    await db.exec('set role service_role')
    await db.query(`select public.link_provider_connection($1, 'STRAVA', 'ath-124', 't', 'r', now() + interval '6 hours')`, [U])
    await db.exec('reset role')
    await db.query(`update public.connected_accounts set created_at = now() - interval '2 days' where user_id = $1`, [U])
  }, 240_000)

  it('đã phân tích chi tiết và bình thường → hợp lệ dù vận tốc tối đa 73 km/h', async () => {
    expect((await ingest('12401', run({ started_at: hoursAgo(5), risk: OK_RISK }))).validation_status).toBe('APPROVED')
  })
  // 013400 (lần 7, đổi có chủ đích): bài có GPS, vận tốc tối đa một điểm (GPS nhảy) → ghi nhận ngay, chỉ cảnh báo
  it('không có phân tích chi tiết → vẫn ghi nhận (bài có GPS), lưu cảnh báo vận tốc tối đa', async () => {
    expect((await ingest('12402', run({ started_at: hoursAgo(8) }))).validation_status).toBe('APPROVED')
    const flags = (await db.query<{ risk_flags: { code: string; tier: string }[] }>(
      `select risk_flags from public.activities where source_activity_id = '12402'`)).rows[0].risk_flags
    expect(flags).toEqual([expect.objectContaining({ code: 'VEHICLE_BURST', tier: 'WARN' })])
  })
  it('bộ phân tích kết luận REVIEW → chờ duyệt, lưu mức nghi vấn của bộ phân tích', async () => {
    const r = await ingest('12403', run({ started_at: hoursAgo(11), max_speed_mps: 4,
      risk: { verdict: 'REVIEW', score: 90, level: 'CRITICAL', reason: 'Pace TB 2:11/km suốt 5 phút — nhanh hơn kỷ lục thế giới cùng thời lượng', flags: [] } }))
    expect(r.validation_status).toBe('PENDING')
    const row = (await db.query<{ risk_level: string; risk_score: number }>(
      `select risk_level, risk_score from public.activities where source_activity_id = '12403'`)).rows[0]
    expect(row).toMatchObject({ risk_level: 'CRITICAL', risk_score: 90 })
  })
})
