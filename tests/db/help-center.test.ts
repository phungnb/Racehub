import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createDb, asUser } from './load-schema'

// Migration 007300: menu Hướng dẫn & Chính sách — khách đọc được, chỉ admin sửa, chạy lại không ghi đè bản admin
const ADM = '00000000-0000-0000-0000-0000000073a1'
const USR = '00000000-0000-0000-0000-0000000073a2'
type Row = Record<string, any>

async function seed(db: PGlite) {
  await db.exec(`
    insert into auth.users (id, email) values ('${ADM}', 'a73@x.vn'), ('${USR}', 'u73@x.vn');
    insert into public.profiles (id, display_name, xu, xp, level, created_at) values ('${ADM}', 'Admin', 0, 0, 1, now()), ('${USR}', 'Runner', 0, 0, 1, now())
      on conflict do nothing;
  `)
}
const rpc = async <T = Row>(db: PGlite, uid: string | null, sql: string, params: unknown[] = []) =>
  (await asUser<{ r: T }>(db, uid, '/rpc', sql, params)).rows[0]?.r
const fails = async (p: Promise<unknown>) => { try { await p } catch (e) { return (e as Error).message } return 'OK' }

describe('Hướng dẫn & Chính sách (007300)', () => {
  let db: PGlite
  beforeAll(async () => {
    db = await createDb({ withMigrations: true, runMigrationsTwice: true, seed })
    await db.query(`update public.profiles set role = 'SYSTEM_ADMIN' where id = $1`, [ADM])
  }, 240_000)

  it('khách chưa đăng nhập đọc được menu + trang; nội dung mẫu đủ 3 nhóm', async () => {
    const menu = await rpc<Row>(db, null, `select public.help_menu() as r`)
    const sections = new Set(menu.pages.map((p: Row) => p.section))
    expect([...sections].sort()).toEqual(['GUIDE', 'POLICY', 'SUPPORT'])
    expect(menu.pages.map((p: Row) => p.slug)).toEqual(expect.arrayContaining(['bat-dau', 'quy-tac-cong-dong', 'quy-dinh-xu-qua', 'du-lieu-cua-toi']))
    const page = await rpc<Row>(db, null, `select public.help_page('quy-dinh-xu-qua') as r`)
    expect(page.body).toContain('không quy đổi')
    expect(page.needs_review).toBe(true)
    expect(await fails(rpc(db, null, `select public.help_page('khong-co') as r`))).toContain('PAGE_NOT_FOUND')
  })

  it('người thường không sửa được; admin sửa / ẩn / xoá, có nhật ký; trang ẩn chỉ admin xem', async () => {
    const page = { slug: 'bat-dau', section: 'GUIDE', title: 'Bắt đầu (admin sửa)', body: 'Nội dung mới', version: '1.1', is_published: false }
    expect(await fails(rpc(db, USR, `select public.admin_help_save($1::jsonb) as r`, [JSON.stringify(page)]))).toContain('FORBIDDEN')
    expect(await rpc(db, ADM, `select public.admin_help_save($1::jsonb) as r`, [JSON.stringify(page)])).toBe('bat-dau')
    expect(await fails(rpc(db, USR, `select public.help_page('bat-dau') as r`))).toContain('PAGE_NOT_FOUND')
    expect((await rpc<Row>(db, ADM, `select public.help_page('bat-dau') as r`)).title).toBe('Bắt đầu (admin sửa)')
    expect((await rpc<Row>(db, null, `select public.help_menu() as r`)).pages.map((p: Row) => p.slug)).not.toContain('bat-dau')
    expect(await fails(rpc(db, ADM, `select public.admin_help_save($1::jsonb) as r`, [JSON.stringify({ ...page, slug: 'Sai Slug!' })]))).toContain('INVALID_SLUG')

    await rpc(db, ADM, `select public.admin_help_save($1::jsonb) as r`, [JSON.stringify({ slug: 'trang-moi', section: 'SUPPORT', title: 'Trang mới', body: 'x' })])
    await rpc(db, ADM, `select public.admin_help_delete('trang-moi')`)
    const log = (await db.query<Row>(`select action from public.admin_audit_log where action like 'HELP_PAGE_%' order by id`)).rows.map((r) => r.action)
    expect(log).toEqual(['HELP_PAGE_SAVE', 'HELP_PAGE_SAVE', 'HELP_PAGE_DELETE'])
  })

  it('chạy lại migration không ghi đè trang admin đã sửa', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const { sanitize } = await import('./load-schema')
    await db.exec(sanitize(fs.readFileSync(path.join(__dirname, '../../supabase/migrations/20261001007300_help_center.sql'), 'utf8')))
    expect((await rpc<Row>(db, ADM, `select public.help_page('bat-dau') as r`)).title).toBe('Bắt đầu (admin sửa)')
  })

  it('thông tin pháp nhân: chỉ nhận khoá hợp lệ, hiện cho khách', async () => {
    expect(await fails(rpc(db, USR, `select public.admin_site_info_save($1::jsonb) as r`, [JSON.stringify({ company_name: 'X' })]))).toContain('FORBIDDEN')
    const saved = await rpc<Row>(db, ADM, `select public.admin_site_info_save($1::jsonb) as r`,
      [JSON.stringify({ company_name: ' Công ty RaceHub ', tax_code: '0123456789', hack: 'bị bỏ', support_phone: '  ' })])
    expect(saved).toEqual({ company_name: 'Công ty RaceHub', tax_code: '0123456789' })
    expect((await rpc<Row>(db, null, `select public.help_menu() as r`)).site).toEqual(saved)
  })
})
