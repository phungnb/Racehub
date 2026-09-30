import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createDb, asUser } from './load-schema'

// Migration 011400: danh sách quản trị viên hệ thống (chỉ admin xem được)
const [U, ADM] = ['00000000-0000-0000-0000-0000001140a1', '00000000-0000-0000-0000-0000001140a2']
async function seed(db: PGlite) {
  await db.exec(`
    insert into auth.users (id, email) values ('${U}', 'u114@x.vn'), ('${ADM}', 'a114@x.vn');
    insert into public.profiles (id, display_name) values ('${U}', 'U'), ('${ADM}', 'Admin') on conflict do nothing;
    update public.profiles set role = 'SYSTEM_ADMIN' where id = '${ADM}';
  `)
}
describe('danh sách admin (011400)', () => {
  let db: PGlite
  beforeAll(async () => { db = await createDb({ withMigrations: true, runMigrationsTwice: true, seed, until: '20261001011700' }) }, 300_000)  // trước Quản trị chính (011800)
  it('admin xem được, người thường bị chặn; cấp quyền xong có trong danh sách', async () => {
    const list = async () => (await asUser<{ r: { id: string; email: string; is_me: boolean }[] }>(db, ADM, '/rpc', `select public.admin_list_admins() as r`)).rows[0].r
    expect((await list()).map((a) => a.email)).toEqual(['a114@x.vn'])
    expect(await asUser(db, U, '/rpc', `select public.admin_list_admins()`).then(() => 'OK', (e: Error) => e.message)).toContain('FORBIDDEN')
    await asUser(db, ADM, '/rpc', `select public.admin_set_user_role($1, 'SYSTEM_ADMIN', 'phó admin')`, [U])
    expect((await list()).map((a) => a.email).sort()).toEqual(['a114@x.vn', 'u114@x.vn'])
  })
})
