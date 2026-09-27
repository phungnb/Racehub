-- 008900: VÁ BẢO MẬT + nguyên tắc "chỉ chủ nhiệm và người được phân quyền mới sửa CLB" — các hàm quản lý CLB đời đầu (có sẵn trên production trước khi dùng migration) kiểm tra quyền kiểu
--   if public.club_role(club) not in ('OWNER','CAPTAIN') then raise ...
-- club_role() trả về NULL khi người gọi KHÔNG thuộc CLB (hoặc chưa đăng nhập) → "NULL not in (...)" = NULL → KHÔNG báo lỗi →
-- bất kỳ ai (kể cả chưa đăng nhập) đổi được tên / mô tả / ảnh / thông báo / chính sách tham gia của mọi CLB, đổi mã mời,
-- đổi vai trò / duyệt / cấm thành viên, chuyển quyền chủ CLB (tự tham gia CLB mở rồi chuyển chủ cho mình).
-- Sửa: so sánh với coalesce(club_role(...), '') (không phải thành viên = không có quyền); giữ nguyên chữ ký + kiểu trả về
-- + hành vi với chủ / đội trưởng / admin hệ thống. Thu hồi quyền gọi của khách chưa đăng nhập (anon) với các hàm ghi.
-- Không đổi club_role (chính sách club_treasury_select dùng "is not null"). Chạy được trong SQL Editor: không DO $$,
-- không SELECT INTO, không LIMIT, không RETURNING INTO. Chạy lại an toàn.

create or replace function public.rotate_invite_code(p_club_id uuid) returns text
language plpgsql security definer set search_path = public as $$
declare v_code text;
begin
  if coalesce(public.club_role(p_club_id), '') not in ('OWNER', 'CAPTAIN') then raise exception 'FORBIDDEN'; end if;
  loop
    v_code := encode(extensions.gen_random_bytes(6), 'hex');
    exit when not exists (select 1 from public.clubs where invite_code = v_code);
  end loop;
  update public.clubs set invite_code = v_code where id = p_club_id;
  return v_code;
end $$;

create or replace function public.set_club_announcement(p_club_id uuid, p_text text) returns public.clubs
language plpgsql security definer set search_path = public as $$
declare v_text text := nullif(trim(coalesce(p_text, '')), '');
begin
  if coalesce(public.club_role(p_club_id), '') not in ('OWNER', 'CAPTAIN') then raise exception 'FORBIDDEN'; end if;
  if char_length(coalesce(p_text, '')) > 500 then raise exception 'ANNOUNCEMENT_TOO_LONG'; end if;
  update public.clubs
     set announcement = v_text,
         announced_at = case when v_text is null then null else now() end,
         announced_by = case when v_text is null then null else auth.uid() end
   where id = p_club_id;
  return (select c from public.clubs c where c.id = p_club_id);
end $$;

create or replace function public.update_club(p_club_id uuid, p_name text default null, p_description text default null,
                                              p_avatar_url text default null, p_avatar_path text default null) returns public.clubs
language plpgsql security definer set search_path = public as $$
declare
  v_old_path text;
  v_club public.clubs;
begin
  if coalesce(public.club_role(p_club_id), '') not in ('OWNER', 'CAPTAIN') then raise exception 'FORBIDDEN'; end if;
  v_old_path := (select c.avatar_path from public.clubs c where c.id = p_club_id);
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
  -- Dọn file ảnh cũ để storage không phình
  if p_avatar_url is not null and v_old_path is not null and v_old_path is distinct from v_club.avatar_path then
    delete from storage.objects where bucket_id = 'club-avatars' and name = v_old_path;
  end if;
  return v_club;
end $$;

create or replace function public.update_club_policy(p_club_id uuid, p_join_policy text default null, p_member_limit integer default null)
returns public.clubs
language plpgsql security definer set search_path = public as $$
declare v_club public.clubs;
begin
  if coalesce(public.club_role(p_club_id), '') <> 'OWNER' then raise exception 'FORBIDDEN'; end if;
  if p_join_policy is not null and p_join_policy not in ('OPEN', 'APPROVAL', 'INVITE_ONLY') then raise exception 'INVALID_POLICY'; end if;
  if p_member_limit is not null then
    if p_member_limit < 2 or p_member_limit > 1000 then raise exception 'INVALID_LIMIT'; end if;
    if p_member_limit < (select c.member_count from public.clubs c where c.id = p_club_id) then raise exception 'LIMIT_BELOW_CURRENT'; end if;
  end if;
  update public.clubs
     set join_policy = coalesce(p_join_policy, join_policy), member_limit = coalesce(p_member_limit, member_limit)
   where id = p_club_id;
  v_club := (select c from public.clubs c where c.id = p_club_id);
  -- Chuyển sang OPEN thì duyệt luôn hàng chờ, trong giới hạn còn trống
  if p_join_policy = 'OPEN' then
    update public.club_members m set status = 'APPROVED', joined_at = now()
     where m.id in (select x.id from (
             select pm.id, row_number() over (order by pm.joined_at) as rn
               from public.club_members pm where pm.club_id = p_club_id and pm.status = 'PENDING') x
             where x.rn <= greatest(v_club.member_limit - v_club.member_count, 0));
    v_club := (select c from public.clubs c where c.id = p_club_id);
  end if;
  return v_club;
end $$;

create or replace function public.set_member_role(p_member_id uuid, p_role text) returns public.club_members
language plpgsql security definer set search_path = public as $$
declare v_row public.club_members := (select m from public.club_members m where m.id = p_member_id);
begin
  if p_role not in ('CAPTAIN', 'MEMBER') then raise exception 'INVALID_ROLE'; end if;
  if v_row.id is null then raise exception 'MEMBER_NOT_FOUND'; end if;
  if coalesce(public.club_role(v_row.club_id), '') <> 'OWNER' then raise exception 'FORBIDDEN'; end if;
  if v_row.role = 'OWNER' then raise exception 'FORBIDDEN'; end if;
  if v_row.status <> 'APPROVED' then raise exception 'TARGET_NOT_APPROVED'; end if;
  update public.club_members set role = p_role where id = p_member_id;
  return (select m from public.club_members m where m.id = p_member_id);
end $$;

create or replace function public.set_member_status(p_member_id uuid, p_status text) returns public.club_members
language plpgsql security definer set search_path = public as $$
declare
  v_row public.club_members := (select m from public.club_members m where m.id = p_member_id);
  v_me text;
  v_club public.clubs;
begin
  if p_status not in ('APPROVED', 'REJECTED', 'BANNED') then raise exception 'INVALID_STATUS'; end if;
  if v_row.id is null then raise exception 'MEMBER_NOT_FOUND'; end if;
  v_me := coalesce(public.club_role(v_row.club_id), '');
  if v_me not in ('OWNER', 'CAPTAIN') then raise exception 'FORBIDDEN'; end if;
  if v_row.role = 'OWNER' then raise exception 'FORBIDDEN'; end if;
  if public.club_rank(v_me) <= public.club_rank(v_row.role) then raise exception 'FORBIDDEN'; end if;
  if p_status = 'APPROVED' then
    v_club := (select c from public.clubs c where c.id = v_row.club_id);
    if v_club.member_count >= v_club.member_limit then raise exception 'CLUB_FULL'; end if;
  end if;
  update public.club_members
     set status = p_status, joined_at = case when p_status = 'APPROVED' then now() else joined_at end
   where id = p_member_id;
  return (select m from public.club_members m where m.id = p_member_id);
end $$;

create or replace function public.transfer_ownership(p_club_id uuid, p_to_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_target public.club_members := (select m from public.club_members m
                                          where m.club_id = p_club_id and m.user_id = p_to_user and m.status = 'APPROVED');
begin
  if coalesce(public.club_role(p_club_id), '') <> 'OWNER' then raise exception 'FORBIDDEN'; end if;
  if v_target.id is null then raise exception 'TARGET_NOT_APPROVED'; end if;
  update public.club_members set role = 'CAPTAIN' where club_id = p_club_id and user_id = auth.uid();
  update public.club_members set role = 'OWNER' where id = v_target.id;
  update public.clubs set owner_id = p_to_user where id = p_club_id;
end $$;

create or replace function public.remove_member(p_member_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_row public.club_members := (select m from public.club_members m where m.id = p_member_id);
  v_me text;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if v_row.id is null then return; end if;
  v_me := public.club_role(v_row.club_id);
  if v_row.user_id = auth.uid() then
    if v_row.role = 'OWNER' then raise exception 'OWNER_CANNOT_LEAVE'; end if;
  elsif v_me is null or public.club_rank(v_me) <= public.club_rank(v_row.role) then
    raise exception 'FORBIDDEN';
  end if;
  delete from public.club_members where id = p_member_id;
end $$;

-- Nguyên tắc: trong một CLB chỉ CHỦ NHIỆM (OWNER) và người được chủ nhiệm PHÂN QUYỀN (Ban quản trị — CAPTAIN) được tạo /
-- sửa / xoá nội dung và cài đặt của CLB (admin hệ thống vẫn toàn quyền — 007100). Thành viên chỉ tham gia: bình chọn,
-- đăng ký sự kiện, bình luận, thả tim, nhắn tin, đặt hàng, báo đã nộp phí.
-- Bình chọn: trước đây thành viên nào cũng tạo được → chỉ Ban quản trị.
create or replace function public.create_club_poll(p_club_id uuid, p_question text, p_options text[], p_multi boolean,
                                                   p_closes_at timestamptz, p_hide_results boolean) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := private.require_staff(p_club_id); v_id uuid := gen_random_uuid(); v_opts jsonb; m record;
begin
  if char_length(trim(coalesce(p_question, ''))) not between 3 and 200 then raise exception 'INVALID_QUESTION'; end if;
  v_opts := (select coalesce(jsonb_agg(trim(o) order by i), '[]'::jsonb)
               from unnest(p_options) with ordinality as t(o, i) where char_length(trim(coalesce(o, ''))) between 1 and 80);
  if jsonb_array_length(v_opts) not between 2 and 10 or jsonb_array_length(v_opts) <> cardinality(p_options) then
    raise exception 'INVALID_OPTIONS';
  end if;
  if p_closes_at is not null and p_closes_at <= now() then raise exception 'INVALID_TIME'; end if;
  if (select count(*) from public.club_polls where created_by = v_uid and created_at > now() - interval '1 hour') >= 5 then
    raise exception 'RATE_LIMITED';
  end if;
  insert into public.club_polls (id, club_id, created_by, question, options, multi, hide_results, closes_at)
  values (v_id, p_club_id, v_uid, trim(p_question), v_opts, coalesce(p_multi, false), coalesce(p_hide_results, false), p_closes_at);
  for m in select user_id from public.club_members where club_id = p_club_id and status = 'APPROVED' and user_id <> v_uid loop
    perform private.notify(m.user_id, p_club_id, 'CLUB_POLL', private.display_name(v_uid) || ' tạo bình chọn', trim(p_question),
      '/clubs/' || p_club_id || '/events', v_uid, false);
  end loop;
  return v_id;
end $$;

-- Ảnh đại diện CLB (bucket club-avatars, thư mục <club_id>/…): chỉ Ban quản trị CLB được tải lên / thay / xoá.
-- Chính sách HẠN CHẾ (restrictive): cộng thêm điều kiện lên mọi chính sách sẵn có của bucket trên production.
drop policy if exists club_avatars_staff_insert on storage.objects;
create policy club_avatars_staff_insert on storage.objects as restrictive for insert to authenticated
  with check (bucket_id <> 'club-avatars' or public.club_is_staff(public.safe_uuid((storage.foldername(name))[1])));
drop policy if exists club_avatars_staff_update on storage.objects;
create policy club_avatars_staff_update on storage.objects as restrictive for update to authenticated
  using (bucket_id <> 'club-avatars' or public.club_is_staff(public.safe_uuid((storage.foldername(name))[1])));
drop policy if exists club_avatars_staff_delete on storage.objects;
create policy club_avatars_staff_delete on storage.objects as restrictive for delete to authenticated
  using (bucket_id <> 'club-avatars' or public.club_is_staff(public.safe_uuid((storage.foldername(name))[1])));

-- Khách chưa đăng nhập không có lý do gọi các hàm ghi / tra quyền này
revoke execute on function public.rotate_invite_code(uuid), public.set_club_announcement(uuid, text),
  public.update_club(uuid, text, text, text, text), public.update_club_policy(uuid, text, integer),
  public.set_member_role(uuid, text), public.set_member_status(uuid, text), public.transfer_ownership(uuid, uuid),
  public.remove_member(uuid), public.join_club(uuid), public.delete_club(uuid), public.delete_club(uuid, text),
  public.admin_help_delete(text), public.admin_help_list(), public.admin_help_save(jsonb),
  public.admin_site_info_save(jsonb), public.get_challenge_fee(integer), public.validate_fee_tiers(jsonb)
  from public, anon;
grant execute on function public.rotate_invite_code(uuid), public.set_club_announcement(uuid, text),
  public.update_club(uuid, text, text, text, text), public.update_club_policy(uuid, text, integer),
  public.set_member_role(uuid, text), public.set_member_status(uuid, text), public.transfer_ownership(uuid, uuid),
  public.remove_member(uuid), public.join_club(uuid), public.delete_club(uuid), public.delete_club(uuid, text),
  public.admin_help_delete(text), public.admin_help_list(), public.admin_help_save(jsonb),
  public.admin_site_info_save(jsonb), public.get_challenge_fee(integer), public.validate_fee_tiers(jsonb)
  to authenticated;
-- Hàm trigger: không ai gọi trực tiếp qua API
revoke execute on function public.handle_new_user(), public.sync_club_member_count(), public.trigger_auto_reward_on_activity()
  from public, anon, authenticated;

notify pgrst, 'reload schema';
