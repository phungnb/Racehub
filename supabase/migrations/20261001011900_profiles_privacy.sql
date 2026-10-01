-- 011900: Vá lộ dữ liệu (kết quả quét bằng anon key, không đăng nhập).
--   profiles: còn 2 policy cũ "Allow public select profile" / "Public profiles are viewable by everyone" (USING true, cho cả anon)
--   → ai có anon key (nằm sẵn trong app web) đọc được MỌI cột của MỌI người: role, xu, strava_athlete_id, referral_code,
--   banned_reason… Token Strava đã được dọn từ 000100 (cột luôn null) nên không lộ token.
-- Sửa:
--   1. Khách chưa đăng nhập: không đọc được profiles.
--   2. Người đã đăng nhập: chỉ đọc CỘT CÔNG KHAI của người khác (id, tên, ảnh, level, giới tính, giới thiệu, ngày tham gia) — đủ cho các
--      chỗ app ghép tên / ảnh (bảng tin, bình luận, thành viên CLB, quỹ, thông báo).
--   3. Hồ sơ đầy đủ của CHÍNH MÌNH (Xu, XP, vai trò, Strava, mã giới thiệu…) đọc qua RPC my_account().
--   4. club_members, club_treasury_log, profile_settings, sổ cái: khách chưa đăng nhập bị từ chối hẳn (trước đây trả
--      200 + rỗng nhờ RLS; nay chặn thêm một lớp ở quyền bảng).
-- RPC SECURITY DEFINER (mọi màn hình khác) không bị ảnh hưởng. Chạy được trong SQL Editor, chạy lại an toàn.

-- 1 + 2. profiles
drop policy if exists "Allow public select profile" on public.profiles;
drop policy if exists "Public profiles are viewable by everyone" on public.profiles;
drop policy if exists "profiles_select_signed_in" on public.profiles;
create policy "profiles_select_signed_in" on public.profiles for select to authenticated using (true);

revoke select on public.profiles from anon, authenticated;
grant select (id, display_name, avatar_url, level, gender, bio, created_at) on public.profiles to authenticated;

-- 3. Hồ sơ đầy đủ của chính mình (bỏ các cột token cũ)
create or replace function public.my_account() returns jsonb
language sql stable security definer set search_path = public as $$
  select to_jsonb(p) - 'strava_access_token' - 'strava_refresh_token' - 'strava_token_expires_at'
    from public.profiles p where p.id = auth.uid()
$$;
revoke all on function public.my_account() from public, anon;
grant execute on function public.my_account() to authenticated;

-- 4. Khách chưa đăng nhập không đọc các bảng riêng tư (RLS vẫn là lớp chính cho người đã đăng nhập)
revoke select on public.club_members, public.club_treasury_log, public.profile_settings,
  public.ledger_entries, public.ledger_transactions, public.wallet_transactions from anon;
