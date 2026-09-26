import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createDb, asUser } from './load-schema'

// Migration 007100: admin hệ thống toàn quyền ở mọi CLB (kể cả CLB không tham gia)
const OWN = '00000000-0000-0000-0000-0000000071a1'
const MEM = '00000000-0000-0000-0000-0000000071a2'
const ADM = '00000000-0000-0000-0000-0000000071a3'
const OUT = '00000000-0000-0000-0000-0000000071a4'
const CLUB = '00000000-0000-0000-0000-0000000071c1'

async function seed(db: PGlite) {
  await db.exec(`
    insert into auth.users (id, email) values ('${OWN}', 'o71@x.vn'), ('${MEM}', 'm71@x.vn'), ('${ADM}', 'a71@x.vn'), ('${OUT}', 'x71@x.vn');
    insert into public.profiles (id, display_name, xu, xp, level, created_at) values
      ('${OWN}', 'Chủ nhiệm', 0, 0, 1, now()), ('${MEM}', 'Thành viên', 0, 0, 1, now()), ('${ADM}', 'Admin', 0, 0, 1, now()), ('${OUT}', 'Người ngoài', 0, 0, 1, now())
      on conflict do nothing;
    insert into public.clubs (id, name, owner_id, invite_code) values ('${CLUB}', 'NO BEER NO RUN', '${OWN}', 'nbnr71');
    insert into public.club_members (club_id, user_id, role, status) values ('${CLUB}', '${OWN}', 'OWNER', 'APPROVED'), ('${CLUB}', '${MEM}', 'MEMBER', 'PENDING')
      on conflict do nothing;
  `)
}
const rpc = async <T,>(db: PGlite, uid: string, sql: string, params: unknown[] = []) => (await asUser<{ r: T }>(db, uid, '/rpc', sql, params)).rows[0].r
const fails = async (p: Promise<unknown>) => { try { await p } catch (e) { return (e as Error).message } return 'OK' }

describe('admin toàn quyền trong CLB (007100)', () => {
  let db: PGlite
  beforeAll(async () => {
    db = await createDb({ withMigrations: true, runMigrationsTwice: true, seed })
    await db.query(`update public.profiles set role = 'SYSTEM_ADMIN' where id = $1`, [ADM])
  }, 240_000)

  it('admin (không phải thành viên) có quyền ban quản trị + thành viên; người ngoài thì không', async () => {
    expect(await rpc(db, ADM, `select public.club_is_staff($1) as r`, [CLUB])).toBe(true)
    expect(await rpc(db, ADM, `select public.club_is_member($1) as r`, [CLUB])).toBe(true)
    expect(await rpc(db, OUT, `select public.club_is_staff($1) as r`, [CLUB])).toBe(false)
    expect(await rpc(db, OUT, `select public.club_is_member($1) as r`, [CLUB])).toBe(false)
  })

  it('admin duyệt thành viên, đổi màu CLB, đăng tin CLB, gán Pro ở CLB không tham gia', async () => {
    const mem = (await db.query<{ id: string }>(`select id from public.club_members where club_id = $1 and user_id = $2`, [CLUB, MEM])).rows[0].id
    await asUser(db, ADM, '/rpc', `select public.set_member_status($1, 'APPROVED')`, [mem])
    expect((await db.query<{ status: string }>(`select status from public.club_members where id = $1`, [mem])).rows[0].status).toBe('APPROVED')
    await asUser(db, ADM, '/rpc', `select public.set_club_accent($1, '#22c55e')`, [CLUB])
    expect(await fails(asUser(db, ADM, '/rpc', `select public.publish_club_news($1, $2::jsonb)`, [CLUB, JSON.stringify({ title: 'Thông báo từ RaceHub', body: 'Nội dung tin CLB dài đủ để đăng.' })]))).toBe('OK')
    expect(await rpc(db, ADM, `select public.admin_set_club_plan($1, 'PRO', now() + interval '30 days', 'tặng CLB') as r`, [CLUB])).toMatchObject({ plan: 'PRO' })
    expect(await fails(asUser(db, OUT, '/rpc', `select public.set_club_accent($1, '#000000')`, [CLUB]))).toContain('FORBIDDEN')
  })

  it('admin trao quyền chủ nhiệm và giải tán CLB (gõ đúng tên, có nhật ký)', async () => {
    await asUser(db, ADM, '/rpc', `select public.transfer_club_ownership($1, $2)`, [CLUB, MEM])
    const roles = (await db.query<{ user_id: string; role: string }>(`select user_id, role from public.club_members where club_id = $1`, [CLUB])).rows
    expect(roles.find((r) => r.user_id === MEM)?.role).toBe('OWNER')
    expect(roles.find((r) => r.user_id === OWN)?.role).toBe('CAPTAIN')
    expect(await fails(asUser(db, ADM, '/rpc', `select public.delete_club($1, 'sai tên')`, [CLUB]))).toContain('WRONG_NAME')
    expect(await fails(asUser(db, OUT, '/rpc', `select public.delete_club($1, 'NO BEER NO RUN')`, [CLUB]))).toContain('NOT_AUTHORIZED')
    await asUser(db, ADM, '/rpc', `select public.delete_club($1, 'no beer no run')`, [CLUB])
    expect((await db.query(`select 1 from public.clubs where id = $1`, [CLUB])).rows).toHaveLength(0)
    expect((await db.query(`select 1 from public.admin_audit_log where action = 'CLUB_DELETE' and target = $1`, ['club:' + CLUB])).rows).toHaveLength(1)
  })
})
