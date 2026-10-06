import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createDb, asUser } from './load-schema'

// Migration 013400 (Chỉnh sửa lần 7, Phụng chốt 06/10/2026): "GPS nhảy nếu Strava có GPS (mặc dù nhảy) thì RaceHub vẫn ghi nhận;
// chỉ không ghi nhận trường hợp nhập tay; cảnh báo chạy máy (hoàn toàn không có GPS)" + danh sách "Bài có cảnh báo"
const [OWNER, RUN, ADM, OTHER, OUTSIDER] = ['00000000-0000-0000-0000-0000000134a1', '00000000-0000-0000-0000-0000000134a2',
  '00000000-0000-0000-0000-0000000134a3', '00000000-0000-0000-0000-0000000134a4', '00000000-0000-0000-0000-0000000134a5']
const CLUB = '00000000-0000-0000-0000-0000000134c1'

async function seed(db: PGlite) {
  await db.exec(`
    insert into auth.users (id, email) values ('${OWNER}', 'r7o@x.vn'), ('${RUN}', 'r7r@x.vn'), ('${ADM}', 'r7a@x.vn'),
      ('${OTHER}', 'r7m@x.vn'), ('${OUTSIDER}', 'r7x@x.vn');
    insert into public.profiles (id, display_name, xu, xp, level, created_at) values
      ('${OWNER}', 'Chủ nhiệm', 0, 0, 1, now()), ('${RUN}', 'Runner', 0, 0, 1, now()), ('${ADM}', 'Admin', 0, 0, 1, now()),
      ('${OTHER}', 'Thành viên', 0, 0, 1, now()), ('${OUTSIDER}', 'Người ngoài', 0, 0, 1, now()) on conflict do nothing;
    insert into public.clubs (id, name, owner_id, invite_code) values ('${CLUB}', 'CLB Lần 7', '${OWNER}', 'r70001');
    insert into public.club_members (club_id, user_id, role, status) values
      ('${CLUB}', '${OWNER}', 'OWNER', 'APPROVED'), ('${CLUB}', '${RUN}', 'MEMBER', 'APPROVED'), ('${CLUB}', '${OTHER}', 'MEMBER', 'APPROVED')
      on conflict do nothing;
  `)
}
const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000).toISOString()
const run = (over: Record<string, unknown> = {}) => ({
  title: 'Run', sport_type: 'Run', started_at: hoursAgo(3), elapsed_s: 2200, moving_s: 2100,
  distance_m: 7500, avg_speed_mps: 3.5, max_speed_mps: 5, manual: false, has_gps: true, ...over,
})
// Kết quả bộ phân tích fraud.ts (ac-2026.10.7) cho bài GPS nhảy: OK + cảnh báo
const gpsJumpRisk = {
  verdict: 'OK', score: 30, level: 'LOW', reason: null,
  flags: [
    { code: 'GPS_DISTANCE_GAIN', severity: 'HIGH', tier: 'WARN', message: 'Vị trí dịch chuyển 1200 m trong vài giây', gpsJump: true },
    { code: 'GPS_TELEPORT', severity: 'HIGH', tier: 'WARN', message: '3 lần vị trí nhảy xa bất thường', gpsJump: true },
    { code: 'PACE_CURVE', severity: 'SEVERE', tier: 'WARN', message: 'Pace TB 1:40/km suốt 1 phút', gpsJump: true },
  ],
}
type Warned = { id: string; distance_m: number; warnings: { code: string; tier: string; gpsJump: boolean }[]; profiles: { display_name: string } }

describe('Luật Strava lần 7 (013400)', () => {
  let db: PGlite
  const ingest = async (ext: string, act: Record<string, unknown>, uid = RUN) => {
    await db.exec('set role service_role')
    try {
      return (await db.query<{ r: Record<string, unknown> }>(
        `select public.ingest_provider_activity($1, 'STRAVA', $2, $3::jsonb) as r`, [uid, ext, JSON.stringify(act)])).rows[0].r
    } finally { await db.exec('reset role') }
  }
  const row = async (ext: string) => (await db.query<Record<string, any>>(
    `select id, distance_m, status, validation_status, validation_reason, risk_flags, rewarded_at from public.activities where source_activity_id = $1`, [ext])).rows[0]
  const xu = async (uid = RUN) => Number((await db.query<{ b: string }>(`select private.balance($1, null) as b`, [uid])).rows[0].b)
  const warned = async (uid: string, club: string | null) => (await asUser<{ r: Warned[] }>(db, uid, '/rpc/warned_activities',
    `select public.warned_activities($1, 30) as r`, [club])).rows[0].r
  const fails = async (p: Promise<unknown>) => { try { await p } catch (e) { return (e as Error).message } return 'OK' }

  beforeAll(async () => {
    db = await createDb({ withMigrations: true, runMigrationsTwice: true, seed })
    await db.exec('set role service_role')
    for (const [u, ath] of [[RUN, 'ath-1341'], [OUTSIDER, 'ath-1342']]) {
      await db.query(`select public.link_provider_connection($1, 'STRAVA', $2, 't', 'r', now() + interval '6 hours')`, [u, ath])
    }
    await db.exec('reset role')
    await db.query(`update public.connected_accounts set created_at = now() - interval '3 days'`)
    await db.query(`update public.profiles set role = 'SYSTEM_ADMIN' where id = $1`, [ADM])
    // Người chạy đồng ý chia sẻ bài Strava cho CLB (007000)
    await db.query(`insert into public.profile_settings (user_id, strava_share) values ($1, true) on conflict (user_id) do update set strava_share = true`, [RUN])
  }, 240_000)

  it('bài có GPS dù nhảy → ghi nhận ngay (APPROVED, có thưởng), km Strava giữ nguyên, cảnh báo được lưu', async () => {
    const before = await xu()
    const r = await ingest('13401', run({ started_at: hoursAgo(5), risk: gpsJumpRisk,
      analysis: { engine: 'ac-2026.10.7', verdict: 'OK', score: 30, level: 'LOW', clean_distance_m: 6300, flags: gpsJumpRisk.flags } }))
    expect(r.validation_status).toBe('APPROVED')
    const a = await row('13401')
    expect(Number(a.distance_m)).toBe(7500)
    expect(a.validation_status).toBe('APPROVED')
    expect(a.rewarded_at).not.toBeNull()
    expect(a.risk_flags.map((f: { code: string }) => f.code)).toEqual(['GPS_DISTANCE_GAIN', 'GPS_TELEPORT', 'PACE_CURVE'])
    expect(await xu()).toBeGreaterThan(before)
  })

  it('pace TB "nhanh hơn kỷ lục" chỉ vì GPS nhảy cộng thêm km → vẫn ghi nhận (kiểm theo quãng đường đã bỏ cú nhảy)', async () => {
    // Strava báo 12 km / 33 phút (2:45/km) nhưng bỏ cú nhảy chỉ còn 7 km (4:43/km)
    const r = await ingest('13402', run({ started_at: hoursAgo(9), distance_m: 12000, moving_s: 1980, elapsed_s: 2000, risk: gpsJumpRisk,
      analysis: { engine: 'ac-2026.10.7', verdict: 'OK', clean_distance_m: 7000, flags: gpsJumpRisk.flags } }))
    expect(r.validation_status).toBe('APPROVED')
    expect(Number((await row('13402')).distance_m)).toBe(12000)
    // Không có quãng đường đã bỏ cú nhảy (không phân tích được) → pace nhanh hơn kỷ lục vẫn chờ duyệt như cũ
    expect((await ingest('13403', run({ started_at: hoursAgo(12), distance_m: 12000, moving_s: 1980, elapsed_s: 2000 }))).validation_status).toBe('PENDING')
  })

  it('bài nhập tay → không ghi nhận (REJECTED), người chạy thấy lý do, không cộng Xu; không khôi phục được', async () => {
    const before = await xu()
    const r = await ingest('13404', run({ started_at: hoursAgo(15), manual: true, has_gps: false,
      risk: { verdict: 'REJECT', score: 0, level: 'LOW', reason: 'Bài nhập tay không được ghi nhận', flags: [] } }))
    expect(r).toMatchObject({ result: 'IMPORTED', validation_status: 'REJECTED', reason: 'Bài nhập tay không được ghi nhận.', earned_xu: 0 })
    const a = await row('13404')
    expect(a).toMatchObject({ status: 'REJECTED', validation_status: 'REJECTED', validation_reason: 'Bài nhập tay không được ghi nhận.' })
    expect(a.risk_flags).toEqual([expect.objectContaining({ code: 'MANUAL', tier: 'DISQUALIFY' })])
    expect(await xu()).toBe(before)
    // Không tính vào thống kê km (bài không "countable")
    const countable = (await db.query<{ c: boolean }>(`select public.activity_is_countable($1, $2) as c`, [a.status, a.validation_status])).rows[0].c
    expect(countable).toBe(false)
    // Chủ nhiệm CLB thấy ở "Bài đã loại" nhưng không khôi phục được
    const rej = (await asUser<{ r: { id: string; manual: boolean }[] }>(db, OWNER, '/rpc', `select public.rejected_activities($1, 30) as r`, [CLUB])).rows[0].r
    expect(rej.find((x) => x.id === a.id)).toMatchObject({ manual: true })
    expect(await fails(asUser(db, OWNER, '/rpc', `select public.restore_activity($1, 'Xem lại thấy hợp lệ')`, [a.id]))).toContain('MANUAL_NOT_COUNTED')
    // Không có risk (không qua bộ phân tích) cũng vậy
    expect((await ingest('13405', run({ started_at: hoursAgo(18), manual: true }))).validation_status).toBe('REJECTED')
  })

  it('chạy máy / hoàn toàn không có GPS → ghi nhận ngay, kèm cảnh báo TREADMILL', async () => {
    const vr = await ingest('13406', run({ started_at: hoursAgo(21), sport_type: 'VirtualRun', has_gps: false }))
    expect(vr.validation_status).toBe('APPROVED')
    expect((await row('13406')).risk_flags).toEqual([expect.objectContaining({ code: 'TREADMILL', tier: 'WARN' })])
    const nogps = await ingest('13407', run({ started_at: hoursAgo(24), has_gps: false,
      risk: { verdict: 'OK', score: 0, level: 'LOW', flags: [{ code: 'TREADMILL', severity: 'HIGH', tier: 'WARN', message: 'Bài hoàn toàn không có GPS' }] } }))
    expect(nogps.validation_status).toBe('APPROVED')
    expect((await row('13407')).risk_flags).toHaveLength(1)            // không thêm trùng cảnh báo TREADMILL
  })

  it('dấu hiệu không do GPS nhảy vẫn chờ duyệt như cũ', async () => {
    const r = await ingest('13408', run({ started_at: hoursAgo(27),
      risk: { verdict: 'REVIEW', score: 80, level: 'HIGH', reason: 'Pace 4:00/km nhưng nhịp tim chỉ 95 bpm', flags: [{ code: 'HR_PACE', severity: 'SEVERE', tier: 'SUSPECT' }] } }))
    expect(r.validation_status).toBe('PENDING')
  })

  it('"Bài có cảnh báo": admin thấy toàn hệ thống; Ban quản trị CLB chỉ thấy bài thành viên CLB mình; người khác bị từ chối', async () => {
    await ingest('13409', run({ started_at: hoursAgo(30), risk: gpsJumpRisk }), OUTSIDER)          // người ngoài CLB
    await ingest('13410', run({ started_at: hoursAgo(33), risk: { verdict: 'OK', score: 0, level: 'LOW', flags: [
      { code: 'GPS_DISTANCE_GAIN', severity: 'INFO', tier: 'NOTE', message: 'GPS nhảy cộng thêm 80 m' }] } }))        // chỉ ghi chú → không vào danh sách

    const all = await warned(ADM, null)
    const ids = async (...exts: string[]) => Promise.all(exts.map(async (e) => (await row(e)).id as string))
    const [gps, gps2, vr, nogps, outsider, note, manual, pending] = await ids('13401', '13402', '13406', '13407', '13409', '13410', '13404', '13408')
    expect(all.map((x) => x.id)).toEqual(expect.arrayContaining([gps, gps2, vr, nogps, outsider]))
    for (const x of [note, manual, pending]) expect(all.map((w) => w.id)).not.toContain(x)
    const g = all.find((x) => x.id === gps)!
    expect(g.profiles.display_name).toBe('Runner')
    expect(Number(g.distance_m)).toBe(7500)
    expect(g.warnings).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'GPS_TELEPORT', tier: 'WARN', gpsJump: true })]))
    expect(all.find((x) => x.id === vr)!.warnings).toEqual([expect.objectContaining({ code: 'TREADMILL', gpsJump: false })])

    const club = await warned(OWNER, CLUB)
    expect(club.map((x) => x.id)).toEqual(expect.arrayContaining([gps, vr]))
    expect(club.map((x) => x.id)).not.toContain(outsider)
    expect((await warned(ADM, CLUB)).map((x) => x.id)).not.toContain(outsider)

    expect(await fails(warned(OWNER, null))).toContain('FORBIDDEN')          // chủ nhiệm CLB không xem toàn hệ thống
    expect(await fails(warned(OTHER, CLUB))).toContain('FORBIDDEN')          // thành viên thường
    expect(await fails(warned(OUTSIDER, CLUB))).toContain('FORBIDDEN')
    expect(await fails(warned(OUTSIDER, null))).toContain('FORBIDDEN')
  })

  it('quyền gọi: anon không gọi được warned_activities; ingest chỉ service_role', async () => {
    const can = (await db.query<{ anon: boolean; auth: boolean; ingest: boolean }>(`select
      has_function_privilege('anon', 'public.warned_activities(uuid, integer)', 'execute') as anon,
      has_function_privilege('authenticated', 'public.warned_activities(uuid, integer)', 'execute') as auth,
      has_function_privilege('authenticated', 'public.ingest_provider_activity(uuid, text, text, jsonb)', 'execute') as ingest`)).rows[0]
    expect(can).toEqual({ anon: false, auth: true, ingest: false })
  })
})
