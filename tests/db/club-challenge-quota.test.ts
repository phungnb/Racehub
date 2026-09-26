import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createDb, asUser } from './load-schema'

// Migration 008200: hạn mức thử thách nội bộ CLB theo gói (Free / Pro) + chặn "CLB một người" dùng miễn phí
const ADM = '00000000-0000-0000-0000-0000000082a0'
const OWN = '00000000-0000-0000-0000-0000000082a1'
const M = ['00000000-0000-0000-0000-0000000082b1', '00000000-0000-0000-0000-0000000082b2', '00000000-0000-0000-0000-0000000082b3',
  '00000000-0000-0000-0000-0000000082b4']
const SOLO = '00000000-0000-0000-0000-0000000082a2'
const CLUB = '00000000-0000-0000-0000-0000000082c1'
const SOLO_CLUB = '00000000-0000-0000-0000-0000000082c2'
type Row = Record<string, any>
const iso = (h: number) => new Date(Date.now() + h * 3600_000).toISOString()
const ALL = [ADM, OWN, SOLO, ...M]

async function seed(db: PGlite) {
  await db.exec(`
    insert into auth.users (id, email) values ${ALL.map((u, i) => `('${u}', 'q82-${i}@x.vn')`).join(', ')};
    insert into public.profiles (id, display_name, xu, xp, level, created_at) values
      ${ALL.map((u, i) => `('${u}', 'Runner ${i}', ${u === OWN ? 5000 : 0}, 0, 1, now())`).join(', ')} on conflict do nothing;
    insert into public.clubs (id, name, owner_id, invite_code) values ('${CLUB}', 'CLB Thật', '${OWN}', 'that821'), ('${SOLO_CLUB}', 'CLB Một Người', '${SOLO}', 'motn821');
    insert into public.club_members (club_id, user_id, role, status) values ('${CLUB}', '${OWN}', 'OWNER', 'APPROVED'),
      ${M.map((u) => `('${CLUB}', '${u}', 'MEMBER', 'APPROVED')`).join(', ')}, ('${SOLO_CLUB}', '${SOLO}', 'OWNER', 'APPROVED') on conflict do nothing;
  `)
}
const rpc = async <T = Row>(db: PGlite, uid: string, sql: string, params: unknown[] = []) => (await asUser<{ r: T }>(db, uid, '/rpc', sql, params)).rows[0]?.r
const fails = async (p: Promise<unknown>) => { try { await p } catch (e) { return (e as Error).message } return 'OK' }
const run = (db: PGlite, uid: string, daysAgo = 3) =>
  db.query(`insert into public.activities (user_id, title, source, started_at, ended_at, distance_m, moving_time_s, validation_status, status)
            values ($1, 'Chạy', 'DIRECT_GPS', now() - make_interval(days => $2::int), now() - make_interval(days => $2::int) + interval '40 minutes',
                    6000, 2400, 'APPROVED', 'READY')`, [uid, daysAgo])
const quote = (db: PGlite, uid: string, slots: number, club: string | null) =>
  rpc(db, uid, `select public.quote_challenge($1, 'RANKED', $2) as r`, [slots, club])
let n = 0
const create = (db: PGlite, uid: string, club: string, slots: number) =>
  rpc<{ challenge_id: string; fee: number; club_free: string | null }>(db, uid, `select public.create_challenge_v2($1::jsonb, $2) as r`, [JSON.stringify({
    title: `Thử thách ${++n}`, format: 'RANKED', objective: 'DISTANCE', audience: 'CLUB_ONLY', club_id: club,
    max_slots: slots, start_date: iso(1), end_date: iso(24 * 7),
  }), `quota-82-${n}-xxxxxxxx`])
const treasury = (db: PGlite, club: string, xu: number) => rpc(db, OWN, `select public.contribute_treasury($1, $2) as r`, [club, xu])

describe('hạn mức thử thách CLB (008200)', () => {
  let db: PGlite
  beforeAll(async () => {
    db = await createDb({ withMigrations: true, runMigrationsTwice: true, seed })
    await db.query(`update public.profiles set role = 'SYSTEM_ADMIN' where id = $1`, [ADM])
  }, 240_000)

  it('CLB một người / ít người chạy: không được miễn phí, vẫn tính phí như thường', async () => {
    await run(db, SOLO)
    const q = await quote(db, SOLO, 20, SOLO_CLUB)
    expect(q.club_quota).toMatchObject({ plan: 'FREE', eligible: false, reason: 'NEED_ACTIVE_MEMBERS', active_members: 1, min_active_members: 5 })
    expect(Number(q.fee)).toBeGreaterThan(0)
    expect(await fails(create(db, SOLO, SOLO_CLUB, 20))).toContain('INSUFFICIENT_TREASURY')
    // bài chạy cũ hơn 30 ngày không tính là thành viên "thật"
    for (const u of [OWN, ...M.slice(0, 3)]) await run(db, u)
    await run(db, M[3], 45)
    expect((await quote(db, OWN, 20, CLUB)).club_quota).toMatchObject({ eligible: false, active_members: 4 })
  })

  it('CLB Free đủ 5 người chạy: miễn phí ≤ 50 người, tối đa 2 thử thách cùng lúc; quá hạn mức → mất phí', async () => {
    await run(db, M[3])
    const q = await quote(db, OWN, 50, CLUB)
    expect(q).toMatchObject({ fee: 0, pass: null, club_quota: { plan: 'FREE', eligible: true, active_members: 5, open: 0, max_open: 2 } })
    expect(Number(q.list_fee)).toBeGreaterThan(0)
    expect((await quote(db, OWN, 51, CLUB)).club_quota).toMatchObject({ eligible: false, reason: 'SLOTS_LIMIT' })

    const a = await create(db, OWN, CLUB, 50)
    expect(a).toMatchObject({ fee: 0, club_free: 'FREE' })
    expect(await create(db, OWN, CLUB, 20)).toMatchObject({ fee: 0, club_free: 'FREE' })
    expect((await quote(db, OWN, 20, CLUB)).club_quota).toMatchObject({ eligible: false, reason: 'OPEN_LIMIT', open: 2 })
    expect(await fails(create(db, OWN, CLUB, 20))).toContain('INSUFFICIENT_TREASURY')
    await treasury(db, CLUB, 1000)
    const paid = await create(db, OWN, CLUB, 20)
    expect(paid!.fee).toBeGreaterThan(0)
    expect(paid!.club_free).toBeNull()

    // thử thách kết thúc / huỷ thì trả lại chỗ
    await db.query(`update public.challenges set status = 'CANCELLED' where id = $1`, [a!.challenge_id])
    await db.query(`update public.challenges set status = 'CANCELLED' where id = $1`, [paid!.challenge_id])
    expect((await quote(db, OWN, 20, CLUB)).club_quota).toMatchObject({ eligible: true, open: 1 })
  })

  it('CLB Pro: không cần điều kiện thành viên, tới 20 thử thách cùng lúc, mỗi thử thách tới 1.000 người', async () => {
    await rpc(db, ADM, `select public.admin_set_club_plan($1, 'PRO', null, 'Test Pro') as r`, [SOLO_CLUB])
    const q = await quote(db, SOLO, 1000, SOLO_CLUB)
    expect(q).toMatchObject({ fee: 0, club_quota: { plan: 'PRO', eligible: true, max_open: 20, max_slots: 1000 } })
    expect(await create(db, SOLO, SOLO_CLUB, 1000)).toMatchObject({ fee: 0, club_free: 'PRO' })
  })

  it('xem hạn mức: thành viên xem được, người ngoài bị chặn; admin chỉnh được con số', async () => {
    expect(await rpc(db, M[0], `select public.club_challenge_quota($1) as r`, [CLUB])).toMatchObject({ plan: 'FREE', max_open: 2 })
    expect(await fails(rpc(db, SOLO, `select public.club_challenge_quota($1) as r`, [CLUB]))).toContain('NOT_A_MEMBER')
    const cfg = await rpc(db, ADM, `select public.economy_policy() as r`)
    await rpc(db, ADM, `select public.admin_publish_config('economy_global_config', $1::jsonb) as r`,
      [JSON.stringify({ ...cfg, clubChallenge: { freeMaxOpen: 3, freeMinActiveMembers: 3 } })])
    expect(await rpc(db, M[0], `select public.club_challenge_quota($1) as r`, [CLUB])).toMatchObject({ max_open: 3, min_active_members: 3, max_slots: 50 })
  })

  it('thử thách cá nhân / công khai không được hưởng hạn mức CLB', async () => {
    const q = await quote(db, M[0], 20, null)
    expect(q).toMatchObject({ payer: 'USER', club_quota: null })
    expect(Number(q.fee)).toBeGreaterThan(0)
  })
})
