import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createDb, asUser } from './load-schema'

// Migration 009000: admin đánh dấu "Lỗi người dùng gặp" là đã xử lý → xoá khỏi nhật ký, số đỏ ở Quản trị sạch ngay
const [U, ADM] = ['00000000-0000-0000-0000-0000000090a1', '00000000-0000-0000-0000-0000000090a2']
async function seed(db: PGlite) {
  await db.exec(`
    insert into auth.users (id, email) values ('${U}', 'u@e.vn'), ('${ADM}', 'a@e.vn');
    insert into public.profiles (id, display_name, xu, xp, level, created_at) values ('${U}', 'U', 0, 0, 1, now()), ('${ADM}', 'A', 0, 0, 1, now());
    update public.profiles set role = 'SYSTEM_ADMIN' where id = '${ADM}';
  `)
}
const call = async <T,>(db: PGlite, uid: string, sql: string, params: unknown[] = []) => (await asUser<{ r: T }>(db, uid, '/rpc', sql, params)).rows[0]?.r
const count = async (db: PGlite) => (await db.query<{ n: number }>(`select count(*)::int n from private.client_errors`)).rows[0].n

describe('lỗi người dùng gặp: đánh dấu đã xử lý (009000)', () => {
  let db: PGlite
  beforeAll(async () => { db = await createDb({ withMigrations: true, runMigrationsTwice: true, seed }) }, 240_000)

  it('xoá từng mã hoặc tất cả; chỉ admin; ghi nhật ký quản trị', async () => {
    await call(db, U, `select public.log_client_error('NOT_DEPLOYED', 'RPC-A01', 'function x does not exist', '/run') as r`)
    await call(db, U, `select public.log_client_error('SERVER', 'SRV-B02', 'boom', '/feed') as r`)
    await call(db, U, `select public.log_client_error('SERVER', 'SRV-B02', 'boom', '/feed') as r`)
    expect(await count(db)).toBe(2)
    await expect(call(db, U, `select public.admin_resolve_client_error('RPC-A01') as r`)).rejects.toThrow(/FORBIDDEN/)
    expect(await call<number>(db, ADM, `select public.admin_resolve_client_error('RPC-A01') as r`)).toBe(1)
    expect(await count(db)).toBe(1)
    expect(await call<number>(db, ADM, `select public.admin_resolve_client_error(null) as r`)).toBe(2)
    expect(await count(db)).toBe(0)
    expect((await db.query(`select 1 from public.admin_audit_log where action = 'CLIENT_ERROR_RESOLVE'`)).rows).toHaveLength(2)
    // Lỗi còn xảy ra thì được ghi lại như mới
    await call(db, U, `select public.log_client_error('SERVER', 'SRV-B02', 'boom', '/feed') as r`)
    expect(await count(db)).toBe(1)
  })
})
