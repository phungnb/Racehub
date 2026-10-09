-- Danh sách tài khoản đang khóa cho admin (thẻ "N tài khoản đang khóa" ở Tổng quan bấm được).
-- Khớp cách đếm của admin_inbox: profiles.banned_at is not null.
-- Phân loại: SELF_DELETED = người dùng tự xóa (banned_reason = 'ACCOUNT_DELETED'), ADMIN = admin khóa tay.
create or replace function public.admin_banned_users() returns jsonb
language plpgsql stable security definer set search_path = public, auth as $$
begin
  perform private.require_admin();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', pr.id, 'name', pr.display_name, 'avatar_url', pr.avatar_url, 'email', u.email,
      'banned_at', pr.banned_at, 'reason', pr.banned_reason,
      'kind', case when pr.banned_reason = 'ACCOUNT_DELETED' then 'SELF_DELETED' else 'ADMIN' end,
      'banned_by', (select private.display_name(l.actor_id) from public.admin_audit_log l
                     where l.action = 'USER_BAN' and l.target in ('user:' || pr.id, pr.id::text)
                     order by l.created_at desc limit 1)
    ) order by pr.banned_at desc)
    from public.profiles pr left join auth.users u on u.id = pr.id
    where pr.banned_at is not null), '[]'::jsonb);
end $$;

revoke all on function public.admin_banned_users() from public, anon;
grant execute on function public.admin_banned_users() to authenticated;
notify pgrst, 'reload schema';
