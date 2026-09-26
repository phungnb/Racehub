import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createDb, asUser } from './load-schema'

// Migration 007600: thử thách tự lặp lại — kỳ mới tạo như chính người tạo bấm tạo (quyền, phí, lượt, quỹ)
const OWN = '00000000-0000-0000-0000-0000000076a1'
const MEM = '00000000-0000-0000-0000-0000000076a2'
const CLUB = '00000000-0000-0000-0000-0000000076c1'
type Row = Record<string, any>
const iso = (h: number) => new Date(Date.now() + h * 3600_000).toISOString()

async function seed(db: PGlite) {
  await db.exec(`
    insert into auth.users (id, email) values ('${OWN}', 'o76@x.vn'), ('${MEM}', 'm76@x.vn');
    insert into public.profiles (id, display_name, xu, xp, level, created_at) values ('${OWN}', 'Chủ nhiệm', 0, 0, 1, now()), ('${MEM}', 'Thành viên', 0, 0, 1, now())
      on conflict do nothing;
    insert into public.clubs (id, name, owner_id, invite_code) values ('${CLUB}', 'CLB Lặp', '${OWN}', 'lap761');
    insert into public.club_members (club_id, user_id, role, status) values ('${CLUB}', '${OWN}', 'OWNER', 'APPROVED'), ('${CLUB}', '${MEM}', 'MEMBER', 'APPROVED')
      on conflict do nothing;
  `)
}
const rpc = async <T = Row>(db: PGlite, uid: string, sql: string, params: unknown[] = []) => (await asUser<{ r: T }>(db, uid, '/rpc', sql, params)).rows[0]?.r
const fails = async (p: Promise<unknown>) => { try { await p } catch (e) { return (e as Error).message } return 'OK' }
const spawn = async (db: PGlite) => {
  await db.exec('set role service_role')
  try { return (await db.query<{ n: number }>(`select public.spawn_recurring_challenges() as n`)).rows[0].n } finally { await db.exec('reset role') }
}
const get = async (db: PGlite, id: string) => (await db.query<Row>(`select * from public.challenges where id = $1`, [id])).rows[0]

describe('thử thách tự lặp lại (007600)', () => {
  let db: PGlite
  let first: string
  beforeAll(async () => {
    db = await createDb({ withMigrations: true, runMigrationsTwice: true, seed })
    first = (await rpc<{ challenge_id: string }>(db, OWN, `select public.create_challenge_v2($1::jsonb, 'key-761-aaaa') as r`, [JSON.stringify({
      title: 'Thử thách tuần', format: 'RANKED', objective: 'DISTANCE', audience: 'CLUB_ONLY', club_id: CLUB,
      max_slots: 5, start_date: iso(-24 * 6), end_date: iso(20), min_km: 2,
    })]))!.challenge_id
  }, 240_000)

  it('chỉ ban quản trị bật được; kỳ dài hơn chu kỳ bị từ chối', async () => {
    expect(await fails(rpc(db, MEM, `select public.set_challenge_recurrence($1, 'WEEKLY') as r`, [first]))).toContain('FORBIDDEN')
    expect(await fails(rpc(db, OWN, `select public.set_challenge_recurrence($1, 'DAILY') as r`, [first]))).toContain('INVALID_RECURRENCE')
    expect(await rpc(db, OWN, `select public.set_challenge_recurrence($1, 'WEEKLY') as r`, [first])).toMatchObject({ recurrence: 'WEEKLY', series_id: first })
    await db.query(`update public.challenges set rules_info = '{"prizes":"Áo CLB"}'::jsonb, require_hr = true where id = $1`, [first])
  })

  it('cron tạo kỳ 2 đúng lịch + chép luật, đăng bảng tin CLB; chạy lại không tạo trùng', async () => {
    expect(await spawn(db)).toBe(1)
    const a = await get(db, first)
    const b = await get(db, a.recur_next_id)
    expect(b).toMatchObject({ title: 'Thử thách tuần · Kỳ 2', occurrence: 2, recurrence: 'WEEKLY', series_id: first, require_hr: true,
      target_club_id: CLUB, min_km: '2', rules_info: { prizes: 'Áo CLB' } })
    expect(new Date(b.start_date).getTime() - new Date(a.start_date).getTime()).toBe(7 * 86400_000)
    expect((await db.query(`select 1 from public.club_posts where club_id = $1 and kind = 'CHALLENGE'`, [CLUB])).rows).toHaveLength(2)
    expect(await spawn(db)).toBe(0)
    expect(await rpc<Row[]>(db, MEM, `select public.challenge_series($1) as r`, [first])).toHaveLength(2)
  })

  it('không đủ quỹ trả phí → không tạo, ghi lý do + báo người tạo; tắt lặp lại thì thôi', async () => {
    const big = (await rpc<{ challenge_id: string }>(db, OWN, `select public.create_challenge_v2($1::jsonb, 'key-761-bbbb') as r`, [JSON.stringify({
      title: 'Tháng lớn', format: 'RANKED', objective: 'DISTANCE', audience: 'CLUB_ONLY', club_id: CLUB,
      max_slots: 5, start_date: iso(-24 * 20), end_date: iso(10),
    })]))!.challenge_id
    await rpc(db, OWN, `select public.set_challenge_recurrence($1, 'MONTHLY') as r`, [big])
    await db.query(`update public.challenges set max_slots = 50 where id = $1`, [big])      // kỳ sau cần phí > 0, quỹ CLB = 0
    expect(await spawn(db)).toBe(0)
    expect((await get(db, big)).recur_error).toMatch(/INSUFFICIENT/)
    expect((await db.query(`select 1 from public.notifications where user_id = $1 and kind = 'CHALLENGE_RECUR_FAILED'`, [OWN])).rows).toHaveLength(1)
    expect(await spawn(db)).toBe(0)                                                           // báo một lần, không spam
    expect((await db.query(`select 1 from public.notifications where user_id = $1 and kind = 'CHALLENGE_RECUR_FAILED'`, [OWN])).rows).toHaveLength(1)
    await rpc(db, OWN, `select public.set_challenge_recurrence($1, 'NONE') as r`, [big])
    expect(await spawn(db)).toBe(0)
  })
})
