import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createDb } from './load-schema'

// Rà tư thế bảo mật của TOÀN BỘ database sau khi chạy mọi migration — chặn lỗi cấu hình lọt vào bản phát hành:
// bảng thiếu RLS, hàm SECURITY DEFINER thiếu search_path, khách (anon) gọi được hàm đặc quyền ngoài danh sách cho phép,
// schema private bị lộ, bucket lưu trữ không giới hạn dung lượng / loại tệp.

// Hàm SECURITY DEFINER mà khách chưa đăng nhập ĐƯỢC PHÉP gọi (trang công khai, xem trước link mời, kiểm tra mã xác thực…)
const ANON_ALLOWED = [
  'challenge_honor(uuid)', 'club_invite_preview(text)', 'club_public_page(text)', 'club_role(uuid,uuid)',
  'get_active_config(text)', 'get_partner(uuid)', 'has_permission(uuid,uuid,text)', 'help_menu()', 'help_page(text)',
  'is_system_admin()', 'list_partners(text,text,text)', 'ops_policy()', 'plan_compare()', 'referral_preview(text)',
  'request_enterprise_quote(jsonb)', 'resolve_club_slug(text)', 'system_notice()', 'verify_victory(text)',
]

describe('tư thế bảo mật database', () => {
  let db: PGlite
  const q = async <T = Record<string, unknown>>(sql: string) => (await db.query<T>(sql)).rows
  beforeAll(async () => { db = await createDb({ withMigrations: true }) }, 600_000)

  it('mọi bảng trong schema public đều bật RLS', async () => {
    expect(await q(`select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity`)).toEqual([])
  })

  it('mọi hàm SECURITY DEFINER đều cố định search_path (chống chiếm quyền qua schema giả)', async () => {
    expect(await q(`select p.oid::regprocedure::text f from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('public', 'private') and p.prosecdef
        and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')`)).toEqual([])
  })

  it('khách chưa đăng nhập chỉ gọi được các hàm đặc quyền trong danh sách cho phép', async () => {
    const rows = await q<{ f: string }>(`select regexp_replace(p.oid::regprocedure::text, '^public\\.', '') f
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'execute') order by 1`)
    expect(rows.map((r) => r.f).filter((f) => !ANON_ALLOWED.includes(f))).toEqual([])
  })

  it('schema private không cho anon / authenticated dùng; hàm đặc quyền trong private không gọi trực tiếp được', async () => {
    expect(await q(`select has_schema_privilege('anon', 'private', 'usage') a, has_schema_privilege('authenticated', 'private', 'usage') b`))
      .toEqual([{ a: false, b: false }])
    expect(await q(`select p.oid::regprocedure::text f from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'private' and p.prosecdef and p.prorettype <> 'trigger'::regtype  -- hàm trigger không gọi trực tiếp được
        and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))`)).toEqual([])
  })

  it('khách không ghi được bảng nào; không bảng nào có policy cho khách ghi', async () => {
    expect(await q(`select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'
        and (has_table_privilege('anon', c.oid, 'insert') or has_table_privilege('anon', c.oid, 'update') or has_table_privilege('anon', c.oid, 'delete'))`)).toEqual([])
  })

  it('cột nhạy cảm của profiles (Xu, quyền, token Strava, khóa tài khoản) không ai đọc / sửa trực tiếp được', async () => {
    const cols = ['xu', 'xp', 'role', 'is_admin', 'strava_access_token', 'strava_refresh_token', 'referral_code', 'banned_at', 'deleted_at']
    const rows = await q<{ c: string }>(`select a.attname c from pg_attribute a
      where a.attrelid = 'public.profiles'::regclass and a.attnum > 0 and not a.attisdropped
        and a.attname in (${cols.map((c) => `'${c}'`).join(',')})
        and (has_column_privilege('anon', a.attrelid, a.attname, 'select') or has_column_privilege('authenticated', a.attrelid, a.attname, 'select')
          or has_column_privilege('authenticated', a.attrelid, a.attname, 'update'))`)
    expect(rows).toEqual([])
  })

  it('bản đồ (tọa độ GPS) mặc định riêng tư', async () => {
    const src = (await q<{ s: string }>(`select prosrc s from pg_proc where proname = 'can_view_map'`))[0].s
    expect(src).toMatch(/'PRIVATE'\)/)
  })

  it('mọi bucket lưu trữ đều giới hạn dung lượng và loại tệp', async () => {
    expect(await q(`select id from storage.buckets where file_size_limit is null or file_size_limit > 10485760
      or allowed_mime_types is null or cardinality(allowed_mime_types) = 0`)).toEqual([])
  })
})
