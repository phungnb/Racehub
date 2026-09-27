-- 009000: "Lỗi người dùng gặp" — admin đánh dấu ĐÃ XỬ LÝ (sau khi đã sửa nguyên nhân, vd. chạy migration còn thiếu):
-- xoá khỏi nhật ký lỗi → số đỏ ở Quản trị → Hệ thống và mục Kiểm tra hệ thống sạch ngay, không phải đợi 24 giờ.
-- Nếu lỗi còn xảy ra, lần tiếp theo người dùng gặp sẽ được ghi lại như mới. Mỗi lần xoá ghi nhật ký quản trị (số lần đã gặp).
-- Chạy được trong SQL Editor: không DO $$, không SELECT INTO, không LIMIT, không RETURNING INTO. Chạy lại an toàn.

create or replace function public.admin_resolve_client_error(p_code text default null) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_admin uuid := private.require_admin();
  v_code text := nullif(trim(coalesce(p_code, '')), '');
  v_hits integer := (select coalesce(sum(e.hits), 0)::integer from private.client_errors e where v_code is null or e.code = v_code);
begin
  delete from private.client_error_users where v_code is null or code = v_code;
  delete from private.client_errors where v_code is null or code = v_code;
  insert into public.admin_audit_log (actor_id, action, target, old_value)
  values (v_admin, 'CLIENT_ERROR_RESOLVE', 'error:' || coalesce(v_code, 'ALL'), jsonb_build_object('hits', v_hits));
  return v_hits;
end $$;

revoke all on function public.admin_resolve_client_error(text) from public, anon;
grant execute on function public.admin_resolve_client_error(text) to authenticated;

notify pgrst, 'reload schema';
