-- 013200: Chỉnh sửa lần 7 — quản trị CLB không đổi được ảnh đại diện CLB.
-- Nguyên nhân: update_club (008900) tự dọn file ảnh cũ bằng "delete from storage.objects". Supabase nay CHẶN xoá thẳng bảng
-- storage ("Direct deletion from storage tables is not allowed. Use the Storage API instead.") → cả giao dịch đổi ảnh bị huỷ,
-- ảnh mới đã tải lên cũng bị app xoá lại. Lỗi chỉ xảy ra khi CLB đã có ảnh cũ (avatar_path khác null) — đúng lúc "đổi" ảnh.
-- Sửa: bỏ việc xoá file trong SQL; app tự xoá file cũ qua Storage API (supabase.storage.remove) sau khi đổi thành công —
-- chính sách club_avatars_staff_delete (008900) vẫn chỉ cho Ban quản trị CLB xoá file trong thư mục của CLB mình.
-- Giữ nguyên chữ ký, kiểu trả về, kiểm tra quyền (chủ / đội trưởng / admin hệ thống) và quyền gọi của update_club.
-- Cần 008900. Chạy được trong SQL Editor: không DO $$, không SELECT INTO, không LIMIT, không RETURNING INTO. Chạy lại an toàn.

create or replace function public.update_club(p_club_id uuid, p_name text default null, p_description text default null,
                                              p_avatar_url text default null, p_avatar_path text default null) returns public.clubs
language plpgsql security definer set search_path = public as $$
declare
  v_club public.clubs;
begin
  if coalesce(public.club_role(p_club_id), '') not in ('OWNER', 'CAPTAIN') then raise exception 'FORBIDDEN'; end if;
  if p_name is not null then
    if trim(p_name) = '' then raise exception 'NAME_REQUIRED'; end if;
    if char_length(trim(p_name)) > 60 then raise exception 'NAME_TOO_LONG'; end if;
  end if;
  if p_description is not null and char_length(p_description) > 300 then raise exception 'DESC_TOO_LONG'; end if;
  begin
    update public.clubs
       set name        = coalesce(nullif(trim(coalesce(p_name, '')), ''), name),
           description = case when p_description is null then description else nullif(trim(p_description), '') end,
           avatar_url  = case when p_avatar_url is null then avatar_url else nullif(trim(p_avatar_url), '') end,
           avatar_path = case when p_avatar_url is null then avatar_path else nullif(trim(coalesce(p_avatar_path, '')), '') end
     where id = p_club_id;
  exception when unique_violation then
    raise exception 'NAME_TAKEN';
  end;
  v_club := (select c from public.clubs c where c.id = p_club_id);
  if v_club.id is null then raise exception 'CLUB_NOT_FOUND'; end if;
  -- 013200: KHÔNG xoá file ảnh cũ ở đây (Supabase cấm xoá thẳng bảng kho ảnh) — app xoá qua Storage API
  return v_club;
end $$;

revoke execute on function public.update_club(uuid, text, text, text, text) from public, anon;
grant execute on function public.update_club(uuid, text, text, text, text) to authenticated;
