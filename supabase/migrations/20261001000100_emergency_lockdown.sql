-- =====================================================================
-- 20261001000100 — KHÓA KHẨN CẤP CÁC LỖ HỔNG TÀI SẢN
--
-- Viết dựa trên schema production (supabase/remote_schema.sql).
-- Idempotent, không xóa dữ liệu. Có thể chạy độc lập ngay lập tức.
--
-- Lỗ hổng đang tồn tại trước migration này:
--   1. user_topup_xu / execute_ledger_transaction: anon (chưa đăng nhập) gọi được → tự tạo Xu.
--   2. admin_adjust_user_xu / admin_topup_club_fund: tin p_admin_id do client gửi.
--   3. create_challenge_with_fee: nhận p_fee từ client (số âm = được cộng Xu), p_user_id tùy ý.
--   4. Policy "Users can update own profile": tự sửa xu, xp, level, role, is_admin.
--   5. Policy SELECT công khai trên profiles làm lộ strava_access_token của mọi người.
--   6. user_inventory / user_equipment / user_badges / user_titles: tự thêm vật phẩm, huy hiệu.
--   7. activities: tự chèn bài chạy (trigger trg_auto_reward tự cộng Xu), tự sửa validation_status.
--   8. clubs / challenges: ai cũng INSERT được (bỏ qua phí, tự đặt treasury_balance).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Hàm nguy hiểm: chỉ service_role được gọi
--    (bản an toàn dùng auth.uid() được tạo ở migration 000300)
-- ---------------------------------------------------------------------
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and (
         p.proname in ('user_topup_xu', 'admin_adjust_user_xu', 'admin_topup_club_fund',
                       'execute_ledger_transaction', 'create_challenge_with_fee')
         -- các RPC cũ nhận p_user_id từ client
         or (p.proname in ('submit_and_process_activity', 'create_challenge_with_ledger')
             and 'p_user_id' = any(p.proargnames))
       )
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 2. Bỏ các policy cho phép ghi quá rộng
-- ---------------------------------------------------------------------
drop policy if exists "Allow public insert profile"         on public.profiles;
drop policy if exists "Users can insert own activities"     on public.activities;
drop policy if exists "Users can update own activities"     on public.activities;
drop policy if exists "Track points insert own"             on public.activity_track_points;
drop policy if exists "Allow public insert clubs"           on public.clubs;
drop policy if exists "Cho phép user tạo challenge mới"     on public.challenges;

-- "Manage own" (mọi thao tác) → chỉ còn XEM của mình; cấp/trang bị qua RPC
drop policy if exists "User manage own inventory" on public.user_inventory;
drop policy if exists "User manage own equipment" on public.user_equipment;
drop policy if exists "User manage own badges"    on public.user_badges;
drop policy if exists "User manage own titles"    on public.user_titles;

drop policy if exists "inventory_select_own" on public.user_inventory;
create policy "inventory_select_own" on public.user_inventory for select using (auth.uid() = user_id);
drop policy if exists "equipment_select_own" on public.user_equipment;
create policy "equipment_select_own" on public.user_equipment for select using (auth.uid() = user_id);
drop policy if exists "badges_select_own" on public.user_badges;
create policy "badges_select_own" on public.user_badges for select using (auth.uid() = user_id);
drop policy if exists "titles_select_own" on public.user_titles;
create policy "titles_select_own" on public.user_titles for select using (auth.uid() = user_id);

-- ---------------------------------------------------------------------
-- 3. Quyền theo cột / theo bảng
--    RPC SECURITY DEFINER chạy với quyền postgres nên KHÔNG bị ảnh hưởng.
-- ---------------------------------------------------------------------
-- Khách chưa đăng nhập không bao giờ được ghi
revoke insert, update, delete, truncate, references, trigger on all tables in schema public from anon;
revoke truncate, references, trigger on all tables in schema public from authenticated;

-- profiles: chỉ tự sửa tên và ảnh đại diện
revoke insert, update on public.profiles from authenticated;
grant update (display_name, avatar_url, updated_at) on public.profiles to authenticated;

-- user_avatar: chỉ ngoại hình; level/xp/coins do server quản lý
revoke insert, update on public.user_avatar from authenticated;
grant insert (user_id, gender, skin_tone, hair_style, hair_color, updated_at) on public.user_avatar to authenticated;
grant update (user_id, gender, skin_tone, hair_style, hair_color, updated_at) on public.user_avatar to authenticated;

-- Bảng chỉ server được ghi
revoke insert, update, delete on
  public.activities, public.activity_track_points,
  public.challenges, public.challenge_participants, public.challenge_results, public.challenge_rules,
  public.clubs, public.club_treasury_log,
  public.user_inventory, public.user_equipment, public.user_badges, public.user_titles, public.user_achievements,
  public.ledger_entries, public.ledger_transactions, public.wallet_transactions,
  public.system_config_versions, public.config_versions, public.system_settings,
  public.fraud_flags, public.admin_audit_log, public.admin_logs
from authenticated;

-- club_members: vào/duyệt/đổi vai trò qua RPC; vẫn cho tự rời CLB (policy club_members_leave)
revoke insert, update on public.club_members from authenticated;

-- Token OAuth: không ai ngoài server được đọc
revoke all on public.connected_accounts from anon, authenticated;

-- ---------------------------------------------------------------------
-- 4. Chuyển token Strava khỏi profiles (bảng ai cũng đọc được)
-- ---------------------------------------------------------------------
insert into public.connected_accounts (user_id, provider, provider_user_id, access_token, refresh_token, expires_at)
select distinct on (p.strava_athlete_id)
       p.id, 'STRAVA', p.strava_athlete_id, p.strava_access_token, p.strava_refresh_token,
       case when p.strava_token_expires_at is not null then to_timestamp(p.strava_token_expires_at) end
  from public.profiles p
 where p.strava_access_token is not null and p.strava_athlete_id is not null
 order by p.strava_athlete_id, p.updated_at desc nulls last
on conflict (provider, provider_user_id) do update set
  user_id = excluded.user_id,
  access_token = excluded.access_token,
  refresh_token = excluded.refresh_token,
  expires_at = excluded.expires_at;

update public.profiles
   set strava_access_token = null, strava_refresh_token = null
 where strava_access_token is not null or strava_refresh_token is not null;

-- Không bao giờ lưu token vào profiles nữa
alter table public.profiles drop constraint if exists profiles_no_oauth_tokens;
alter table public.profiles add constraint profiles_no_oauth_tokens
  check (strava_access_token is null and strava_refresh_token is null);

notify pgrst, 'reload schema';
