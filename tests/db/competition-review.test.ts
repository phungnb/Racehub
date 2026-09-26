import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import type { PGlite } from '@electric-sql/pglite'
import { createDb, asUser } from './load-schema'

// Migration 008500: chống gian lận chỉ khi đang thi đấu, CLB miễn phí tối đa 50 thành viên, bảng so sánh gói, trang menu sửa được
const id = (n: number) => `00000000-0000-0000-0000-0000000085${String(n).padStart(2, '0')}`
const [FREE_RUNNER, RACER, OWNER, LATE] = [1, 2, 3, 4].map(id)
const CH = '00000000-0000-0000-0000-0000000085c1'
const CLUB = '00000000-0000-0000-0000-0000000085d1'

async function seed(db: PGlite) {
  const users = [FREE_RUNNER, RACER, OWNER, LATE]
  await db.exec(`
    insert into auth.users (id, email) values ${users.map((u, i) => `('${u}', 'cr${i}@x.vn')`).join(', ')};
    insert into public.profiles (id, display_name, xu, xp, level, created_at) values
      ${users.map((u, i) => `('${u}', 'CR${i}', 0, 0, 1, now())`).join(', ')} on conflict do nothing;
    insert into public.challenges (id, title, start_date, end_date, target_value, target_km, min_km, status, created_by, target_audience)
      values ('${CH}', 'Thử thách', now() - interval '10 days', now() + interval '10 days', 50, 50, 1, 'ACTIVE', '${OWNER}', 'PUBLIC');
    insert into public.challenge_participants (challenge_id, profile_id, status) values ('${CH}', '${RACER}', 'JOINED');
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

type R = { validation_status: string; validation_reason: string; activity_id: string; earned_xp: number }
const fails = async (p: Promise<unknown>) => { try { await p } catch (e) { return (e as Error).message } return 'OK' }

describe('chống gian lận chỉ khi thi đấu + CLB Free 50 thành viên (008500)', () => {
  let db: PGlite
  let hoursBack = 60
  // Bài giữ 20 km/h liên tục 3 phút → bộ kiểm tra gắn cờ nghi vấn
  const suspicious = async (uid: string) => {
    const start = new Date(Date.now() - (hoursBack -= 3) * 3600_000)
    const { pts, seconds } = track(start, [[600, 3], [180, 6], [600, 3]])
    return (await asUser<{ r: R }>(db, uid, '/rpc/submit_and_process_activity',
      `select public.submit_and_process_activity(p_title => 'Chạy', p_source => 'DIRECT_GPS', p_started_at => $1, p_ended_at => $2,
         p_elapsed_s => $3, p_moving_s => $3, p_distance_m => 0, p_avg_pace_s => 0, p_track_points => $4::jsonb) as r`,
      [start.toISOString(), new Date(start.getTime() + seconds * 1000).toISOString(), seconds, JSON.stringify(pts)])).rows[0].r
  }
  const ingest = async (uid: string, ext: string, act: Record<string, unknown>) => {
    await db.exec('set role service_role')
    try {
      return (await db.query<{ r: Record<string, unknown> }>(
        `select public.ingest_provider_activity($1, 'STRAVA', $2, $3::jsonb) as r`, [uid, ext, JSON.stringify(act)])).rows[0].r
    } finally { await db.exec('reset role') }
  }
  const row = async (aid: string) => (await db.query<{ validation_status: string; review_skipped: boolean; risk_level: string; earned_xp: number }>(
    `select validation_status, review_skipped, risk_level, earned_xp from public.activities where id = $1`, [aid])).rows[0]

  beforeAll(async () => { db = await createDb({ withMigrations: true, runMigrationsTwice: true, seed }) }, 240_000)

  it('không thi đấu: bài GPS nghi vấn tự duyệt (tính XP), vẫn lưu mức nghi vấn, đánh dấu review_skipped', async () => {
    const r = await suspicious(FREE_RUNNER)
    expect(r.validation_status).toBe('APPROVED')
    expect(r.validation_reason).toContain('Tự duyệt')
    expect(r.validation_reason).toContain('20 km/h')
    expect(Number(r.earned_xp)).toBeGreaterThan(0)
    expect(await row(r.activity_id)).toMatchObject({ validation_status: 'APPROVED', review_skipped: true, risk_level: 'HIGH' })
  })

  it('đang tham gia thử thách: bài nghi vấn vẫn chờ duyệt như cũ', async () => {
    const r = await suspicious(RACER)
    expect(r.validation_status).toBe('PENDING')
    expect(await row(r.activity_id)).toMatchObject({ review_skipped: false })
  })

  it('bài Strava: REVIEW ngoài thi đấu → tự duyệt; bài nhập tay vẫn chờ duyệt', async () => {
    const base = { sport_type: 'Run', elapsed_s: 1800, moving_s: 1800, distance_m: 5000, max_speed_mps: 4 }
    const a = await ingest(FREE_RUNNER, 's-1', { ...base, started_at: new Date(Date.now() - 80 * 3600_000).toISOString(),
      risk: { verdict: 'REVIEW', level: 'HIGH', score: 70, reason: 'Nhịp tim không khớp pace' } })
    expect(a.validation_status).toBe('APPROVED')
    expect((await row(a.activity_id as string)).review_skipped).toBe(true)
    const m = await ingest(FREE_RUNNER, 's-2', { ...base, manual: true, started_at: new Date(Date.now() - 90 * 3600_000).toISOString() })
    expect(m.validation_status).toBe('PENDING')
    const c = await ingest(RACER, 's-3', { ...base, started_at: new Date(Date.now() - 100 * 3600_000).toISOString(),
      risk: { verdict: 'REVIEW', level: 'HIGH', score: 70, reason: 'Nhịp tim không khớp pace' } })
    expect(c.validation_status).toBe('PENDING')
  })

  it('bài tự duyệt có dấu hiệu bất thường không tính vào thử thách tham gia sau đó; bài bình thường vẫn tính', async () => {
    const bad = await suspicious(LATE)
    expect(bad.validation_status).toBe('APPROVED')
    const start = new Date(Date.now() - (hoursBack -= 3) * 3600_000)
    const { pts, seconds } = track(start, [[1500, 3]])
    const ok = (await asUser<{ r: R }>(db, LATE, '/rpc/submit_and_process_activity',
      `select public.submit_and_process_activity(p_title => 'Chạy', p_source => 'DIRECT_GPS', p_started_at => $1, p_ended_at => $2,
         p_elapsed_s => $3, p_moving_s => $3, p_distance_m => 0, p_avg_pace_s => 0, p_track_points => $4::jsonb) as r`,
      [start.toISOString(), new Date(start.getTime() + seconds * 1000).toISOString(), seconds, JSON.stringify(pts)])).rows[0].r
    expect(ok.validation_status).toBe('APPROVED')
    await db.query(`insert into public.challenge_participants (challenge_id, profile_id, status) values ($1, $2, 'JOINED')`, [CH, LATE])
    const n = async (aid: string) => (await db.query<{ n: number }>(`select private.challenge_apply_activity($1) as n`, [aid])).rows[0].n
    expect(await n(bad.activity_id)).toBe(0)
    expect(await n(ok.activity_id)).toBe(1)
  })

  it('chạy lại file: bài đang chờ duyệt của người không thi đấu được tự duyệt; người đang thi đấu giữ nguyên', async () => {
    const pending = await db.query<{ id: string }>(`
      insert into public.activities (user_id, title, source, started_at, ended_at, distance_m, moving_distance_m, moving_time_s, elapsed_time_s,
        avg_pace_s, validation_status, validation_reason, status, is_manual)
      values ($1, 'Chạy', 'STRAVA', now() - interval '2 days', now() - interval '2 days' + interval '30 minutes', 5000, 5000, 1800, 1800, 360,
              'APPROVED', 'x', 'READY', false), ($2, 'Chạy', 'STRAVA', now() - interval '3 days', now() - interval '3 days' + interval '30 minutes',
              5000, 5000, 1800, 1800, 360, 'APPROVED', 'x', 'READY', false)
      returning id`, [FREE_RUNNER, RACER])
    const [a, b] = pending.rows.map((x) => x.id)
    await db.query(`update public.activities set validation_status = 'PENDING', status = 'PROCESSING',
                    validation_reason = 'Mức nghi vấn: Cao. GPS nhảy. Bài được tính sau khi ban quản trị CLB hoặc admin xác minh.' where id in ($1, $2)`, [a, b])
    await db.exec(readFileSync('supabase/migrations/20261001008500_competition_review_plans_menu.sql', 'utf8'))
    expect(await row(a)).toMatchObject({ validation_status: 'APPROVED', review_skipped: true })
    expect((await row(a)).earned_xp).toBeGreaterThan(0)
    expect((await row(b)).validation_status).toBe('PENDING')
  })

  it('CLB miễn phí nhận tối đa 50 thành viên; CLB Pro không giới hạn; không đuổi ai khi hạ gói', async () => {
    await db.exec(`
      insert into public.clubs (id, name, owner_id, invite_code) values ('${CLUB}', 'CLB 50', '${OWNER}', 'cr5001');
      insert into public.club_members (club_id, user_id, role, status) values ('${CLUB}', '${OWNER}', 'OWNER', 'APPROVED');
      insert into auth.users (id, email)
        select ('00000000-0000-0000-0000-00000085' || lpad(g::text, 4, '0'))::uuid, 'm' || g || '@cr.vn' from generate_series(1, 51) g;
      insert into public.club_members (club_id, user_id, role, status)
        select '${CLUB}', ('00000000-0000-0000-0000-00000085' || lpad(g::text, 4, '0'))::uuid, 'MEMBER', 'APPROVED' from generate_series(1, 49) g;
    `)
    const add = (g: number, status = 'APPROVED') => db.query(`insert into public.club_members (club_id, user_id, role, status)
      values ($1, ('00000000-0000-0000-0000-00000085' || lpad($2::text, 4, '0'))::uuid, 'MEMBER', $3)`, [CLUB, g, status])
    expect(await fails(add(50))).toContain('CLUB_FREE_FULL')
    expect(await fails(add(50, 'PENDING'))).toBe('OK')                    // vẫn xin vào được, chỉ chưa duyệt được
    expect(await fails(db.query(`update public.club_members set status = 'APPROVED' where club_id = $1 and user_id = '00000000-0000-0000-0000-000000850050'`, [CLUB])))
      .toContain('CLUB_FREE_FULL')
    await db.query(`update public.clubs set plan = 'PRO', pro_until = now() + interval '30 days' where id = $1`, [CLUB])
    expect(await fails(db.query(`update public.club_members set status = 'APPROVED' where club_id = $1 and user_id = '00000000-0000-0000-0000-000000850050'`, [CLUB])))
      .toBe('OK')
    expect(await fails(add(51))).toBe('OK')
    await db.query(`update public.clubs set plan = 'FREE' where id = $1`, [CLUB])
    expect((await db.query(`select 1 from public.club_members where club_id = $1 and status = 'APPROVED'`, [CLUB])).rows).toHaveLength(52)
  })

  it('bảng so sánh gói: người chưa đăng nhập xem được, không lộ tài khoản nhận tiền; có hạn mức CLB Free', async () => {
    const r = (await asUser<{ r: { plans: { code: string; prices: unknown[] }[]; club: Record<string, number>; payment?: unknown } }>(
      db, null, '/rpc/plan_compare', `select public.plan_compare() as r`)).rows[0].r
    expect(r.plans.map((p) => p.code)).toEqual(expect.arrayContaining(['VIP1', 'CLUB_PRO']))
    expect(r.club).toMatchObject({ freeMaxMembers: 50, freeMaxOpen: 2, proMaxOpen: 20 })
    expect(r.payment).toBeUndefined()
    const pro = (await db.query<{ perks: string[] }>(`select perks from public.plans where code = 'CLUB_PRO'`)).rows[0].perks
    expect(pro[0]).toBe('Không giới hạn thành viên')
  })

  it('Điều khoản, Quyền riêng tư, Doanh nghiệp nằm trong menu (admin sửa được); trang VIP đổi thành Gói & quyền lợi', async () => {
    const menu = (await asUser<{ r: { pages: { slug: string; title: string }[] } }>(db, null, '/rpc/help_menu', `select public.help_menu() as r`)).rows[0].r
    const slugs = menu.pages.map((p) => p.slug)
    expect(slugs).toEqual(expect.arrayContaining(['terms', 'privacy', 'doanh-nghiep', 'vip-pro']))
    expect(menu.pages.find((p) => p.slug === 'vip-pro')?.title).toBe('Gói & quyền lợi')
    const fair = (await db.query<{ body: string }>(`select body from public.help_pages where slug = 'cong-bang-chong-gian-lan'`)).rows[0].body
    expect(fair).toContain('ghi nhận tự động')
  })
})
