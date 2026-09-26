-- 007200: Khôi phục hàm gán gói CLB Pro về bản chuẩn.
-- Sự cố (09/2026): gán Pro cho NO BEER NO RUN báo "Chỉ quản trị viên hệ thống…" dù admin đúng quyền. Chạy thử trên
-- production cho thấy public.admin_set_club_plan ở đó KHÔNG phải bản trong mã nguồn (gọi private.require_admin() ngay
-- ở phần khai báo — không migration nào có bản này, có thể do sửa tay trong SQL Editor). Migration này:
--   1. Viết lại is_system_admin / require_admin đúng bản chuẩn (000300).
--   2. Xoá hẳn admin_set_club_plan đang có rồi tạo lại bản chuẩn (002800), phòng khi bản lạ khác kiểu trả về.
--   3. Bước báo cho ban quản trị CLB được bọc lỗi: thông báo hỏng không bao giờ làm hỏng việc gán gói.
-- Chạy được trong SQL Editor: không DO $$, không SELECT INTO, không LIMIT. Chạy lại nhiều lần vẫn an toàn.

create or replace function public.is_system_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles
                  where id = auth.uid() and (role = 'SYSTEM_ADMIN' or is_admin is true))
$$;

create or replace function private.require_admin() returns uuid
language plpgsql stable security definer set search_path = public as $$
begin
  perform private.require_uid();
  if not public.is_system_admin() then raise exception 'FORBIDDEN'; end if;
  return auth.uid();
end $$;

drop function if exists public.admin_set_club_plan(uuid, text, timestamptz, text);

create function public.admin_set_club_plan(p_club_id uuid, p_plan text, p_until timestamptz, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  v_plan text := upper(coalesce(p_plan, ''));
  c public.clubs := (select x from public.clubs x where x.id = p_club_id);
begin
  if not public.is_system_admin() then raise exception 'FORBIDDEN'; end if;
  if c.id is null then raise exception 'CLUB_NOT_FOUND'; end if;
  if v_plan not in ('FREE', 'PRO') then raise exception 'INVALID_PLAN'; end if;
  if length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'REASON_REQUIRED'; end if;
  update public.clubs set plan = v_plan, pro_until = case when v_plan = 'PRO' then p_until end where id = c.id;
  insert into public.admin_audit_log (actor_id, action, target, new_value)
  values (v_uid, 'SET_CLUB_PLAN', c.id::text, jsonb_build_object('plan', v_plan, 'until', p_until, 'reason', trim(p_reason), 'old_plan', c.plan));
  begin
    perform private.notify_club(c.id, true, 'CLUB_PRO',
      case when v_plan = 'PRO' then c.name || ' đã lên gói CLB Pro' else c.name || ' trở về gói miễn phí' end,
      case when v_plan = 'PRO' then 'Mở khóa: không giới hạn quản trị viên, link mời riêng, báo cáo chuyên cần.'
           else 'Các tính năng Pro tạm khóa. Dữ liệu vẫn được giữ nguyên.' end,
      '/clubs/' || c.id || '/settings', v_uid);
  exception when others then
    perform private.log_notify_error('club_plan', 'CLUB_PRO', v_uid, sqlstate, sqlerrm);
  end;
  return jsonb_build_object('plan', v_plan, 'pro_until', case when v_plan = 'PRO' then p_until end);
end $$;

revoke all on function public.admin_set_club_plan(uuid, text, timestamptz, text) from public, anon;
grant execute on function public.admin_set_club_plan(uuid, text, timestamptz, text) to authenticated;

notify pgrst, 'reload schema';
