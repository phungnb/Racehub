import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createDb, asUser } from './load-schema'

// Migration 010100 + kiểm tra toàn cục sau nghiệm thu: RLS, SECURITY DEFINER, quyền ghi của khách
describe('bảo mật toàn cục (010100)', () => {
  let db: PGlite
  beforeAll(async () => { db = await createDb({ withMigrations: true, runMigrationsTwice: true }) }, 240_000)
  const rows = async (sql: string) => (await db.query<{ x: string }>(sql)).rows.map((r) => r.x)

  it('mọi bảng public đều bật RLS', async () => {
    expect(await rows(`select c.relname x from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity`)).toEqual([])
  })

  it('mọi hàm SECURITY DEFINER cố định search_path', async () => {
    expect(await rows(`select n.nspname || '.' || p.proname x from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('public', 'private') and p.prosecdef
        and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')`)).toEqual([])
  })

  it('khách chưa đăng nhập không có quyền ghi bảng nào; ví / sổ cái / nhật ký không ai ghi trực tiếp', async () => {
    expect(await rows(`select c.relname x from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'
        and (has_table_privilege('anon', c.oid, 'insert') or has_table_privilege('anon', c.oid, 'update') or has_table_privilege('anon', c.oid, 'delete'))`)).toEqual([])
    expect(await rows(`select c.relname x from pg_class c where c.oid in ('public.ledger_entries'::regclass, 'public.ledger_transactions'::regclass, 'public.admin_audit_log'::regclass)
        and (has_table_privilege('authenticated', c.oid, 'insert') or has_table_privilege('authenticated', c.oid, 'update') or has_table_privilege('authenticated', c.oid, 'delete'))`)).toEqual([])
    expect(await rows(`select a.attname x from pg_attribute a where a.attrelid = 'public.profiles'::regclass and a.attnum > 0 and not a.attisdropped
        and has_column_privilege('authenticated', a.attrelid, a.attnum, 'update') order by 1`)).toEqual(['avatar_url', 'display_name', 'gift_wall_public', 'updated_at'])
  })

  it('yêu cầu báo giá: đổi số điện thoại cũng không gửi quá 20 yêu cầu / giờ khi chưa đăng nhập', async () => {
    const send = (i: number) => asUser(db, null, '/rpc', `select public.request_enterprise_quote($1::jsonb)`,
      [JSON.stringify({ contact_name: 'Spam', org_name: 'Công ty ' + i, phone: '0900' + String(100000 + i) })])
    for (let i = 0; i < 20; i++) await send(i)
    await expect(send(99)).rejects.toThrow('RATE_LIMITED')
  })
})
