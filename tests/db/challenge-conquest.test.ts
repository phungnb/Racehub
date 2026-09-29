import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createDb, asUser } from './load-schema'

// Migration 010700: chinh phục thời gian / pace nhiều hạng mục, hạn đăng ký, BXH theo ngày, ngày vàng riêng
const U = Array.from({ length: 4 }, (_, i) => `00000000-0000-0000-0000-0000001070${String(i + 1).padStart(2, '0')}`)
const [A, B, C, OUT] = U
type Row = Record<string, any>

async function seed(db: PGlite) {
  await db.exec(`
    insert into auth.users (id, email) values ${U.map((u, i) => `('${u}', 'c107${i}@x.vn')`).join(', ')};
    insert into public.profiles (id, display_name, xu, xp, level, created_at) values
      ${U.map((u, i) => `('${u}', 'Runner ${i}', 0, 0, 1, now())`).join(', ')} on conflict do nothing;
  `)
}
const rpc = async <T = Row,>(db: PGlite, uid: string, sql: string, params: unknown[] = []) => (await asUser<{ r: T }>(db, uid, '/rpc', sql, params)).rows[0]?.r
const fails = async (p: Promise<unknown>) => { try { await p } catch (e) { return (e as Error).message } return 'OK' }
const iso = (h: number) => new Date(Date.now() + h * 3600_000).toISOString()
let seq = 0
const create = async (db: PGlite, p: Row) =>
  (await rpc<{ challenge_id: string }>(db, A, `select public.create_challenge_v2($1::jsonb, $2) as r`, [JSON.stringify(p), `conq-key-${++seq}`]))!.challenge_id
// Mỗi bài một khung giờ riêng (tránh luật trùng giờ 009900)
let slot = 0
const run = (db: PGlite, uid: string, km: number, paceS: number) => {
  const startH = -(2 + slot++ * 3)
  return db.query(`
    insert into public.activities (user_id, title, source, started_at, ended_at, distance_m, moving_distance_m, moving_time_s, avg_pace_s, validation_status, status)
    values ($1, 'Chạy', 'DIRECT_GPS', now() + make_interval(hours => $4), now() + make_interval(hours => $4) + make_interval(secs => $3::int), $2::numeric, $2::numeric, $3::int, $5, 'APPROVED', 'READY')`,
    [uid, km * 1000, Math.round(km * paceS), startH, paceS])
}

describe('chinh phục thời gian / pace (010700)', () => {
  let db: PGlite
  beforeAll(async () => {
    db = await createDb({ withMigrations: true, runMigrationsTwice: true, seed })
    await db.query(`select private.ledger_post('TEST_SEED', 'seed-107', 'seed', null,
      jsonb_build_array(jsonb_build_object('account_id', $1::uuid, 'coin_kind', 'BONUS', 'amount', 100000),
                        jsonb_build_object('account_id', private.system_account(), 'coin_kind', 'BONUS', 'amount', -100000)))`, [A])
  }, 300_000)

  it('FIXED: người tạo đặt mục tiêu từng hạng mục; kết quả = bài tốt nhất ≥ cự ly; hoàn thành khi đạt mọi hạng mục đã đăng ký', async () => {
    const cid = await create(db, { title: 'Chinh phục sub', format: 'SOLO_GOAL', objective: 'DISTANCE', target_value: 1,
      audience: 'PUBLIC', start_date: iso(-48), end_date: iso(24 * 6), max_slots: 20 })
    expect(await fails(rpc(db, B, `select public.set_challenge_conquest($1, $2::jsonb) as r`, [cid, '{"objective":"BEST_TIME","mode":"FIXED","categories":[{"label":"5K","distance_km":5,"target_s":1800}]}']))).toContain('FORBIDDEN')
    expect(await fails(rpc(db, A, `select public.set_challenge_conquest($1, $2::jsonb) as r`, [cid, '{"objective":"BEST_TIME","mode":"FIXED","categories":[{"label":"5K","distance_km":5}]}']))).toContain('INVALID_CONQUEST')
    const board0 = await rpc(db, A, `select public.set_challenge_conquest($1, $2::jsonb) as r`, [cid, JSON.stringify({
      objective: 'BEST_TIME', mode: 'FIXED', categories: [{ label: '5K', distance_km: 5, target_s: 1800 }, { label: '10K', distance_km: 10, target_s: 3300 }] })])
    const [k5, k10] = board0.categories
    expect(board0).toMatchObject({ objective: 'BEST_TIME', mode: 'FIXED' })

    // B chạy trước khi tham gia: tham gia trễ vẫn được tính từ ngày bắt đầu
    await run(db, B, 10.2, 320)     // 10,2 km pace 5:20 → 10K quy đổi 3200 s (đạt), 5K 1600 s (đạt)
    await run(db, B, 5, 400)        // chậm hơn, không thay kết quả tốt nhất
    await rpc(db, B, `select public.join_challenge($1) as r`, [cid])
    expect(await fails(rpc(db, OUT, `select public.set_my_conquest($1, $2::jsonb) as r`, [cid, JSON.stringify([{ category_id: k5.id }])]))).toContain('NOT_JOINED')
    await rpc(db, B, `select public.set_my_conquest($1, $2::jsonb) as r`, [cid, JSON.stringify([{ category_id: k5.id }, { category_id: k10.id }])])
    const p = (await db.query<Row>(`select status, current_progress from public.challenge_participants where challenge_id = $1 and profile_id = $2`, [cid, B])).rows[0]
    expect(p.status).toBe('COMPLETED')
    expect(Number(p.current_progress)).toBe(2)

    // C: chỉ 5K, chạy 6 km pace 6:30 → 5K 1950 s > 1800: chưa đạt
    await rpc(db, C, `select public.join_challenge($1) as r`, [cid])
    await rpc(db, C, `select public.set_my_conquest($1, $2::jsonb) as r`, [cid, JSON.stringify([{ category_id: k5.id }])])
    await run(db, C, 6, 390)
    const board = await rpc(db, A, `select public.challenge_conquest_board($1) as r`, [cid])
    const rows5 = board.rows.filter((r: Row) => r.category_id === k5.id)
    expect(rows5.map((r: Row) => [r.display_name, r.best_time_s, r.achieved, r.rank])).toEqual([['Runner 1', 1600, true, 1], ['Runner 2', 1950, false, 2]])
    expect(board.categories.find((x: Row) => x.id === k5.id)).toMatchObject({ entrants: 2, achieved: 1 })
    // Đổi luật khi đã có người đăng ký: khóa
    expect(await fails(rpc(db, A, `select public.set_challenge_conquest($1, $2::jsonb) as r`, [cid, JSON.stringify({
      objective: 'BEST_TIME', mode: 'FIXED', categories: [{ label: '5K', distance_km: 5, target_s: 1500 }] })]))).toContain('CONQUEST_LOCKED')
  })

  it('SELF + pace: người chơi tự đặt pace mục tiêu; sau xuất phát không đổi được mục tiêu đã đăng ký', async () => {
    const cid = await create(db, { title: 'Pace của tôi', format: 'SOLO_GOAL', objective: 'DISTANCE', target_value: 1,
      audience: 'PUBLIC', start_date: iso(-48), end_date: iso(24 * 6), max_slots: 20 })
    const b = await rpc(db, A, `select public.set_challenge_conquest($1, $2::jsonb) as r`, [cid, JSON.stringify({
      objective: 'BEST_PACE', mode: 'SELF', categories: [{ label: '10K', distance_km: 10 }] })])
    const k10 = b.categories[0].id
    await rpc(db, C, `select public.join_challenge($1) as r`, [cid])
    expect(await fails(rpc(db, C, `select public.set_my_conquest($1, $2::jsonb) as r`, [cid, JSON.stringify([{ category_id: k10 }])]))).toContain('INVALID_CONQUEST')
    await rpc(db, C, `select public.set_my_conquest($1, $2::jsonb) as r`, [cid, JSON.stringify([{ category_id: k10, target_s: 420 }])])
    const mine = (await rpc(db, C, `select public.challenge_conquest_board($1) as r`, [cid])).mine[0]
    expect(mine).toMatchObject({ target_s: 420 })
    expect(await fails(rpc(db, C, `select public.set_my_conquest($1, $2::jsonb) as r`, [cid, JSON.stringify([{ category_id: k10, target_s: 600 }])]))).toContain('CONQUEST_TARGET_LOCKED')
  })

  it('hạn đăng ký: người tạo sửa được; sau hạn không ai vào được (trừ người tạo)', async () => {
    const cid = await create(db, { title: 'Chạy tháng', format: 'RANKED', objective: 'DISTANCE', target_value: 0,
      audience: 'PUBLIC', start_date: iso(-24), end_date: iso(24 * 6), max_slots: 20 })
    expect(await fails(rpc(db, B, `select public.set_challenge_reg_deadline($1, $2) as r`, [cid, iso(1)]))).toContain('FORBIDDEN')
    expect(await fails(rpc(db, A, `select public.set_challenge_reg_deadline($1, $2) as r`, [cid, iso(24 * 30)]))).toContain('INVALID_DEADLINE')
    await rpc(db, A, `select public.set_challenge_reg_deadline($1, $2) as r`, [cid, iso(1)])
    await db.query(`update public.challenges set reg_deadline = now() - interval '1 minute' where id = $1`, [cid])
    expect(await fails(rpc(db, B, `select public.join_challenge($1) as r`, [cid]))).toContain('REGISTRATION_CLOSED')
  })

  it('BXH chi tiết theo ngày; ngày vàng riêng thử thách nhân km', async () => {
    const cid = await create(db, { title: 'Cùng nhau chinh phục', format: 'COLLECTIVE', objective: 'DISTANCE', target_value: 500,
      audience: 'PUBLIC', start_date: iso(-72), end_date: iso(24 * 6), max_slots: 50 })
    await rpc(db, B, `select public.join_challenge($1) as r`, [cid])
    const d = await rpc(db, C, `select public.challenge_member_days($1, $2) as r`, [cid, B])
    expect(d.days.length).toBeGreaterThan(0)
    expect(d.summary.runs).toBeGreaterThan(0)
    expect(d.days[0]).toHaveProperty('km')

    const tomorrow = new Date(Date.now() + 86_400_000 + 7 * 3600_000).toISOString().slice(0, 10)
    expect(await fails(rpc(db, B, `select public.set_challenge_boost_day($1, $2::date, 2, 'Ngày hội') as r`, [cid, tomorrow]))).toContain('FORBIDDEN')
    const days = await rpc(db, A, `select public.set_challenge_boost_day($1, $2::date, 2, 'Ngày hội') as r`, [cid, tomorrow])
    expect(days).toEqual([{ day: tomorrow, multiplier: 2, title: 'Ngày hội' }])
    const boost = (await db.query<{ b: string }>(`select private.challenge_boost($1, $2::date) b`, [cid, tomorrow])).rows[0].b
    expect(Number(boost)).toBe(2)
    expect(Number((await db.query<{ n: string }>(`select count(*) n from public.notifications where user_id = $1 and kind = 'CHALLENGE_BOOST'`, [B])).rows[0].n)).toBe(1)
  })
})
