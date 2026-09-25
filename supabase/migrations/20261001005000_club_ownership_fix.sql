-- 005000: Sửa lỗi trao quyền Chủ nhiệm / Chủ nhiệm rời CLB.
-- Lỗi gốc (hàm cũ trên production): chủ nhiệm cũ bị đổi sang vai trò 'VICE' — vai trò không tồn tại
-- (club_members chỉ nhận OWNER / CAPTAIN / MEMBER) → vi phạm CHECK → "Không thực hiện được".
-- Rời CLB khi là chủ nhiệm: tự chọn người kế nhiệm theo 'VICE' → không bao giờ tìm được.
-- Bản mới: chủ nhiệm cũ thành Quản trị viên (CAPTAIN); người nhận phải là thành viên đã duyệt;
-- cập nhật clubs.owner_id; ghi nhật ký; báo cho chủ nhiệm mới.
-- Chạy lại nhiều lần vẫn an toàn. Không dùng SELECT … INTO, khối DO, LIMIT (SQL Editor).

create or replace function public.transfer_club_ownership(p_club_id uuid, p_new_owner_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  v_club text := (select c.name from public.clubs c where c.id = p_club_id);
begin
  if v_club is null then raise exception 'CLUB_NOT_FOUND'; end if;
  if p_new_owner_id is null or p_new_owner_id = v_uid then raise exception 'CANNOT_TRANSFER_TO_SELF'; end if;
  if not exists (select 1 from public.club_members m where m.club_id = p_club_id and m.user_id = v_uid and m.role = 'OWNER' and m.status = 'APPROVED') then
    raise exception 'NOT_AUTHORIZED';
  end if;
  if not exists (select 1 from public.club_members m where m.club_id = p_club_id and m.user_id = p_new_owner_id and m.status = 'APPROVED') then
    raise exception 'TARGET_NOT_MEMBER';
  end if;
  update public.club_members set role = 'CAPTAIN' where club_id = p_club_id and user_id = v_uid;
  update public.club_members set role = 'OWNER' where club_id = p_club_id and user_id = p_new_owner_id;
  update public.clubs set owner_id = p_new_owner_id where id = p_club_id;
  insert into public.admin_audit_log (actor_id, action, target, new_value)
  values (v_uid, 'CLUB_TRANSFER_OWNER', 'club:' || p_club_id, jsonb_build_object('from', v_uid, 'to', p_new_owner_id));
  perform private.notify(p_new_owner_id, p_club_id, 'CLUB_ROLE', 'Bạn là Chủ nhiệm mới của ' || v_club,
    'Quyền Chủ nhiệm CLB đã được trao cho bạn.', '/clubs/' || p_club_id, v_uid, true);
end $$;

create or replace function public.leave_club(p_club_id uuid, p_new_owner_id uuid default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  v_role text := (select m.role from public.club_members m where m.club_id = p_club_id and m.user_id = v_uid);
  v_next uuid;
begin
  if v_role is null then raise exception 'NOT_A_MEMBER'; end if;
  if v_role <> 'OWNER' then
    delete from public.club_members where club_id = p_club_id and user_id = v_uid;
    return;
  end if;
  if not exists (select 1 from public.club_members m where m.club_id = p_club_id and m.user_id <> v_uid and m.status = 'APPROVED') then
    raise exception 'LAST_MEMBER_MUST_DELETE';
  end if;
  if p_new_owner_id is not null then
    if p_new_owner_id = v_uid then raise exception 'CANNOT_TRANSFER_TO_SELF'; end if;
    if not exists (select 1 from public.club_members m where m.club_id = p_club_id and m.user_id = p_new_owner_id and m.status = 'APPROVED') then
      raise exception 'TARGET_NOT_MEMBER';
    end if;
    v_next := p_new_owner_id;
  else
    -- tự chọn Quản trị viên vào CLB sớm nhất
    v_next := (select x.user_id from (
      select m.user_id, row_number() over (order by m.joined_at, m.user_id) as rn
        from public.club_members m
       where m.club_id = p_club_id and m.user_id <> v_uid and m.status = 'APPROVED' and m.role = 'CAPTAIN') x where x.rn = 1);
    if v_next is null then raise exception 'MUST_ASSIGN_NEW_OWNER'; end if;
  end if;
  -- mỗi CLB chỉ một Chủ nhiệm (club_members_single_owner): rời trước, nâng người kế nhiệm sau
  delete from public.club_members where club_id = p_club_id and user_id = v_uid;
  update public.club_members set role = 'OWNER' where club_id = p_club_id and user_id = v_next;
  update public.clubs set owner_id = v_next where id = p_club_id;
  perform private.notify(v_next, p_club_id, 'CLUB_ROLE', 'Bạn là Chủ nhiệm mới',
    'Chủ nhiệm cũ đã rời CLB và trao quyền cho bạn.', '/clubs/' || p_club_id, v_uid, true);
end $$;

revoke all on function public.transfer_club_ownership(uuid, uuid), public.leave_club(uuid, uuid) from public, anon;
grant execute on function public.transfer_club_ownership(uuid, uuid), public.leave_club(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
