-- 006800: Xoá tài khoản ngay trong app.
-- Bắt buộc với app có đăng ký tài khoản trên App Store (Apple, mục 5.1.1(v)) và Google Play; đồng thời đáp ứng quyền
-- yêu cầu xoá dữ liệu của Luật Bảo vệ dữ liệu cá nhân 2025 (hiệu lực 01/01/2026; dữ liệu vị trí là dữ liệu nhạy cảm).
--
-- Cách xoá: XOÁ dữ liệu cá nhân + ẨN DANH phần còn lại, giữ bản ghi giao dịch (đơn hàng, sổ Xu) ở dạng ẩn danh
-- vì nghĩa vụ kế toán / đối soát. Sau RPC này, route /api/account/delete xoá mềm tài khoản đăng nhập (auth)
-- — email được làm rối, người dùng đăng ký lại được bằng chính email đó như tài khoản mới.
--
-- Chặn: quản trị viên (phải được gỡ quyền trước) và chủ nhiệm CLB còn thành viên khác (chuyển quyền trước).
-- Chạy được trong SQL Editor: không DO $$, không SELECT INTO, không LIMIT. Chạy lại nhiều lần vẫn an toàn.

alter table public.profiles add column if not exists deleted_at timestamptz;

create or replace function public.delete_my_account(p_confirm text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  v_p public.profiles := (select x from public.profiles x where x.id = v_uid);
  v_runs integer;
begin
  if coalesce(upper(trim(p_confirm)), '') not in ('XOÁ', 'XÓA', 'XOA') then raise exception 'CONFIRM_REQUIRED'; end if;
  if v_p.id is null then raise exception 'PROFILE_NOT_FOUND'; end if;
  if v_p.deleted_at is not null then return jsonb_build_object('ok', true, 'already', true); end if;
  if coalesce(v_p.is_admin, false) or coalesce(v_p.role, '') in ('ADMIN', 'SUPER_ADMIN') then raise exception 'ADMIN_CANNOT_DELETE'; end if;
  if exists (select 1 from public.clubs c where c.owner_id = v_uid
               and exists (select 1 from public.club_members m where m.club_id = c.id and m.user_id <> v_uid and m.status = 'ACTIVE')) then
    raise exception 'TRANSFER_CLUB_FIRST';
  end if;

  -- 1. Bài chạy: xoá tuyến GPS + chi tiết (dữ liệu vị trí), ẩn bài (không còn hiện ở đâu)
  delete from public.activity_track_points t using public.activities a where t.activity_id = a.id and a.user_id = v_uid;
  delete from public.activity_details d using public.activities a where d.activity_id = a.id and a.user_id = v_uid;
  update public.activities set status = 'DELETED', title = 'Buổi chạy', device_name = null where user_id = v_uid;
  v_runs := (select count(*) from public.activities where user_id = v_uid);

  -- 2. Dữ liệu cá nhân / thiết bị / vị trí
  delete from public.profile_details where user_id = v_uid;
  delete from public.push_subscriptions where user_id = v_uid;
  delete from public.push_settings where user_id = v_uid;
  delete from public.notification_settings where user_id = v_uid;
  delete from public.notifications where user_id = v_uid;
  delete from public.runner_discovery_settings where user_id = v_uid;
  delete from public.runner_location_presence where user_id = v_uid;
  delete from public.runner_nearby_searches where user_id = v_uid;
  delete from public.connected_accounts where user_id = v_uid;
  delete from public.content_bookmarks where user_id = v_uid;
  delete from public.content_read_history where user_id = v_uid;
  delete from public.content_user_events where user_id = v_uid;
  delete from public.club_message_reads where user_id = v_uid;
  delete from public.bib_listings where user_id = v_uid;
  delete from public.bib_contact_reveals where user_id = v_uid;
  delete from public.content_staff where user_id = v_uid;
  update public.content_authors set user_id = null where user_id = v_uid;
  update public.partners set status = 'HIDDEN', contacts = '{}'::jsonb, address = null where owner_id = v_uid;
  update public.challenge_honor_prefs set photo_url = null, hidden = true where user_id = v_uid;

  -- 3. Rời mọi CLB (CLB chỉ còn mình mình thì CLB giữ nguyên, không còn thành viên)
  delete from public.club_members where user_id = v_uid;

  -- 4. Hồ sơ: ẩn danh (bài viết / tin nhắn cũ trong CLB hiện "Người dùng đã xoá")
  update public.profiles set
    display_name = 'Người dùng đã xoá', avatar_url = null, bio = null, gender = null,
    strava_connected = false, strava_access_token = null, strava_refresh_token = null,
    strava_token_expires_at = null, strava_athlete_id = null,
    gift_wall_public = false, referral_code = null,
    banned_at = coalesce(banned_at, now()), banned_reason = 'ACCOUNT_DELETED',
    deleted_at = now(), updated_at = now()
  where id = v_uid;

  return jsonb_build_object('ok', true, 'activities_hidden', v_runs);
end $$;

revoke all on function public.delete_my_account(text) from public, anon;
grant execute on function public.delete_my_account(text) to authenticated;

notify pgrst, 'reload schema';
