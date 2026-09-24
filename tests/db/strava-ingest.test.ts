import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createDb, asUser, ECON_V1 } from './load-schema'

const U = '00000000-0000-0000-0000-0000000000e1'
const OTHER = '00000000-0000-0000-0000-0000000000e2'

async function seed(db: PGlite) {
  await db.exec(`
    insert into auth.users (id, email) values ('${U}', 'u@x.vn'), ('${OTHER}', 'o@x.vn');
    insert into public.profiles (id, display_name, xu, xp, level, created_at) values
      ('${U}', 'U', 0, 0, 1, now()), ('${OTHER}', 'O', 0, 0, 1, now());
  `)
}

const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000).toISOString()
const run = (over: Record<string, unknown> = {}) => ({
  title: 'Morning Run', sport_type: 'Run', started_at: hoursAgo(3), elapsed_s: 1900, moving_s: 1800,
  distance_m: 5000, elevation_gain_m: 12, avg_speed_mps: 2.78, max_speed_mps: 4.1, avg_heartrate: 152,
  manual: false, has_gps: true, device_name: 'Garmin Forerunner 255', ...over,
})

describe('ingest_provider_activity', () => {
  let db: PGlite
  const ingest = async (ext: string, act: Record<string, unknown>, uid = U) => {
    await db.exec('set role service_role')
    try {
      return (await db.query<{ r: Record<string, unknown> }>(
        `select public.ingest_provider_activity($1, 'STRAVA', $2, $3::jsonb) as r`, [uid, ext, JSON.stringify(act)])).rows[0].r
    } finally { await db.exec('reset role') }
  }
  const xu = async (id: string) => Number((await db.query<{ xu: string }>(`select xu from public.profiles where id = $1`, [id])).rows[0].xu)

  beforeAll(async () => {
    db = await createDb({ seed, until: ECON_V1 })
    // Kết nối Strava cách đây 1 ngày
    await db.exec('set role service_role')
    await db.query(`select public.link_provider_connection($1, 'STRAVA', 'ath-1', 't', 'r', now() + interval '6 hours')`, [U])
    await db.exec('reset role')
    await db.query(`update public.connected_accounts set created_at = now() - interval '1 day' where user_id = $1`, [U])
  }, 120_000)

  it('bài chạy hợp lệ được nhập và thưởng ngay', async () => {
    const r = await ingest('1001', run())
    expect(r).toMatchObject({ result: 'IMPORTED', validation_status: 'APPROVED', earned_xu: 1.8, earned_xp: 50 })
    expect(await xu(U)).toBe(2.8)                // + nhiệm vụ ngày "chạy một bài từ 3 km" (000800)
  })

  it('webhook gửi lại cùng bài → không thưởng lần 2; đổi tên → UPDATED', async () => {
    expect((await ingest('1001', run())).result).toBe('DUPLICATE')
    expect((await ingest('1001', run({ title: 'Chạy Hồ Tây' }))).result).toBe('UPDATED')
    expect(await xu(U)).toBe(2.8)
  })

  it('đạp xe / quá ngắn → bỏ qua, không lưu', async () => {
    expect(await ingest('2001', run({ sport_type: 'Ride', started_at: hoursAgo(10) }))).toMatchObject({ result: 'SKIPPED', reason: 'NOT_RUN' })
    expect(await ingest('2002', run({ distance_m: 150, started_at: hoursAgo(11) }))).toMatchObject({ result: 'SKIPPED', reason: 'TOO_SHORT' })
    const n = await db.query(`select 1 from public.activities where source_activity_id in ('2001', '2002')`)
    expect(n.rows).toHaveLength(0)
  })

  it('bài nhập tay, chạy máy, thiếu GPS, tốc độ bất thường → chờ duyệt, chưa thưởng', async () => {
    const before = await xu(U)
    expect((await ingest('3001', run({ manual: true, started_at: hoursAgo(12) }))).validation_status).toBe('PENDING')
    expect((await ingest('3002', run({ sport_type: 'VirtualRun', started_at: hoursAgo(13) }))).validation_status).toBe('PENDING')
    expect((await ingest('3003', run({ has_gps: false, started_at: hoursAgo(14) }))).validation_status).toBe('PENDING')
    expect((await ingest('3004', run({ max_speed_mps: 20, started_at: hoursAgo(15) }))).validation_status).toBe('PENDING')
    expect((await ingest('3005', run({ moving_s: 600, started_at: hoursAgo(16) }))).validation_status).toBe('PENDING')   // 2:00/km
    expect(await xu(U)).toBe(before)
  })

  it('cùng buổi chạy đã ghi bằng GPS trong app → không tính lần 2', async () => {
    await db.query(`insert into public.activities (user_id, source, started_at, ended_at, distance_m, moving_time_s, status, validation_status, rewarded_at)
                    values ($1, 'DIRECT_GPS', now() - interval '20 hours', now() - interval '19 hours 30 minutes', 5000, 1800, 'COMPLETED', 'APPROVED', now())`, [U])
    expect(await ingest('4001', run({ started_at: hoursAgo(19.9) }))).toMatchObject({ result: 'SKIPPED', reason: 'OVERLAPS_EXISTING_ACTIVITY' })
  })

  it('bài chạy trước thời điểm kết nối → lưu lịch sử, không thưởng', async () => {
    const before = await xu(U)
    const r = await ingest('5001', run({ started_at: hoursAgo(24 * 5) }))
    expect(r).toMatchObject({ result: 'IMPORTED', validation_status: 'APPROVED', history_only: true, earned_xu: 0 })
    expect(await xu(U)).toBe(before)
  })

  it('bài bị xóa trên Strava → thu hồi Xu và XP (cả thưởng nhiệm vụ, huy hiệu của bài đó)', async () => {
    const xpBefore = Number((await db.query<{ xp: number }>(`select xp from public.profiles where id = $1`, [U])).rows[0].xp)
    await db.exec('set role service_role')
    const r = (await db.query<{ r: Record<string, unknown> }>(`select public.remove_provider_activity('STRAVA', '1001') as r`)).rows[0].r
    const again = (await db.query<{ r: Record<string, unknown> }>(`select public.remove_provider_activity('STRAVA', '1001') as r`)).rows[0].r
    await db.exec('reset role')
    expect(r).toMatchObject({ result: 'DELETED', reversed_xu: 1.8, reversed_xp: 50 })
    expect(again.result).toBe('ALREADY_DELETED')
    expect(await xu(U)).toBe(0)
    // 50 XP bài chạy + 30 XP nhiệm vụ + 2 huy hiệu (km đầu tiên, 5K) × 100 XP
    expect(Number((await db.query<{ xp: number }>(`select xp from public.profiles where id = $1`, [U])).rows[0].xp)).toBe(xpBefore - 280)
    expect((await db.query(`select 1 from public.user_achievements where user_id = $1`, [U])).rows).toHaveLength(0)
    const sum = await db.query<{ s: string }>(`select coalesce(sum(amount), 0) s from public.ledger_entries`)
    expect(Number(sum.rows[0].s)).toBe(0)
  })

  it('không nhập bài của người này vào tài khoản người khác', async () => {
    await expect(ingest('5001', run({ started_at: hoursAgo(24 * 5) }), OTHER)).rejects.toThrow(/ACTIVITY_OWNER_MISMATCH/)
  })

  it('người dùng không tự gọi được hàm nhập bài; chỉ xem được kết nối của mình', async () => {
    await expect(asUser(db, U, '/rpc/ingest_provider_activity',
      `select public.ingest_provider_activity($1, 'STRAVA', '9', '{}'::jsonb)`, [U])).rejects.toThrow(/permission denied/)
    const mine = await asUser<{ provider: string }>(db, U, '/rpc/my_provider_connections', `select * from public.my_provider_connections()`)
    expect(mine.rows).toEqual([expect.objectContaining({ provider: 'STRAVA', provider_user_id: 'ath-1' })])
    expect(Object.keys(mine.rows[0])).not.toContain('access_token')
    const other = await asUser(db, OTHER, '/rpc/my_provider_connections', `select * from public.my_provider_connections()`)
    expect(other.rows).toHaveLength(0)
  })
})
