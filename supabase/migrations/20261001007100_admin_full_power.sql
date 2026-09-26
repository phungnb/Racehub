-- 007100: Admin hệ thống TOÀN QUYỀN trong mọi CLB (luật sản phẩm: "admin là full-power").
-- Trước đây quyền ban quản trị CLB (club_is_staff) chỉ tính chủ nhiệm / đội trưởng của CHÍNH CLB đó → admin hệ thống
-- không duyệt thành viên, sửa cài đặt, đăng tin, xoá bài, quản lý sự kiện / quỹ / thử thách… ở CLB mình không tham gia.
-- Nay: admin hệ thống được coi là ban quản trị + thành viên của mọi CLB (mọi thao tác vẫn ghi nhật ký như cũ).
-- "CLB của tôi" trên bảng xếp hạng CLB vẫn tính theo thành viên thật (007000). Chạy lại nhiều lần vẫn an toàn.

create or replace function public.club_is_staff(p_club uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_system_admin()
      or exists (select 1 from public.club_members
                  where club_id = p_club and user_id = auth.uid() and status = 'APPROVED'
                    and role in ('OWNER', 'CAPTAIN'))
$$;

create or replace function public.club_is_member(p_club uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_system_admin()
      or exists (select 1 from public.club_members
                  where club_id = p_club and user_id = auth.uid() and status = 'APPROVED')
$$;

-- Thử thách cá nhân (không thuộc CLB): admin cũng quản lý / huỷ được
create or replace function private.challenge_is_manager(c public.challenges) returns boolean
language sql stable security definer set search_path = public as $$
  select c.created_by = auth.uid() or public.is_system_admin()
      or (c.target_club_id is not null and public.club_is_staff(c.target_club_id))
$$;

create or replace function public.cancel_challenge(p_challenge_id uuid, p_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := private.require_uid(); c public.challenges%rowtype; r record;
begin
  c := (select x from public.challenges x where x.id = p_challenge_id for update);
  if c.id is null then raise exception 'CHALLENGE_NOT_FOUND'; end if;
  if c.created_by is distinct from v_uid and not public.is_system_admin()
     and not (c.target_club_id is not null and public.club_is_staff(c.target_club_id)) then
    raise exception 'FORBIDDEN';
  end if;
  if c.status <> 'ACTIVE' then raise exception 'CHALLENGE_CLOSED'; end if;
  if now() >= c.start_date and exists (select 1 from public.challenge_participants
       where challenge_id = c.id and profile_id <> c.created_by) then
    raise exception 'CANNOT_CANCEL_STARTED';
  end if;
  update public.challenges set status = 'CANCELLED', cancelled_reason = left(p_reason, 300), settled_at = now() where id = c.id;
  perform private.challenge_refund_escrow(c);
  for r in select profile_id from public.challenge_participants where challenge_id = c.id loop
    perform private.notify(r.profile_id, c.target_club_id, 'CHALLENGE_CANCELLED', 'Thử thách đã bị hủy: ' || c.title,
      p_reason, '/challenges/' || c.id, v_uid, true);
  end loop;
end $$;

-- Hàm vai trò gốc (schema production) dùng cho duyệt / xoá / đổi vai trò thành viên, sửa CLB, đổi mã mời, thông báo CLB…:
-- admin hệ thống được tính là Chủ nhiệm ở mọi CLB.
create or replace function public.club_role(p_club uuid, p_user uuid default auth.uid()) returns text
language sql stable security definer set search_path = public as $$
  select case
    when exists (select 1 from public.profiles p where p.id = p_user and (p.role = 'SYSTEM_ADMIN' or p.is_admin is true)) then 'OWNER'
    else (select (array_agg(m.role))[1] from public.club_members m
           where m.club_id = p_club and m.user_id = p_user and m.status = 'APPROVED') end
$$;

-- Giải tán CLB: chủ nhiệm hoặc admin hệ thống (gõ đúng tên CLB); admin xoá CLB của người khác → ghi nhật ký quản trị
create or replace function public.delete_club(p_club_id uuid, p_confirm_name text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  c public.clubs := (select x from public.clubs x where x.id = p_club_id);
  v_owner boolean;
begin
  if c.id is null then raise exception 'CLUB_NOT_FOUND'; end if;
  v_owner := c.owner_id = v_uid or exists (select 1 from public.club_members m
               where m.club_id = p_club_id and m.user_id = v_uid and m.role = 'OWNER' and m.status = 'APPROVED');
  if not v_owner and not public.is_system_admin() then raise exception 'NOT_AUTHORIZED'; end if;
  if trim(lower(coalesce(p_confirm_name, ''))) <> trim(lower(c.name)) then raise exception 'WRONG_NAME'; end if;
  if not v_owner then
    insert into public.admin_audit_log (actor_id, action, target, new_value)
    values (v_uid, 'CLUB_DELETE', 'club:' || c.id, jsonb_build_object('name', c.name, 'owner_id', c.owner_id, 'members', c.member_count));
  end if;
  delete from public.clubs where id = p_club_id;
end $$;

-- Trao quyền Chủ nhiệm: chủ nhiệm hoặc admin hệ thống
create or replace function public.transfer_club_ownership(p_club_id uuid, p_new_owner_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  v_club text := (select c.name from public.clubs c where c.id = p_club_id);
begin
  if v_club is null then raise exception 'CLUB_NOT_FOUND'; end if;
  if p_new_owner_id is null or p_new_owner_id = v_uid then raise exception 'CANNOT_TRANSFER_TO_SELF'; end if;
  if not public.is_system_admin()
     and not exists (select 1 from public.club_members m where m.club_id = p_club_id and m.user_id = v_uid and m.role = 'OWNER' and m.status = 'APPROVED') then
    raise exception 'NOT_AUTHORIZED';
  end if;
  if not exists (select 1 from public.club_members m where m.club_id = p_club_id and m.user_id = p_new_owner_id and m.status = 'APPROVED') then
    raise exception 'TARGET_NOT_MEMBER';
  end if;
  -- Chủ nhiệm hiện tại (có thể không phải người thao tác khi admin trao quyền) → Quản trị viên
  update public.club_members set role = 'CAPTAIN' where club_id = p_club_id and role = 'OWNER' and user_id <> p_new_owner_id;
  update public.club_members set role = 'OWNER' where club_id = p_club_id and user_id = p_new_owner_id;
  update public.clubs set owner_id = p_new_owner_id where id = p_club_id;
  insert into public.admin_audit_log (actor_id, action, target, new_value)
  values (v_uid, 'CLUB_TRANSFER_OWNER', 'club:' || p_club_id, jsonb_build_object('from', v_uid, 'to', p_new_owner_id));
  perform private.notify(p_new_owner_id, p_club_id, 'CLUB_ROLE', 'Bạn là Chủ nhiệm mới của ' || v_club,
    'Quyền Chủ nhiệm CLB đã được trao cho bạn.', '/clubs/' || p_club_id, v_uid, true);
end $$;

notify pgrst, 'reload schema';
