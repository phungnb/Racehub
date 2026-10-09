import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createDb, asUser } from './load-schema'

// Migration 014600: admin xem danh sách tài khoản đang khóa + lý do
const id = (n: number) => `00000000-0000-0000-0000-0000000146${String(n).padStart(2, '0')}`
const [ADM, U1, U2, U3] = [1, 2, 3, 4].map(id)

async function seed(db: PGlite) {
  const users = [ADM, U1, U2, U3]
  await db.exec(`
    insert into auth.users (id, email) values ${users.map((u, i) => `('${u}', 'b${i}@x.vn')`).join(', ')};
    insert into public.profiles (id, display_name, xu, xp, level, created_at) values
      ${users.map((u, i) => `('${u}', 'B${i}', 0, 0, 1, now())`).join(', ')} on conflict do nothing;
  `)
}
type Row = Record<string, any>
const rpc = async <T = Row>(db: PGlite, uid: string, sql: string, params: unknown[] = []) => (await asUser<{ r: T }>(db, uid, '/rpc', sql, params)).rows[0]?.r
const fails = async (p: Promise<unknown>) => { try { await p } catch (e) { return (e as Error).message } return 'OK' }

describe('danh sách tài khoản khóa (014600)', () => {
  let db: PGlite
  beforeAll(async () => {
    db = await createDb({ withMigrations: true, seed, until: '20261001014600' })
    await db.query(`update public.profiles set role = 'SYSTEM_ADMIN' where id = $1`, [ADM])
  }, 240_000)

  it('chỉ admin xem được; liệt kê khóa tay (kèm lý do, người khóa) và tự xóa; khớp số đếm của admin_inbox', async () => {
    expect(await fails(rpc(db, U1, `select public.admin_banned_users() as r`))).not.toBe('OK')
    expect(await rpc<Row[]>(db, ADM, `select public.admin_banned_users() as r`)).toEqual([])
    await rpc(db, ADM, `select public.admin_set_user_ban($1, true, 'Gian lận Xu') as r`, [U1])
    await db.query(`update public.profiles set banned_at = now(), banned_reason = 'ACCOUNT_DELETED' where id = $1`, [U2])
    const list = await rpc<Row[]>(db, ADM, `select public.admin_banned_users() as r`)
    expect(list).toHaveLength(2)
    expect(list.find((x) => x.id === U1)).toMatchObject({ kind: 'ADMIN', reason: 'Gian lận Xu', email: 'b1@x.vn', banned_by: 'B0' })
    expect(list.find((x) => x.id === U2)).toMatchObject({ kind: 'SELF_DELETED', banned_by: null })
    expect((await rpc<Row>(db, ADM, `select public.admin_inbox() as r`)).banned).toBe(2)
  })
})
