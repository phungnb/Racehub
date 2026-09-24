import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createDb, asUser } from './load-schema'

// Migration 002000: thử thách theo mục tiêu tự đăng ký — thử thách tuần + đua đội chia cân bằng
const U = Array.from({ length: 7 }, (_, i) => `00000000-0000-0000-0000-0000000001a${i}`)
const [A, B, C, D, E, F, OUT] = U

async function seed(db: PGlite) {
  await db.exec(`
    insert into auth.users (id, email) values ${U.map((u, i) => `('${u}', 'p${i}@x.vn')`).join(', ')};
    insert into public.profiles (id, display_name, xu, xp, level, created_at) values
      ${U.map((u, i) => `('${u}', 'Runner ${i}', 0, 0, 1, now())`).join(', ')} on conflict do nothing;
  `)
}

type Row = Record<string, unknown>
const rpc = async <T = Row>(db: PGlite, uid: string, sql: string, params: unknown[] = []) =>
  (await asUser<T>(db, uid, '/rpc', sql, params)).rows
const fails = async (db: PGlite, uid: string, sql: string, params: unknown[] = []) => {
  try { await asUser(db, uid, '/rpc', sql, params) } catch (e) { return (e as Error).message }
  return 'OK'
}
const iso = (h: number) => new Date(Date.now() + h * 3600_000).toISOString()
let seq = 0
const create = async (db: PGlite, p: Row) =>
  (await rpc<{ r: { challenge_id: string } }>(db, A, `select public.create_challenge_v2($1::jsonb, $2) as r`,
    [JSON.stringify(p), `pledge-key-${++seq}`]))[0].r.challenge_id
const run = (db: PGlite, uid: string, km: number) => db.query(`
  insert into public.activities (user_id, title, source, started_at, ended_at, distance_m, moving_distance_m, moving_time_s, avg_pace_s, validation_status, status)
  values ($1, 'Chạy', 'DIRECT_GPS', now() - interval '40 minutes', now() - interval '10 minutes', $2::numeric, $2::numeric, $3::int, 360, 'APPROVED', 'READY')`,
  [uid, km * 1000, Math.round(km * 360)])
const me = async (db: PGlite, cid: string, uid: string) =>
  (await db.query<{ current_progress: string; status: string; pledge_km: string | null; team_id: string | null }>(
    `select current_progress, status, pledge_km, team_id from public.challenge_participants where challenge_id = $1 and profile_id = $2`, [cid, uid])).rows[0]
type Board = { missing: number; members: { user_id: string; pledge_km: number; counted_km: number; pct: number | null }[];
  teams: { team_id: string; members: number; pledge_total: number; counted_total: number }[] | null }
const board = async (db: PGlite, uid: string, cid: string) =>
  (await rpc<{ r: Board }>(db, uid, `select public.challenge_pledge_board($1) as r`, [cid]))[0].r

describe('Thử thách theo mục tiêu tự đăng ký (002000)', () => {
  let db: PGlite
  beforeAll(async () => {
    db = await createDb({ withMigrations: true, runMigrationsTwice: true, seed })
    await db.query(`select private.ledger_post('TEST_SEED', 'seed:pledge', 'seed', null,
      jsonb_build_array(jsonb_build_object('account_id', $1::uuid, 'coin_kind', 'BONUS', 'amount', 5000),
                        jsonb_build_object('account_id', private.system_account(), 'coin_kind', 'BONUS', 'amount', -5000)))`, [A])
  }, 240_000)

  it('thử thách tuần: mỗi người chọn mốc, hoàn thành theo mốc của mình, trần phần vượt', async () => {
    const cid = await create(db, { title: 'Thử thách tuần 39', format: 'SOLO_GOAL', objective: 'DISTANCE', target_value: 21,
      start_date: iso(-1), end_date: iso(24 * 6), max_slots: 20 })
    expect(await fails(db, B, `select public.set_challenge_pledge($1, '{"options":[21,42]}'::jsonb)`, [cid])).toContain('FORBIDDEN')
    expect(await fails(db, A, `select public.set_challenge_pledge($1, '{"options":[]}'::jsonb)`, [cid])).toContain('INVALID_PLEDGE_OPTIONS')
    await rpc(db, A, `select public.set_challenge_pledge($1, '{"options":[42,21,60,100],"cap_pct":50}'::jsonb)`, [cid])

    await rpc(db, B, `select public.join_challenge($1)`, [cid])
    expect(await fails(db, B, `select public.set_my_pledge($1, 30)`, [cid])).toContain('INVALID_PLEDGE')
    await rpc(db, A, `select public.set_my_pledge($1, 21)`, [cid])
    await rpc(db, B, `select public.set_my_pledge($1, 60)`, [cid])
    // Đã xuất phát và đã có mục tiêu → không đổi được
    expect(await fails(db, B, `select public.set_my_pledge($1, 21)`, [cid])).toContain('PLEDGE_LOCKED')

    await run(db, A, 35)        // mốc 21, trần +50% = 31,5
    await run(db, B, 30)        // mốc 60 → chưa đạt
    expect(await me(db, cid, A)).toMatchObject({ current_progress: '31.50', status: 'COMPLETED' })
    expect(await me(db, cid, B)).toMatchObject({ current_progress: '30.00', status: 'JOINED' })

    const b = await board(db, B, cid)
    expect(b.members.map((m) => [m.user_id, Number(m.pct)])).toEqual([[A, 150], [B, 50]])   // xếp theo % mục tiêu
    expect(await fails(db, A, `select public.set_challenge_pledge($1, '{"options":[10]}'::jsonb)`, [cid])).toContain('PLEDGE_RULES_LOCKED')
  })

  it('đua đội: đăng ký mục tiêu → chia đội cân bằng tổng km; khóa khi xuất phát; tính tối đa mục tiêu + % vượt', async () => {
    const cid = await create(db, { title: 'Đua đội 10 ngày', format: 'TEAM', objective: 'DISTANCE', game_mode: 'TEAM_AVG',
      team_names: ['Đỏ', 'Xanh'], start_date: iso(2), end_date: iso(24 * 10), max_slots: 20 })
    await rpc(db, A, `select public.set_challenge_pledge($1, '{"min_km":10,"max_km":300,"cap_pct":20}'::jsonb)`, [cid])
    expect((await db.query<{ game_mode: string }>(`select game_mode from public.challenges where id = $1`, [cid])).rows[0].game_mode).toBe('TEAM_SUM')

    const pledges: [string, number][] = [[A, 100], [B, 80], [C, 60], [D, 50], [E, 40], [F, 30]]
    for (const [u, km] of pledges) {
      await rpc(db, u, `select public.join_challenge($1)`, [cid])
      if (u !== F) await rpc(db, u, `select public.set_my_pledge($1, $2)`, [cid, km])
    }
    expect(await fails(db, E, `select public.set_my_pledge($1, 5)`, [cid])).toContain('INVALID_PLEDGE')
    // Còn người chưa đăng ký mục tiêu → báo số người thiếu
    expect(await fails(db, A, `select public.assign_pledge_teams($1, 'BALANCE')`, [cid])).toContain('PLEDGES_MISSING:1')
    await rpc(db, F, `select public.set_my_pledge($1, 30)`, [cid])
    expect(await fails(db, B, `select public.assign_pledge_teams($1, 'BALANCE')`, [cid])).toContain('FORBIDDEN')

    for (const method of ['BALANCE', 'RANDOM']) {
      const r = (await rpc<{ r: Board }>(db, A, `select public.assign_pledge_teams($1, $2) as r`, [cid, method]))[0].r
      const t = r.teams!.map((x) => Number(x.pledge_total))
      expect(t.reduce((a, b) => a + b, 0)).toBe(360)
      expect(Math.abs(t[0] - t[1])).toBeLessThanOrEqual(10)          // 180 / 180 (hoặc lệch tối đa 10 km)
      expect(r.teams!.map((x) => x.members)).toEqual([3, 3])
    }
    // Đã chia đội → mục tiêu khóa
    expect(await fails(db, B, `select public.set_my_pledge($1, 90)`, [cid])).toContain('PLEDGE_LOCKED')

    // Xếp tay một người
    const teams = (await board(db, A, cid)).teams!
    const moved = await me(db, cid, F)
    const other = teams.find((x) => x.team_id !== moved.team_id)!.team_id
    const pid = (await db.query<{ id: string }>(`select id from public.challenge_participants where challenge_id = $1 and profile_id = $2`, [cid, F])).rows[0].id
    await rpc(db, A, `select public.move_pledge_member($1, $2, $3)`, [cid, pid, other])
    expect((await me(db, cid, F)).team_id).toBe(other)

    // Xuất phát: chạy vượt mục tiêu chỉ được tính tối đa +20%
    await db.query(`update public.challenges set start_date = now() - interval '2 hours' where id = $1`, [cid])
    expect(await fails(db, A, `select public.assign_pledge_teams($1, 'BALANCE')`, [cid])).toContain('TEAM_ROSTER_LOCKED')
    await run(db, F, 50)                                              // mục tiêu 30 → tính tối đa 36
    expect(Number((await me(db, cid, F)).current_progress)).toBe(36)
    expect((await me(db, cid, F)).status).toBe('COMPLETED')
  })

  it('người ngoài không xem được bảng mục tiêu của thử thách riêng', async () => {
    const cid = await create(db, { title: 'Nội bộ', format: 'SOLO_GOAL', objective: 'DISTANCE', target_value: 21, audience: 'INVITE_ONLY',
      start_date: iso(-1), end_date: iso(48), max_slots: 5 })
    expect(await fails(db, OUT, `select public.challenge_pledge_board($1)`, [cid])).toContain('CHALLENGE_NOT_FOUND')
  })
})
