-- 011400: DANH SÁCH QUẢN TRỊ VIÊN HỆ THỐNG
--   Quản trị → Người dùng hiện "Quản trị viên hiện tại" (tên, email, lần đăng nhập gần nhất, ngày được cấp quyền) để biết ai đang
--   có toàn quyền. Cấp thêm / gỡ quyền: mở hồ sơ người dùng → "Cấp quyền admin" / "Gỡ quyền admin" (đã có, ghi nhật ký).
-- Chạy được trong SQL Editor: không DO $$, không SELECT INTO, không LIMIT, không RETURNING INTO. Chạy lại an toàn.

create or replace function public.admin_list_admins() returns jsonb
language plpgsql stable security definer set search_path = public, auth as $$
begin
  perform private.require_admin();
  return (select coalesce(jsonb_agg(jsonb_build_object(
            'id', p.id, 'display_name', p.display_name, 'avatar_url', p.avatar_url,
            'email', u.email, 'last_sign_in_at', u.last_sign_in_at, 'is_me', p.id = auth.uid(),
            'granted_at', (select max(l.created_at) from public.admin_audit_log l
                            where l.action = 'USER_ROLE' and l.target = 'user:' || p.id and l.new_value->>'role' = 'SYSTEM_ADMIN'))
          order by p.display_name), '[]'::jsonb)
    from public.profiles p left join auth.users u on u.id = p.id
   where p.role = 'SYSTEM_ADMIN' or p.is_admin is true);
end $$;

revoke all on function public.admin_list_admins() from public, anon;
grant execute on function public.admin_list_admins() to authenticated;
