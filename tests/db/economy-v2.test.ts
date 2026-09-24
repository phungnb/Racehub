import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createDb, asUser } from './load-schema'

// Migration 003700: kinh tế v2 — 1 Xu = 100đ (đổi ×10), Xu chạy theo bậc km/ngày, điểm danh gắn bài chạy,
// chuỗi tuần có mốc Xu, XP chỉ từ km, 8 cấp độ + Xu lên cấp, giới thiệu bạn có điều kiện, phí theo quy mô.
const id = (n: number) => `00000000-0000-0000-0000-0000000037${String(n).padStart(2, '0')}`
const [OLD, R1, R2, R3, INV, NEW1, NEW2, NEW3, ADMIN, OWNER] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(id)
const CLUB = '00000000-0000-0000-0000-0000000037c1'

async function seed(db: PGlite) {
  const all = [OLD, R1, R2, R3, INV, NEW1, NEW2, NEW3, ADMIN, OWNER]
  await db.exec(`
    insert into auth.users (id, email) values ${all.map((u, i) => `('${u}', 'e2_${i}@x.vn')`).join(', ')};
    insert into public.profiles (id, display_name, xu, xp, level, created_at) values
      ${all.map((u, i) => `('${u}', 'Runner ${i}', ${u === OLD ? 50 : 0}, 0, 1, now())`).join(', ')};
    insert into public.clubs (id, name, owner_id, invite_code) values ('${CLUB}', 'Hồ Tây', '${OWNER}', 'e2club01');
    insert into public.club_members (club_id, user_id, role, status) values ('${CLUB}', '${OWNER}', 'OWNER', 'APPROVED');
  `)
}

type Row = Record<string, unknown>
const rpc = async <T = Row>(db: PGlite, uid: string, sql: string, params: unknown[] = []) => (await asUser<T>(db, uid, '/rpc', sql, params)).rows
const fails = async (p: Promise<unknown>) => { try { await p } catch (e) { return (e as Error).message } return 'OK' }
const xu = async (db: PGlite, acc: string) => Number((await db.query<{ b: string }>(`select private.balance($1) as b`, [acc])).rows[0].b)
const xp = async (db: PGlite, uid: string) => (await db.query<{ xp: number; level: number }>(`select xp, level from public.profiles where id = $1`, [uid])).rows[0]
let sec = 0
/** Mốc giờ trong NGÀY HÔM NAY (giờ VN), tăng dần — tránh bài chạy rơi sang hôm qua khi test chạy sau nửa đêm */
const today = () => `least(now(), private.vn_start(private.vn_day(now())) + interval '${++sec} seconds')`
const run = async (db: PGlite, uid: string, km: number, at = today()) =>
  (await db.query<{ id: string }>(`
    insert into public.activities (user_id, title, source, started_at, ended_at, distance_m, moving_distance_m, moving_time_s, avg_pace_s, validation_status, status)
    values ($1, 'Chạy', 'DIRECT_GPS', ${at}, ${at} + interval '30 minutes', $2::numeric, $2::numeric, $3::int, 360, 'APPROVED', 'READY') returning id`,
    [uid, km * 1000, Math.round(km * 360)])).rows[0].id
const earned = async (db: PGlite, actId: string) => Number((await db.query<{ e: string }>(`select earned_xu as e from public.activities where id = $1`, [actId])).rows[0].e)
const give = (db: PGlite, acc: string, amount: number, key: string) =>
  db.query(`select private.ledger_post('TEST_SEED', $3, 'seed', null,
    jsonb_build_array(jsonb_build_object('account_id', $1::uuid, 'coin_kind', 'BONUS', 'amount', $2::numeric),
                      jsonb_build_object('account_id', private.system_account(), 'coin_kind', 'BONUS', 'amount', -$2::numeric)))`, [acc, amount, key])
const iso = (h: number) => new Date(Date.now() + h * 3600_000).toISOString()

describe('Kinh tế v2 (003700)', () => {
  let db: PGlite
  beforeAll(async () => {
    db = await createDb({ withMigrations: true, runMigrationsTwice: true, seed })
    await db.query(`update public.profiles set role = 'SYSTEM_ADMIN' where id = $1`, [ADMIN])
  }, 300_000)

  it('đổi quy ước 1 Xu = 100đ: số dư ×10 đúng một lần (chạy migration 2 lần), giá đồ ×10, cấu hình v2', async () => {
    expect(await xu(db, OLD)).toBe(500)
    expect((await db.query(`select 1 from public.ledger_transactions where type = 'RATE_CONVERSION'`)).rows.length).toBeGreaterThan(0)
    const hat = await db.query<{ p: string }>(`select price_xu as p from public.avatar_items where code = 'hat_cap_tempo_black'`)
    expect(Number(hat.rows[0].p)).toBe(600)
    const pol = (await rpc<{ p: Row }>(db, R1, `select public.economy_policy() as p`))[0].p
    expect(pol).toMatchObject({ econVersion: 2, xuVnd: 100, xpPerKm: 10, checkinXu: 1 })
  })

  it('Xu chạy theo bậc km trong ngày: km 1–2 = 0, km 3–10 = 2 Xu, km 11–20 = 1 Xu, trần 20; điểm danh +1 một lần', async () => {
    const a = await run(db, R1, 5, today())
    expect(await earned(db, a)).toBe(6)
    const b = await run(db, R1, 7, today())     // tổng 12 km: km 6–10 = 10, km 11–12 = 2
    expect(await earned(db, b)).toBe(12)
    const c = await run(db, R1, 10, today())     // tổng 22 km: còn 2 Xu tới trần 20
    expect(await earned(db, c)).toBe(2)
    expect(await xu(db, R1)).toBe(20 + 1)                              // + điểm danh
    expect((await xp(db, R1)).xp).toBe(220)                            // 10 XP / km, không thêm từ nhiệm vụ / huy hiệu
    const ev = await db.query<{ kind: string; xu: string; xp: number }>(`select kind, xu, xp from public.game_events where user_id = $1 and kind in ('BADGE', 'QUEST')`, [R1])
    expect(ev.rows.length).toBeGreaterThan(0)
    expect(ev.rows.every((e) => Number(e.xu) === 0 && e.xp === 0)).toBe(true)
    const st = (await rpc<{ s: { checked_in: boolean } }>(db, R1, `select public.my_game_state() as s`))[0].s
    expect(st.checked_in).toBe(true)
  })

  it('km lẻ tính theo tỷ lệ; bài dưới 1 km không điểm danh; mở app không được Xu', async () => {
    expect(await earned(db, await run(db, R2, 3.5))).toBe(3)
    const before = await xu(db, R3)
    await run(db, R3, 0.8)
    await rpc(db, R3, `select public.daily_checkin()`)
    expect(await xu(db, R3)).toBe(before)
    expect((await rpc<{ r: { checked: boolean } }>(db, R3, `select public.daily_checkin() as r`))[0].r.checked).toBe(false)
  })

  it('8 cấp độ; lên cấp được Xu một lần', async () => {
    await db.query(`update public.profiles set xp = 990, level = 1 where id = $1`, [R3])
    const before = await xu(db, R3)
    await run(db, R3, 2, today())            // +20 XP → 1.010 → cấp 2
    expect(await xp(db, R3)).toMatchObject({ xp: 1010, level: 2 })
    expect(await xu(db, R3)).toBeCloseTo(before + 20 + 1 + 1.6, 5)   // thưởng cấp 2 + điểm danh + km 2,0–2,8 của ngày (0,8 km × 2)
    const lv = await db.query<{ n: string }>(`select private.level_name(8) as n`)
    expect(lv.rows[0].n).toBe('Đỉnh Cao RaceHub')
    expect((await db.query<{ l: number }>(`select private.level_for_xp(35000) as l`)).rows[0].l).toBe(5)
  })

  it('chuỗi tuần: đạt 2 tuần liên tiếp → +10 Xu, không XP', async () => {
    await rpc(db, R2, `select public.set_weekly_goal(1)`)
    await run(db, R2, 3, `private.vn_start(private.vn_week(now()) - 7) + interval '1 day 7 hours'`)
    const before = await xu(db, R2)
    const beforeXp = (await xp(db, R2)).xp
    await run(db, R2, 3, today())
    const streak = await db.query<{ xu: string; xp: number }>(`select xu, xp from public.game_events where user_id = $1 and kind = 'STREAK' order by created_at desc`, [R2])
    expect(Number(streak.rows[0].xu)).toBe(10)
    expect(streak.rows[0].xp).toBe(0)
    expect((await xp(db, R2)).xp - beforeXp).toBe(30)
    expect(await xu(db, R2)).toBeGreaterThanOrEqual(before + 10)
  })

  it('giới thiệu bạn: chưa thưởng khi nhập mã; thưởng khi bạn mới xác thực + chạy đủ 3 km; trần mỗi tháng; chưa xác thực thì không', async () => {
    const r = (await rpc<{ r: Row }>(db, NEW1, `select public.apply_referral($1) as r`, [INV]))[0].r
    expect(r).toMatchObject({ referee_reward: 10, referrer_reward: 20 })
    expect(await xu(db, NEW1)).toBe(0)
    await run(db, NEW1, 2, today())
    expect(await xu(db, INV)).toBe(0)
    await run(db, NEW1, 2, today())               // tổng 4 km ≥ 3
    expect(await xu(db, INV)).toBe(20)
    expect(await xu(db, NEW1)).toBeGreaterThanOrEqual(10)

    await rpc(db, ADMIN, `select public.admin_publish_config('economy_global_config', $1::jsonb)`,
      [JSON.stringify({ referral: { inviterXu: 20, refereeXu: 10, monthlyCap: 1, minKm: 3 } })])
    await rpc(db, NEW2, `select public.apply_referral($1)`, [INV])
    await run(db, NEW2, 5)
    expect(await xu(db, INV)).toBe(20)                                // đã đủ 1 người trong tháng

    await db.query(`update auth.users set email_confirmed_at = null where id = $1`, [NEW3])
    await rpc(db, NEW3, `select public.apply_referral($1)`, [R1])
    const before = await xu(db, R1)
    await run(db, NEW3, 5)
    expect(await xu(db, R1)).toBe(before)
  })

  it('phí theo quy mô: ≤5 miễn phí … ≤1.000 = 7.000; > 1.000 chỉ bằng vé admin', async () => {
    const fee = async (n: number) => Number((await rpc<{ f: number }>(db, R1, `select public.preview_challenge_fee('RANKED', $1, now(), now() + interval '30 days', false) as f`, [n]))[0].f)
    expect([await fee(5), await fee(6), await fee(20), await fee(21), await fee(100), await fee(1000)]).toEqual([0, 150, 150, 400, 800, 7000])
    expect(await fee(1001)).toBeGreaterThan(1_000_000)
    // thời gian không ảnh hưởng giá
    expect(Number((await rpc<{ f: number }>(db, R1, `select public.preview_challenge_fee('RANKED', 50, now(), now() + interval '90 days', false) as f`))[0].f)).toBe(400)
  })

  it('tạo thử thách: cá nhân trả ví cá nhân; CLB (ban quản trị) trả ví CLB; không cho người dùng treo thưởng Xu', async () => {
    const create = (uid: string, p: Row, key: string) => rpc<{ r: { fee: number } }>(db, uid, `select public.create_challenge_v2($1::jsonb, $2) as r`, [JSON.stringify(p), key])
    await give(db, R2, 1000, 'e2-give-r2')
    const before = await xu(db, R2)
    const r = (await create(R2, { title: 'Nhóm 20', format: 'RANKED', max_slots: 20, start_date: iso(1), end_date: iso(72) }, 'e2-ch-0001'))[0].r
    expect(r.fee).toBe(150)
    expect(await xu(db, R2)).toBe(before - 150)
    expect(await fails(create(R2, { title: 'Có thưởng', format: 'RANKED', max_slots: 5, reward_xu: 50, reward_source: 'CREATOR',
      start_date: iso(1), end_date: iso(72) }, 'e2-ch-0002'))).toContain('REWARD_NOT_ALLOWED')

    await give(db, CLUB, 1000, 'e2-give-club')
    const ownerBefore = await xu(db, OWNER)
    const c = (await create(OWNER, { title: 'CLB 50', format: 'RANKED', audience: 'CLUB_ONLY', club_id: CLUB, max_slots: 50,
      start_date: iso(1), end_date: iso(72) }, 'e2-ch-0003'))[0].r
    expect(c.fee).toBe(400)
    expect(await xu(db, CLUB)).toBe(600)
    expect(await xu(db, OWNER)).toBe(ownerBefore)
  })

  it('admin chỉnh cấu hình: giá trị sai bị từ chối; người thường không sửa được', async () => {
    const pub = (uid: string, c: Row) => rpc(db, uid, `select public.admin_publish_config('economy_global_config', $1::jsonb)`, [JSON.stringify(c)])
    expect(await fails(pub(R1, { checkinXu: 2 }))).toMatch(/FORBIDDEN|permission/)
    expect(await fails(pub(ADMIN, { run: { freeKm: 2, dailyCap: -1, tiers: [] } }))).toContain('INVALID_CONFIG')
    await pub(ADMIN, { capacityTiers: [{ max: 5, xu: 0 }, { max: 20, xu: 100 }, { max: 1000, xu: 5000 }] })
    expect(Number((await rpc<{ f: number }>(db, R1, `select public.preview_challenge_fee('RANKED', 20, now(), now() + interval '1 day', false) as f`))[0].f)).toBe(100)
  })
})
