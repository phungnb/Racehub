import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createDb, asUser } from './load-schema'

// Nghiệp vụ sau migration, trên schema production có sẵn dữ liệu.
const RUNNER = '00000000-0000-0000-0000-0000000000c1'
const RICH = '00000000-0000-0000-0000-0000000000c2'
const FRIEND = '00000000-0000-0000-0000-0000000000c3'
const ADMIN = '00000000-0000-0000-0000-0000000000ad'
const CLUB = '00000000-0000-0000-0000-00000000c1ab'
const CHALLENGE = '00000000-0000-0000-0000-0000000c4a11'

async function seed(db: PGlite) {
  await db.exec(`
    insert into auth.users (id, email) values
      ('${RUNNER}', 'runner@x.vn'), ('${RICH}', 'rich@x.vn'), ('${FRIEND}', 'friend@x.vn'), ('${ADMIN}', 'admin@x.vn');
    insert into public.profiles (id, display_name, xu, xp, level, role, created_at) values
      ('${RUNNER}', 'Runner', 10, 0, 1, 'MEMBER', now()),
      ('${RICH}', 'Rich', 300.5, 2400, 5, 'MEMBER', now()),
      ('${FRIEND}', 'Friend', 0, 0, 1, 'MEMBER', now()),
      ('${ADMIN}', 'Admin', 0, 0, 1, 'SYSTEM_ADMIN', now());
    insert into public.clubs (id, name, owner_id, invite_code, treasury_balance) values ('${CLUB}', 'Hồ Tây', '${RICH}', 'hotay1', 100);
    insert into public.club_members (club_id, user_id, role, status) values
      ('${CLUB}', '${RICH}', 'OWNER', 'APPROVED'), ('${CLUB}', '${RUNNER}', 'MEMBER', 'APPROVED');
    insert into public.challenges (id, title, start_date, end_date, target_value, target_km, min_km, status)
      values ('${CHALLENGE}', '5K tuần này', now() - interval '1 day', now() + interval '6 days', 5, 5, 1, 'ACTIVE');
    insert into public.challenge_participants (challenge_id, profile_id, status) values ('${CHALLENGE}', '${RUNNER}', 'JOINED');
  `)
}

/** Lộ trình GPS chạy thẳng về phía bắc với pace (giây/km) cho trước, 1 điểm / 10 giây */
function track(km: number, paceS: number, start: Date, opts: { teleportEvery?: number } = {}) {
  const pts = []
  const step = 10
  const mps = 1000 / paceS
  const n = Math.round((km * 1000) / (mps * step))
  let lat = 21.03
  for (let i = 0; i <= n; i++) {
    const jump = opts.teleportEvery && i > 0 && i % opts.teleportEvery === 0 ? 0.01 : 0   // ~1,1 km trong 10 giây
    if (i > 0) lat += (mps * step) / 111320 + jump
    pts.push({ latitude: lat, longitude: 105.85, recorded_at: new Date(start.getTime() + i * step * 1000).toISOString() })
  }
  return pts
}

async function submit(db: PGlite, uid: string, km: number, paceS: number, minutesAgo: number,
                      extra: { points?: unknown[]; clientKm?: number } = {}) {
  const start = new Date(Date.now() - minutesAgo * 60_000)
  const moving = Math.round(km * paceS)
  const end = new Date(start.getTime() + moving * 1000)
  const pts = extra.points ?? track(km, paceS, start)
  const r = await asUser<{ r: Record<string, unknown> }>(db, uid, '/rpc/submit_and_process_activity',
    `select public.submit_and_process_activity(p_title => 'Chạy', p_source => 'DIRECT_GPS', p_started_at => $1, p_ended_at => $2,
       p_elapsed_s => $3, p_moving_s => $3, p_distance_m => $4, p_avg_pace_s => $5, p_track_points => $6::jsonb) as r`,
    [start.toISOString(), end.toISOString(), moving, Math.round((extra.clientKm ?? km) * 1000), paceS, JSON.stringify(pts)])
  return r.rows[0].r
}

const num = async (db: PGlite, sql: string, params: unknown[] = []) =>
  Number(Object.values((await db.query<Record<string, unknown>>(sql, params)).rows[0])[0])
const xu = (db: PGlite, id: string) => num(db, `select xu from public.profiles where id = $1`, [id])
const ledgerBalance = (db: PGlite, id: string) => num(db, `select coalesce(sum(amount), 0) from public.ledger_entries where account_id = $1`, [id])

describe('kinh tế & bài chạy (sau migration)', () => {
  let db: PGlite
  beforeAll(async () => { db = await createDb({ seed }) }, 120_000)

  it('đối soát: sổ cái khớp số Xu cũ của user và quỹ CLB', async () => {
    expect(await ledgerBalance(db, RUNNER)).toBe(10)
    expect(await ledgerBalance(db, RICH)).toBe(300.5)
    expect(await ledgerBalance(db, CLUB)).toBe(100)
  })

  it('cấp độ được tính lại theo bảng trong tài liệu (2.400 XP = Lv2)', async () => {
    expect(await num(db, `select level from public.profiles where id = $1`, [RICH])).toBe(2)
  })

  it('bài chạy GPS hợp lệ 5 km: thưởng qua sổ cái, cộng XP, hoàn thành thử thách 5K', async () => {
    const r = await submit(db, RUNNER, 5, 360, 120)
    expect(r.validation_status).toBe('APPROVED')
    expect(Math.abs(Number(r.distance_m) - 5000)).toBeLessThan(60)
    expect(Number(r.earned_xu)).toBeCloseTo(5, 0)            // kmRate mặc định 1 Xu/km
    expect(Number(r.earned_xp)).toBe(50)                      // 10 XP/km
    expect(await xu(db, RUNNER)).toBeCloseTo(15, 0)
    expect(await ledgerBalance(db, RUNNER)).toBe(await xu(db, RUNNER))
    const p = await db.query<{ current_progress: string; status: string }>(
      `select current_progress, status from public.challenge_participants where profile_id = $1`, [RUNNER])
    expect(Number(p.rows[0].current_progress)).toBeGreaterThanOrEqual(4.9)
  })

  it('gửi lại bài chạy trùng thời gian bị từ chối', async () => {
    await expect(submit(db, RUNNER, 5, 360, 120)).rejects.toThrow(/ACTIVITY_DUPLICATE/)
  })

  it('không có GPS / nhảy vị trí / khai khống quãng đường → chờ duyệt, không thưởng', async () => {
    const before = await xu(db, RUNNER)
    const noGps = await submit(db, RUNNER, 5, 360, 300, { points: [] })
    expect(noGps.validation_status).toBe('PENDING')
    const start = new Date(Date.now() - 400 * 60_000)
    const teleport = await submit(db, RUNNER, 5, 360, 400, { points: track(5, 360, start, { teleportEvery: 5 }) })
    expect(teleport.validation_status).toBe('PENDING')
    const inflated = await submit(db, RUNNER, 5, 360, 500, { clientKm: 42 })
    expect(inflated.validation_status).toBe('PENDING')
    expect(Math.abs(Number(inflated.distance_m) - 5000)).toBeLessThan(60)   // lưu theo GPS, không theo số client gửi
    expect(await xu(db, RUNNER)).toBe(before)
  })

  it('bài quá ngắn bị từ chối; pace nhanh bất thường phải chờ duyệt', async () => {
    expect((await submit(db, RUNNER, 0.1, 360, 600)).validation_status).toBe('REJECTED')
    expect((await submit(db, RUNNER, 5, 120, 700)).validation_status).toBe('PENDING')   // 2:00/km
  })

  it('duyệt bài: user thường / tự duyệt bị chặn; admin duyệt thì thưởng đúng một lần', async () => {
    const pending = (await db.query<{ id: string }>(
      `select id from public.activities where user_id = $1 and validation_status = 'PENDING' order by created_at limit 1`, [RUNNER])).rows[0].id
    await expect(asUser(db, RUNNER, '/rpc/review_activity', `select public.review_activity($1, 'APPROVED')`, [pending])).rejects.toThrow(/FORBIDDEN/)
    await expect(asUser(db, FRIEND, '/rpc/review_activity', `select public.review_activity($1, 'APPROVED')`, [pending])).rejects.toThrow(/FORBIDDEN/)
    const before = await xu(db, RUNNER)
    await asUser(db, ADMIN, '/rpc/review_activity', `select public.review_activity($1, 'APPROVED')`, [pending])
    const after = await xu(db, RUNNER)
    expect(after).toBeGreaterThan(before)
    await expect(asUser(db, ADMIN, '/rpc/review_activity', `select public.review_activity($1, 'APPROVED')`, [pending]))
      .rejects.toThrow(/ACTIVITY_NOT_PENDING/)
    expect(await xu(db, RUNNER)).toBe(after)
  })

  it('chủ nhiệm CLB được duyệt bài của thành viên CLB mình', async () => {
    const pending = (await db.query<{ id: string }>(
      `select id from public.activities where user_id = $1 and validation_status = 'PENDING' order by created_at limit 1`, [RUNNER])).rows[0].id
    await asUser(db, RICH, '/rpc/review_activity', `select public.review_activity($1, 'REJECTED')`, [pending])
    expect((await db.query<{ v: string }>(`select validation_status v from public.activities where id = $1`, [pending])).rows[0].v).toBe('REJECTED')
  })

  it('trần thưởng mỗi ngày theo cấu hình admin', async () => {
    await asUser(db, ADMIN, '/rpc/admin_publish_config',
      `select public.admin_publish_config('economy_global_config', '{"kmRate": 20, "maxDailyReward": 30}')`)
    const r = await submit(db, FRIEND, 3, 360, 60)
    expect(Number(r.earned_xu)).toBe(30)                     // 3 km × 20 = 60, nhưng trần 30/ngày
    const r2 = await submit(db, FRIEND, 3, 360, 200)
    expect(Number(r2.earned_xu)).toBe(0)
  })

  it('tạo thử thách: thu phí qua sổ cái, không đủ Xu thì từ chối, gửi lại không thu 2 lần', async () => {
    const call = (uid: string, key: string, title = 'Thử thách tháng 10') => asUser<{ r: Record<string, unknown> }>(db, uid, '/rpc/create_challenge_with_ledger',
      `select public.create_challenge_with_ledger(p_title => $2, p_challenge_type => 'INDIVIDUAL', p_game_mode => 'ACCUMULATE',
         p_target_km => 100, p_min_km => 2, p_min_members => 1, p_fixed_team_size => 0, p_target_audience => 'PUBLIC',
         p_start_date => now(), p_end_date => now() + interval '10 days', p_reg_deadline => now() + interval '2 days',
         p_min_pace => 3, p_max_pace => 12, p_max_slots => 20, p_idempotency_key => $1) as r`, [key, title])
    await expect(call(FRIEND, 'key-friend-0001')).rejects.toThrow(/INSUFFICIENT_BALANCE/)
    const before = await xu(db, RICH)
    const r1 = (await call(RICH, 'key-rich-00001')).rows[0].r
    expect(r1.charged_fee).toBe(50)
    expect(await xu(db, RICH)).toBe(before - 50)
    const r2 = (await call(RICH, 'key-rich-00001')).rows[0].r
    expect(r2.duplicate).toBe(true)
    expect(r2.challenge_id).toBe(r1.challenge_id)
    expect(await xu(db, RICH)).toBe(before - 50)
    await expect(call(RICH, 'key-rich-00002', 'x')).rejects.toThrow(/INVALID_TITLE/)
  })

  it('đóng góp quỹ CLB: trừ ví, cộng quỹ; không phải thành viên thì bị từ chối', async () => {
    const before = await xu(db, RUNNER)
    await asUser(db, RUNNER, '/rpc/contribute_treasury', `select public.contribute_treasury($1, 5)`, [CLUB])
    expect(await xu(db, RUNNER)).toBeCloseTo(before - 5, 5)
    expect(await num(db, `select treasury_balance from public.clubs where id = $1`, [CLUB])).toBe(105)
    await expect(asUser(db, FRIEND, '/rpc/contribute_treasury', `select public.contribute_treasury($1, 1)`, [CLUB]))
      .rejects.toThrow(/NOT_A_MEMBER/)
    await expect(asUser(db, RUNNER, '/rpc/contribute_treasury', `select public.contribute_treasury($1, 99999)`, [CLUB]))
      .rejects.toThrow(/INSUFFICIENT_FUNDS/)
  })

  it('tạo CLB mới: quỹ bắt đầu từ 0 (không còn tặng 100 Xu từ hư không)', async () => {
    const r = await asUser<{ c: { treasury_balance: string; member_count: number } }>(db, FRIEND, '/rpc/create_club',
      `select public.create_club('CLB Mới') as c`)
    expect(Number(r.rows[0].c.treasury_balance)).toBe(0)
    expect(r.rows[0].c.member_count).toBe(1)
  })

  it('giới thiệu bạn: người mới nhận ngay, người mời nhận khi bạn chạy đủ km', async () => {
    const id = '00000000-0000-0000-0000-0000000000d4'
    await db.query(`insert into auth.users (id, email) values ($1, 'newbie@x.vn')`, [id])   // trigger tạo hồ sơ
    await asUser(db, ADMIN, '/rpc/admin_publish_config',
      `select public.admin_publish_config('economy_global_config', '{"refBonusReferee": 10, "refBonusInviter": 20, "refMinKmRequired": 3}')`)
    const inviterBefore = await xu(db, RICH)
    await asUser(db, id, '/rpc/apply_referral', `select public.apply_referral($1)`, [RICH])
    expect(await xu(db, id)).toBe(10)
    expect(await xu(db, RICH)).toBe(inviterBefore)
    await expect(asUser(db, id, '/rpc/apply_referral', `select public.apply_referral($1)`, [RUNNER])).rejects.toThrow(/ALREADY_REFERRED/)
    await submit(db, id, 3.2, 360, 60)
    expect(await xu(db, RICH)).toBe(inviterBefore + 20)
    await submit(db, id, 3.2, 360, 200)
    expect(await xu(db, RICH)).toBe(inviterBefore + 20)          // chỉ thưởng một lần
  })

  it('bất biến sổ cái: tổng mọi bút toán = 0; profiles.xu = số dư sổ cái của từng user', async () => {
    expect(await num(db, `select coalesce(sum(amount), 0) from public.ledger_entries`)).toBe(0)
    const mismatch = await db.query(`
      select p.id from public.profiles p
       where round(coalesce(p.xu, 0), 2) <> (select coalesce(sum(amount), 0) from public.ledger_entries e where e.account_id = p.id)`)
    expect(mismatch.rows).toEqual([])
  })

  it('cấu hình: user thường không sửa được; mỗi lần lưu tạo phiên bản mới', async () => {
    await expect(asUser(db, RUNNER, '/rpc/admin_publish_config',
      `select public.admin_publish_config('economy_global_config', '{"kmRate": 100}')`)).rejects.toThrow(/FORBIDDEN/)
    const r = await db.query<{ status: string }>(
      `select status from public.system_config_versions where config_key = 'economy_global_config' order by version`)
    expect(r.rows.map((x) => x.status)).toEqual(['ARCHIVED', 'PUBLISHED'])
  })

  it('kết nối Strava: chỉ service_role; một tài khoản Strava không gắn được cho 2 người', async () => {
    await db.exec('set role service_role')
    try {
      await db.query(`select public.link_provider_connection($1, 'STRAVA', '555', 't', 'r', now())`, [RUNNER])
      await expect(db.query(`select public.link_provider_connection($1, 'STRAVA', '555', 't', 'r', now())`, [FRIEND]))
        .rejects.toThrow(/PROVIDER_ACCOUNT_CONFLICT/)
      const tok = await db.query<{ t: string }>(`select public.unlink_provider_connection($1, 'STRAVA') as t`, [RUNNER])
      expect(tok.rows[0].t).toBe('t')
    } finally {
      await db.exec('reset role')
    }
    await expect(asUser(db, RUNNER, '/rpc/link_provider_connection',
      `select public.link_provider_connection($1, 'STRAVA', '9', 't', 'r', now())`, [RUNNER])).rejects.toThrow(/permission denied/)
  })
})
