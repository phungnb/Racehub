import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createDb, asUser } from './load-schema'

// Migration 008600: tổ chức DEMO có dữ liệu mẫu cho admin / khách dùng thử
const [ADM, GUEST, USER] = ['00000000-0000-0000-0000-0000000086a1', '00000000-0000-0000-0000-0000000086a2', '00000000-0000-0000-0000-0000000086a3']

async function seed(db: PGlite) {
  await db.exec(`
    insert into auth.users (id, email) values ('${ADM}', 'adm@demo.vn'), ('${GUEST}', 'khach@congty.vn'), ('${USER}', 'u@demo.vn');
    insert into public.profiles (id, display_name, xu, xp, level, created_at) values
      ('${ADM}', 'Admin', 0, 0, 1, now()), ('${GUEST}', 'Khách', 0, 0, 1, now()), ('${USER}', 'U', 0, 0, 1, now()) on conflict do nothing;
    update public.profiles set role = 'SYSTEM_ADMIN' where id = '${ADM}';
  `)
}
const rpc = async <T,>(db: PGlite, uid: string, sql: string, params: unknown[] = []) => (await asUser<{ r: T }>(db, uid, '/rpc', sql, params)).rows[0].r
const fails = async (p: Promise<unknown>) => { try { await p } catch (e) { return (e as Error).message } return 'OK' }

describe('tổ chức demo (008600)', () => {
  let db: PGlite
  beforeAll(async () => { db = await createDb({ withMigrations: true, runMigrationsTwice: true, seed }) }, 240_000)

  it('chỉ admin tạo được; khách chưa có tài khoản → báo lỗi', async () => {
    expect(await fails(rpc(db, USER, `select public.admin_create_demo_org('{}'::jsonb) as r`))).toContain('FORBIDDEN')
    expect(await fails(rpc(db, ADM, `select public.admin_create_demo_org('{"guest_email":"chua-co@x.vn"}'::jsonb) as r`))).toContain('OWNER_NOT_FOUND')
  })

  it('tạo demo trường học: đơn vị 2 cấp, chiến dịch đang chạy, bảng tin; khách là quản trị viên, xem được bảng xếp hạng', async () => {
    const r = await rpc<{ id: string; invite_code: string; campaign_id: string }>(db, ADM,
      `select public.admin_create_demo_org('{"kind":"SCHOOL","guest_email":"Khach@congty.vn","days":7}'::jsonb) as r`)
    const org = (await db.query<{ name: string; unit_label: string; active_until: string }>(`select name, unit_label, active_until from public.organizations where id = $1`, [r.id])).rows[0]
    expect(org).toMatchObject({ name: '[DEMO] Trường THPT Mẫu', unit_label: 'Lớp' })
    expect(new Date(org.active_until).getTime() - Date.now()).toBeGreaterThan(6 * 86400_000)
    const units = (await db.query<{ name: string; parent: string | null }>(`
      select u.name, p.name as parent from public.org_units u left join public.org_units p on p.id = u.parent_id where u.org_id = $1 order by u.name`, [r.id])).rows
    expect(units).toContainEqual({ name: '10A1', parent: 'Khối 10' })
    expect((await db.query(`select 1 from public.org_members where org_id = $1 and user_id = $2 and role = 'ADMIN'`, [r.id, GUEST])).rows).toHaveLength(1)
    expect((await db.query(`select 1 from public.org_posts where org_id = $1 and is_pinned`, [r.id])).rows).toHaveLength(1)
    expect(await fails(rpc(db, GUEST, `select public.org_campaign_board($1) as r`, [r.campaign_id]))).toBe('OK')
    expect(await fails(rpc(db, GUEST, `select public.org_detail($1) as r`, [r.id]))).toBe('OK')
  })

  it('xoá demo: chỉ tổ chức [DEMO], chỉ admin; ghi nhật ký', async () => {
    const r = await rpc<{ id: string }>(db, ADM, `select public.admin_create_demo_org('{"kind":"COMPANY","name":"ABC"}'::jsonb) as r`)
    expect(await fails(rpc(db, USER, `select public.admin_delete_demo_org($1) as r`, [r.id]))).toContain('FORBIDDEN')
    const real = await rpc<{ id: string }>(db, ADM, `select public.admin_create_org('{"name":"Thật","owner_email":"u@demo.vn"}'::jsonb) as r`)
    expect(await fails(rpc(db, ADM, `select public.admin_delete_demo_org($1) as r`, [real.id]))).toContain('NOT_DEMO')
    await rpc(db, ADM, `select public.admin_delete_demo_org($1) as r`, [r.id])
    expect((await db.query(`select 1 from public.organizations where id = $1`, [r.id])).rows).toHaveLength(0)
    expect((await db.query(`select 1 from public.admin_audit_log where action = 'ORG_DEMO_DELETE'`)).rows).toHaveLength(1)
  })
})
