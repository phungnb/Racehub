import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createDb, asUser, ECON_V1 } from './load-schema'

// Migration 000800: nhiệm vụ, streak tuần + khiên, huy hiệu, league tuần, cổ vũ bằng Xu, ví, chuỗi phần thưởng
const A = '00000000-0000-0000-0000-0000000000a1'
const B = '00000000-0000-0000-0000-0000000000a2'
const C = '00000000-0000-0000-0000-0000000000a3'
const L = Array.from({ length: 6 }, (_, i) => `00000000-0000-0000-0000-0000000001b${i}`)   // người chơi league

async function seed(db: PGlite) {
  const all = [A, B, C, ...L]
  await db.exec(`
    insert into auth.users (id, email) values ${all.map((u, i) => `('${u}', 'g${i}@x.vn')`).join(', ')};
    insert into public.profiles (id, display_name, xu, xp, level, created_at) values
      ${all.map((u, i) => `('${u}', 'Runner ${i}', 0, 0, 1, now())`).join(', ')};
  `)
}

type Row = Record<string, unknown>
const rpc = async <T = Row>(db: PGlite, uid: string, sql: string, params: unknown[] = []) =>
  (await asUser<T>(db, uid, '/rpc', sql, params)).rows
const fails = async (db: PGlite, uid: string, sql: string, params: unknown[] = []) => {
  try { await asUser(db, uid, '/rpc', sql, params) } catch (e) { return (e as Error).message }
  return 'OK'
}
const xu = async (db: PGlite, id: string, kind: string | null = null) =>
  Number((await db.query<{ b: string }>(`select private.balance($1, $2) as b`, [id, kind])).rows[0].b)
/** Chèn một bài chạy đã duyệt; `at` là biểu thức SQL cho started_at */
const run = async (db: PGlite, uid: string, km: number, at = `now() - interval '2 hours'`, paceS = 360) =>
  (await db.query<{ id: string }>(`
    insert into public.activities (user_id, title, source, started_at, ended_at, distance_m, moving_distance_m, moving_time_s, avg_pace_s, validation_status, status)
    values ($1, 'Chạy', 'DIRECT_GPS', ${at}, ${at} + interval '30 minutes', $2::numeric, $2::numeric, $3::int, $4::int, 'APPROVED', 'READY')
    returning id`, [uid, km * 1000, Math.round(km * paceS), paceS])).rows[0].id
const weekAt = (weeksAgo: number, day = 2) => `private.vn_start(private.vn_week(now()) - ${weeksAgo * 7} + ${day}) + interval '7 hours'`
const give = (db: PGlite, uid: string, amount: number, key: string) =>
  db.query(`select private.ledger_post('TEST_SEED', $3, 'seed', null,
    jsonb_build_array(jsonb_build_object('account_id', $1::uuid, 'coin_kind', 'BONUS', 'amount', $2::numeric),
                      jsonb_build_object('account_id', private.system_account(), 'coin_kind', 'BONUS', 'amount', -$2::numeric)))`, [uid, amount, key])
const state = async (db: PGlite, uid: string) =>
  (await rpc<{ s: Record<string, any> }>(db, uid, `select public.my_game_state() as s`))[0].s

describe('Lớp game (000800)', () => {
  let db: PGlite
  beforeAll(async () => {
    db = await createDb({ withMigrations: true, runMigrationsTwice: true, seed, until: ECON_V1 })
  }, 240_000)

  it('một bài chạy 5 km trả về chuỗi phần thưởng: thẻ bài chạy, nhiệm vụ, huy hiệu — Xu qua sổ cái', async () => {
    const id = await run(db, A, 5)
    const rewards = await rpc<{ kind: string; title: string; xu: string; xp: number }>(db, A, `select * from public.activity_rewards($1)`, [id])
    const kinds = rewards.map((r) => r.kind)
    expect(kinds[0]).toBe('RUN')
    expect(rewards.filter((r) => r.kind === 'QUEST').map((r) => r.title)).toContain('Nhiệm vụ: Chạy một bài từ 3 km')
    expect(rewards.filter((r) => r.kind === 'BADGE').map((r) => r.title)).toEqual(expect.arrayContaining(['Huy hiệu: Bước chân đầu tiên', 'Huy hiệu: Hoàn thành 5K']))
    expect(await xu(db, A)).toBeCloseTo(1.8 + 1, 5)              // thưởng chạy + nhiệm vụ 3 km (huy hiệu đầu không có Xu)
    const xp = Number((await db.query<{ xp: number }>(`select xp from public.profiles where id = $1`, [A])).rows[0].xp)
    expect(xp).toBe(50 + 30 + 100 + 100)                        // 10 XP/km + nhiệm vụ + 2 huy hiệu
    // Người khác không đọc được phần thưởng của A
    expect(await rpc(db, B, `select * from public.activity_rewards($1)`, [id])).toHaveLength(0)
    expect((await asUser(db, B, '/game_events', `select 1 from public.game_events`)).rows).toHaveLength(0)
  })

  it('điểm danh: chỉ tính một lần mỗi ngày', async () => {
    const before = await xu(db, A)
    await rpc(db, A, `select public.daily_checkin()`)
    await rpc(db, A, `select public.daily_checkin()`)
    expect(await xu(db, A)).toBeCloseTo(before + 0.5, 5)
    const s = await state(db, A)
    expect(s.checked_in).toBe(true)
    expect(s.quests.find((q: Row) => q.code === 'DAILY_CHECKIN')).toMatchObject({ completed: true })
    expect(s.league).toMatchObject({ tier: 1, tier_name: 'Đồng' })
    expect(s.league.group_id).toBeTruthy()                       // có bài chạy tuần này → đã vào nhóm
  })

  it('streak tuần: đủ buổi thì +1; tuần hụt có khiên bù, không có khiên thì về 1; khiên mua bằng Xu, tối đa 2', async () => {
    await rpc(db, B, `select public.set_weekly_goal(1)`)
    await run(db, B, 3, weekAt(4)); await run(db, B, 3, weekAt(3))
    expect((await db.query(`select current_weeks from public.user_streaks where user_id = $1`, [B])).rows[0]).toMatchObject({ current_weeks: 2 })
    // Hụt tuần -2 → không có khiên → chạy tuần -1 bắt đầu lại từ 1
    await run(db, B, 3, weekAt(1))
    expect((await db.query(`select current_weeks, best_weeks from public.user_streaks where user_id = $1`, [B])).rows[0])
      .toMatchObject({ current_weeks: 1, best_weeks: 2 })

    expect(await fails(db, B, `select public.buy_streak_shield('shield-key-0')`)).toContain('INSUFFICIENT_BALANCE')
    await give(db, B, 100, 'seed-b-100')
    await rpc(db, B, `select public.buy_streak_shield('shield-key-1')`)
    await rpc(db, B, `select public.buy_streak_shield('shield-key-1')`)      // gửi lại: không trừ 2 lần
    await rpc(db, B, `select public.buy_streak_shield('shield-key-2')`)
    expect(await fails(db, B, `select public.buy_streak_shield('shield-key-3')`)).toContain('SHIELD_LIMIT')
    expect(await xu(db, B)).toBeCloseTo(100 + 3 * 1.4 - 40 + 1 * 3, 0)      // 2 khiên × 20 Xu (±thưởng chạy/nhiệm vụ)
    const s = await state(db, B)
    expect(s.streak).toMatchObject({ goal: 1, current: 1, alive: true, shields: 2 })
  })

  it('khiên tự dùng khi hụt tuần', async () => {
    await rpc(db, C, `select public.set_weekly_goal(1)`)
    await give(db, C, 50, 'seed-c-50')
    await rpc(db, C, `select public.buy_streak_shield('shield-c-1')`)
    await run(db, C, 2, weekAt(3)); await run(db, C, 2, weekAt(2))
    await run(db, C, 2, `now() - interval '1 minute'`)          // hụt tuần -1, khiên bù
    expect((await db.query(`select current_weeks, shields, shields_used from public.user_streaks where user_id = $1`, [C])).rows[0])
      .toMatchObject({ current_weeks: 3, shields: 0, shields_used: 1 })
  })

  it('cổ vũ: chuyển Xu người gửi → người nhận (Xu thưởng), có trần ngày, không tự cổ vũ; nhiệm vụ + thông báo', async () => {
    await give(db, A, 200, 'seed-a-200')
    const [a0, b0] = [await xu(db, A), await xu(db, B, 'BONUS')]
    const r = (await rpc<{ r: Row }>(db, A, `select public.send_cheer($1, 5, 'Cố lên!', null, null, 'cheer-key-001') as r`, [B]))[0].r
    expect(r.cheer_id).toBeTruthy()
    await rpc(db, A, `select public.send_cheer($1, 5, 'Cố lên!', null, null, 'cheer-key-001')`, [B])   // gửi lại
    expect(await xu(db, A)).toBeCloseTo(a0 - 5 + 0.5, 5)               // + nhiệm vụ "cổ vũ một người bạn"
    expect(await xu(db, B, 'BONUS')).toBeCloseTo(b0 + 5, 5)
    expect(await fails(db, A, `select public.send_cheer($1, 5, null, null, null, 'cheer-self-01')`, [A])).toContain('CANNOT_CHEER_SELF')
    expect(await fails(db, A, `select public.send_cheer($1, 11, null, null, null, 'cheer-big-001')`, [B])).toContain('INVALID_AMOUNT')
    for (let i = 0; i < 9; i++) await rpc(db, A, `select public.send_cheer($1, 5, null, null, null, $2)`, [C, `cheer-many-${i}0`])
    expect(await fails(db, A, `select public.send_cheer($1, 1, null, null, null, 'cheer-over-01')`, [C])).toContain('CHEER_DAILY_LIMIT')
    expect((await asUser(db, B, '/notifications', `select title from public.notifications where kind = 'CHEER'`)).rows)
      .toEqual([{ title: 'Runner 0 cổ vũ bạn 5 Xu' }])
    expect(await fails(db, A, `insert into public.cheers (from_user, to_user, amount, idempotency_key) values ($1, $2, 1, 'direct-insert')`, [A, B]))
      .toMatch(/permission denied/)
    // Huy hiệu "Người cổ vũ" sau 10 lần tặng
    expect((await rpc<{ code: string; unlocked_at: string | null }>(db, A, `select code, unlocked_at from public.my_achievements()`))
      .find((x) => x.code === 'CHEER_GIVER')?.unlocked_at).toBeTruthy()
  })

  it('ví: số dư theo loại và lịch sử khớp sổ cái', async () => {
    const w = (await rpc<{ w: { bonus: string; paid: string; total: string; items: { type: string; amount: string }[] } }>(db, A,
      `select public.my_wallet(null, 100) as w`))[0].w
    expect(Number(w.total)).toBeCloseTo(await xu(db, A), 5)
    expect(w.items.reduce((s, x) => s + Number(x.amount), 0)).toBeCloseTo(Number(w.total), 5)
    expect(new Set(w.items.map((x) => x.type))).toEqual(new Set(['RUN_REWARD', 'GAME_QUEST', 'TEST_SEED', 'CHEER']))
  })

  it('huy hiệu: danh sách đủ, có tiến độ cho huy hiệu chưa mở', async () => {
    const list = await rpc<{ code: string; target: string; progress: string; unlocked_at: string | null }>(db, A, `select * from public.my_achievements()`)
    expect(list.length).toBeGreaterThanOrEqual(20)
    expect(list.find((x) => x.code === 'KM_10')).toMatchObject({ unlocked_at: null })
    expect(Number(list.find((x) => x.code === 'KM_10')!.progress)).toBeCloseTo(5, 5)
  })

  it('league: tất toán tuần trước — top lên hạng, top 3 nhận thưởng, không ai 2 nhóm', async () => {
    for (let i = 0; i < L.length; i++) {
      await run(db, L[i], 2 + i, weekAt(1))
      await db.query(`select private.league_join($1, private.vn_week(now()) - 7)`, [L[i]])
    }
    await db.query(`select private.league_join($1, private.vn_week(now()) - 7)`, [L[0]])   // gọi lại: không thêm
    expect((await db.query(`select count(*)::int as n from public.league_members where week_start = private.vn_week(now()) - 7`)).rows[0]).toMatchObject({ n: 6 })
    const before = await xu(db, L[5])
    await state(db, L[0])                                           // mở trang chủ → tất toán tuần cũ
    const tiers = (await db.query<{ user_id: string; tier: number }>(`select user_id, tier from public.user_league where user_id = any($1)`, [L])).rows
    expect(tiers.filter((t) => t.tier === 2).map((t) => t.user_id).sort()).toEqual([L[4], L[5]].sort())   // 6 người → 2 người lên hạng
    expect(await xu(db, L[5])).toBeCloseTo(before + 10, 5)          // hạng 1: 10 Xu
    expect((await db.query(`select settled_at from public.league_groups where week_start = private.vn_week(now()) - 7`)).rows[0])
      .toMatchObject({ settled_at: expect.anything() })
    const zones = (await db.query<{ z: string }>(`select (select row(promote, demote)::text from private.league_zones(30, 3)) as z`)).rows[0].z
    expect(zones).toBe('(7,5)')
    expect(await fails(db, A, `select public.settle_due_leagues()`)).toMatch(/permission denied/)
  })
})
