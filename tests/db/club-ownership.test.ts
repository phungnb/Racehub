import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createDb, asUser } from './load-schema'

// Migration 005000: trao quyền Chủ nhiệm / Chủ nhiệm rời CLB
const id = (n: number) => `00000000-0000-0000-0000-0000000050${String(n).padStart(2, '0')}`
const [OWN, CAP, MEM, PEND, OUT] = [1, 2, 3, 4, 5].map(id)
const CLUB = '00000000-0000-0000-0000-0000000050c1'

async function seed(db: PGlite) {
  const users = [OWN, CAP, MEM, PEND, OUT]
  await db.exec(`
    insert into auth.users (id, email) values ${users.map((u, i) => `('${u}', 'o${i}@x.vn')`).join(', ')};
    insert into public.profiles (id, display_name, xu, xp, level, created_at) values
      ${users.map((u, i) => `('${u}', 'U${i}', 0, 0, 1, now())`).join(', ')} on conflict do nothing;
    insert into public.clubs (id, name, owner_id, invite_code) values ('${CLUB}', 'CLB A', '${OWN}', 'own001');
  `)
}
const call = (db: PGlite, uid: string, sql: string, params: unknown[]) => asUser(db, uid, '/rpc', sql, params)
const fails = async (p: Promise<unknown>) => { try { await p } catch (e) { return (e as Error).message } return 'OK' }
const role = async (db: PGlite, u: string) => (await db.query<{ role: string }>(`select role from public.club_members where club_id = $1 and user_id = $2`, [CLUB, u])).rows[0]?.role

describe('trao quyền Chủ nhiệm (005000)', () => {
  let db: PGlite
  beforeAll(async () => {
    db = await createDb({ withMigrations: true, runMigrationsTwice: true, seed })
    await db.exec(`insert into public.club_members (club_id, user_id, role, status) values
      ('${CLUB}', '${OWN}', 'OWNER', 'APPROVED'), ('${CLUB}', '${CAP}', 'CAPTAIN', 'APPROVED'),
      ('${CLUB}', '${MEM}', 'MEMBER', 'APPROVED'), ('${CLUB}', '${PEND}', 'MEMBER', 'PENDING') on conflict do nothing`)
  }, 240_000)

  it('chủ nhiệm trao cho thành viên: người cũ thành Quản trị viên, clubs.owner_id đổi, người mới nhận thông báo', async () => {
    const q = `select public.transfer_club_ownership($1, $2)`
    expect(await fails(call(db, CAP, q, [CLUB, MEM]))).toContain('NOT_AUTHORIZED')
    expect(await fails(call(db, OWN, q, [CLUB, OWN]))).toContain('CANNOT_TRANSFER_TO_SELF')
    expect(await fails(call(db, OWN, q, [CLUB, PEND]))).toContain('TARGET_NOT_MEMBER')
    expect(await fails(call(db, OWN, q, [CLUB, OUT]))).toContain('TARGET_NOT_MEMBER')
    await call(db, OWN, q, [CLUB, MEM])
    expect([await role(db, OWN), await role(db, MEM)]).toEqual(['CAPTAIN', 'OWNER'])
    expect((await db.query<{ owner_id: string }>(`select owner_id from public.clubs where id = $1`, [CLUB])).rows[0].owner_id).toBe(MEM)
    expect((await db.query(`select 1 from public.notifications where user_id = $1 and kind = 'CLUB_ROLE'`, [MEM])).rows).toHaveLength(1)
  })

  it('chủ nhiệm rời CLB không chỉ định: tự trao cho Quản trị viên vào sớm nhất', async () => {
    await call(db, MEM, `select public.leave_club($1, null)`, [CLUB])
    expect(await role(db, MEM)).toBeUndefined()
    // OWN (Quản trị viên từ bước trước) và CAP cùng là Quản trị viên → người vào CLB sớm hơn thành Chủ nhiệm
    const owners = (await db.query<{ user_id: string }>(`select user_id from public.club_members where club_id = $1 and role = 'OWNER'`, [CLUB])).rows
    expect(owners).toHaveLength(1)
    expect([OWN, CAP]).toContain(owners[0].user_id)
    expect(await fails(call(db, PEND, `select public.leave_club($1, $2)`, [CLUB, OUT]))).toBe('OK')   // thành viên thường rời bình thường
  })
})
