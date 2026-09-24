import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createDb, asUser } from './load-schema'

// Migration 002800: gói CLB Pro
const id = (n: number) => `00000000-0000-0000-0000-0000000008${String(n).padStart(2, '0')}`
const [OWN, M1, M2, M3, ADM] = [1, 2, 3, 4, 5].map(id)
const CLUB = '00000000-0000-0000-0000-0000000008c1'

async function seed(db: PGlite) {
  const users = [OWN, M1, M2, M3, ADM]
  await db.exec(`
    insert into auth.users (id, email) values ${users.map((u, i) => `('${u}', 'pro${i}@x.vn')`).join(', ')};
    insert into public.profiles (id, display_name, xu, xp, level, created_at) values
      ${users.map((u, i) => `('${u}', 'P${i}', 0, 0, 1, now())`).join(', ')} on conflict do nothing;
    update public.profiles set role = 'SYSTEM_ADMIN' where id = '${ADM}';
    insert into public.clubs (id, name, owner_id, invite_code) values ('${CLUB}', 'CLB Pro', '${OWN}', 'pro001');
    insert into public.club_members (club_id, user_id, role, status) values
      ('${CLUB}', '${OWN}', 'OWNER', 'APPROVED'), ('${CLUB}', '${M1}', 'MEMBER', 'APPROVED'), ('${CLUB}', '${M2}', 'MEMBER', 'APPROVED'),
      ('${CLUB}', '${M3}', 'MEMBER', 'APPROVED') on conflict do nothing;
  `)
}
const rpc = async <T,>(db: PGlite, uid: string, sql: string, params: unknown[] = []) => (await asUser<{ r: T }>(db, uid, '/rpc', sql, params)).rows[0].r
const fails = async (p: Promise<unknown>) => { try { await p } catch (e) { return (e as Error).message } return 'OK' }

describe('gói CLB Pro (002800)', () => {
  let db: PGlite
  beforeAll(async () => {
    db = await createDb({ withMigrations: true, runMigrationsTwice: true, seed })
    await db.query(`update public.club_members set role = 'CAPTAIN' where club_id = $1 and user_id in ($2, $3)`, [CLUB, M1, M2])
  }, 240_000)

  it('gói miễn phí: tối đa 2 quản trị viên; link mời riêng và báo cáo cần Pro', async () => {
    expect(await fails(db.query(`update public.club_members set role = 'CAPTAIN' where club_id = $1 and user_id = $2`, [CLUB, M3]))).toContain('CAPTAIN_LIMIT')
    expect(await fails(rpc(db, OWN, `select public.set_club_slug($1, 'nbnr') as r`, [CLUB]))).toContain('PRO_REQUIRED')
    expect(await fails(rpc(db, OWN, `select public.club_attendance_report($1, now() - interval '30 days', now()) as r`, [CLUB]))).toContain('PRO_REQUIRED')
    expect(await rpc(db, M3, `select public.club_plan($1) as r`, [CLUB])).toMatchObject({ plan: 'FREE', active: false, captains: 2, captain_limit: 2 })
  })

  it('admin bật Pro (có lý do, nhật ký, thông báo) → mở khóa; link /c/slug trả mã mời; hết hạn thì khóa lại', async () => {
    expect(await fails(rpc(db, OWN, `select public.admin_set_club_plan($1, 'PRO', null, 'tự nâng') as r`, [CLUB]))).toContain('FORBIDDEN')
    expect(await fails(rpc(db, ADM, `select public.admin_set_club_plan($1, 'PRO', null, '') as r`, [CLUB]))).toContain('REASON_REQUIRED')
    await rpc(db, ADM, `select public.admin_set_club_plan($1, 'PRO', now() + interval '30 days', 'Chuyển khoản 12 tháng') as r`, [CLUB])
    expect((await db.query(`select 1 from public.admin_audit_log where action = 'SET_CLUB_PLAN'`)).rows).toHaveLength(1)
    expect((await db.query(`select 1 from public.notifications where kind = 'CLUB_PRO' and user_id = $1`, [M1])).rows).toHaveLength(1)

    await db.query(`update public.club_members set role = 'CAPTAIN' where club_id = $1 and user_id = $2`, [CLUB, M3])   // Pro: không giới hạn
    expect(await fails(rpc(db, M3, `select public.set_club_slug($1, 'Admin') as r`, [CLUB]))).toContain('INVALID_SLUG')
    expect(await rpc(db, M3, `select public.set_club_slug($1, 'NBNR-Runners') as r`, [CLUB])).toBe('nbnr-runners')
    const code = (await asUser<{ r: string }>(db, M1, '/rpc', `select public.resolve_club_slug('nbnr-runners') as r`)).rows[0].r
    expect(code).toBe('pro001')

    await db.query(`insert into public.activities (user_id, title, source, started_at, ended_at, distance_m, moving_time_s, avg_pace_s, validation_status, status)
      values ($1, 'Chạy', 'DIRECT_GPS', now() - interval '2 days', now() - interval '2 days' + interval '1 hour', 10000, 3000, 300, 'APPROVED', 'READY')`, [M3])
    const rep = await rpc<{ members: { user_id: string; runs: number; km: number }[] }>(db, OWN,
      `select public.club_attendance_report($1, now() - interval '30 days', now()) as r`, [CLUB])
    expect(rep.members[0]).toMatchObject({ user_id: M3, runs: 1, km: 10 })

    await db.query(`update public.clubs set pro_until = now() - interval '1 minute' where id = $1`, [CLUB])
    expect((await asUser<{ r: string | null }>(db, M1, '/rpc', `select public.resolve_club_slug('nbnr-runners') as r`)).rows[0].r).toBeNull()
    expect(await rpc(db, OWN, `select public.club_plan($1) as r`, [CLUB])).toMatchObject({ plan: 'PRO', active: false })
  })
})
