import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createDb, asUser } from './load-schema'

// Migration 002600: CLB đấu CLB + BXH CLB
const id = (n: number) => `00000000-0000-0000-0000-0000000006${String(n).padStart(2, '0')}`
const [OA, A1, A2, OB, B1, B2, B3, B4] = [1, 2, 3, 4, 5, 6, 7, 8].map(id)
const CA = '00000000-0000-0000-0000-0000000006c1', CB = '00000000-0000-0000-0000-0000000006c2'

async function seed(db: PGlite) {
  const users = [OA, A1, A2, OB, B1, B2, B3, B4]
  await db.exec(`
    insert into auth.users (id, email) values ${users.map((u, i) => `('${u}', 'cb${i}@x.vn')`).join(', ')};
    insert into public.profiles (id, display_name, xu, xp, level, created_at) values
      ${users.map((u, i) => `('${u}', 'R${i}', 0, 0, 1, now())`).join(', ')} on conflict do nothing;
    insert into public.clubs (id, name, owner_id, invite_code) values ('${CA}', 'Hồ Tây', '${OA}', 'cb0001'), ('${CB}', 'Sông Hồng', '${OB}', 'cb0002');
    insert into public.club_members (club_id, user_id, role, status, joined_at) values
      ('${CA}', '${OA}', 'OWNER', 'APPROVED', now() - interval '30 days'), ('${CA}', '${A1}', 'MEMBER', 'APPROVED', now() - interval '30 days'),
      ('${CA}', '${A2}', 'MEMBER', 'APPROVED', now() - interval '30 days'),
      ('${CB}', '${OB}', 'OWNER', 'APPROVED', now() - interval '30 days'), ('${CB}', '${B1}', 'MEMBER', 'APPROVED', now() - interval '30 days'),
      ('${CB}', '${B2}', 'MEMBER', 'APPROVED', now() - interval '30 days'), ('${CB}', '${B3}', 'MEMBER', 'APPROVED', now() - interval '30 days'),
      ('${CB}', '${B4}', 'MEMBER', 'APPROVED', now() - interval '30 days')
      on conflict do nothing;
  `)
}

type Side = { km: number; avg_km: number; runners: number; members: number; top: { user_id: string }[] }
type Battle = { id: string; status: string; leader_id: string | null; winner_id: string | null; can_respond: boolean; challenger: Side; opponent: Side }
const rpc = async <T,>(db: PGlite, uid: string, sql: string, params: unknown[] = []) => (await asUser<{ r: T }>(db, uid, '/rpc', sql, params)).rows[0].r
const fails = async (p: Promise<unknown>) => { try { await p } catch (e) { return (e as Error).message } return 'OK' }
let h = 60
const run = (db: PGlite, uid: string, km: number, hoursAgo = (h -= 2)) => db.query(`
  insert into public.activities (user_id, title, source, started_at, ended_at, distance_m, moving_distance_m, moving_time_s, avg_pace_s, validation_status, status)
  values ($1, 'Chạy', 'DIRECT_GPS', now() - make_interval(hours => $3), now() - make_interval(hours => $3) + interval '30 minutes', $2::numeric, $2::numeric, 1800, 360, 'APPROVED', 'READY')`,
  [uid, km * 1000, hoursAgo])

describe('CLB đấu CLB (002600)', () => {
  let db: PGlite
  let bid = ''
  beforeAll(async () => { db = await createDb({ withMigrations: true, runMigrationsTwice: true, seed }) }, 240_000)

  it('chỉ ban quản trị gửi lời thách; không gửi trùng; CLB kia chấp nhận', async () => {
    const start = new Date(Date.now() + 600_000).toISOString(), end = new Date(Date.now() + 3 * 86400_000).toISOString()
    const q = `select public.create_club_battle($1, $2, 'AVG_KM', $3, $4, 'Dám không?') as r`
    expect(await fails(rpc(db, A1, q, [CA, CB, start, end]))).toContain('FORBIDDEN')
    const b = await rpc<Battle>(db, OA, q, [CA, CB, start, end])
    bid = b.id
    expect(b.status).toBe('PENDING')
    expect(await fails(rpc(db, OB, q, [CB, CA, start, end]))).toContain('BATTLE_EXISTS')
    expect((await db.query(`select 1 from public.notifications where user_id = $1 and kind = 'CLUB_BATTLE'`, [OB])).rows).toHaveLength(1)
    expect(await fails(rpc(db, OA, `select public.respond_club_battle($1, true) as r`, [bid]))).toContain('FORBIDDEN')
    expect(await fails(rpc(db, B1, `select public.respond_club_battle($1, true) as r`, [bid]))).toContain('FORBIDDEN')
    expect((await rpc<Battle>(db, OB, `select public.respond_club_battle($1, true) as r`, [bid])).status).toBe('ACCEPTED')
  })

  it('tính km trung bình mỗi thành viên; bài trước giờ đấu không tính; tất toán báo thắng thua', async () => {
    await db.query(`update public.club_battles set start_at = now() - interval '3 days', end_at = now() + interval '1 day' where id = $1`, [bid])
    await run(db, A1, 99, 100)                       // trước giờ đấu → không tính
    await run(db, A1, 12); await run(db, A2, 9)       // Hồ Tây: 21 km / 3 người = 7
    await run(db, B1, 20); await run(db, B2, 5)       // Sông Hồng: 25 km / 5 người = 5
    const b = await rpc<Battle>(db, B3, `select public.club_battle($1) as r`, [bid])
    expect([b.challenger.km, b.challenger.avg_km, b.challenger.runners]).toEqual([21, 7, 2])
    expect([b.opponent.km, b.opponent.avg_km]).toEqual([25, 5])
    expect(b.leader_id).toBe(CA)                     // tổng ít hơn nhưng trung bình cao hơn

    await db.query(`update public.club_battles set end_at = now() - interval '3 hours' where id = $1`, [bid])
    await db.exec('set role service_role')
    try { expect(Number((await db.query<{ n: number }>(`select public.settle_due_club_battles() as n`)).rows[0].n)).toBe(1) }
    finally { await db.exec('reset role') }
    const done = await rpc<Battle>(db, A2, `select public.club_battle($1) as r`, [bid])
    expect(done).toMatchObject({ status: 'FINISHED', winner_id: CA })
    const title = (await db.query<{ title: string }>(`select title from public.notifications where user_id = $1 and kind = 'CLUB_BATTLE' order by created_at desc`, [A1])).rows[0].title
    expect(title).toContain('thắng')
  })

  it('BXH CLB: xếp theo km trung bình mỗi thành viên, có hạng', async () => {
    const r = await rpc<{ club_id: string; avg_km: number; tier: string; is_mine: boolean }[]>(db, A1, `select public.club_rankings('MONTH') as r`)
    expect(r.map((x) => x.club_id).slice(0, 2)).toEqual([CA, CB].filter((c) => r.some((x) => x.club_id === c)).sort((a, b) =>
      (r.find((x) => x.club_id === b)!.avg_km) - (r.find((x) => x.club_id === a)!.avg_km)))
    expect(r.find((x) => x.club_id === CA)).toMatchObject({ is_mine: true, tier: expect.any(String) })
    expect(await fails(rpc(db, A1, `select public.club_rankings('YEAR') as r`))).toContain('INVALID_PERIOD')
  })
})
