-- =====================================================================
-- 20261001000300 — VIẾT LẠI CÁC RPC THEO NGUYÊN TẮC:
--   * Người gọi lấy từ auth.uid() — không nhận p_user_id / p_admin_id từ client
--   * Mọi thay đổi Xu đi qua private.ledger_post (sổ cái)
--   * Server tự tính / kiểm tra số liệu (quãng đường, phí), không tin client
-- Phụ thuộc: 20261001000200_ledger_and_rewards.sql
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. Quyền admin: role SYSTEM_ADMIN hoặc cờ is_admin (hai cột này nay đã bị khóa khỏi client)
-- ---------------------------------------------------------------------
create or replace function public.is_system_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles
                  where id = auth.uid() and (role = 'SYSTEM_ADMIN' or is_admin is true))
$$;

create or replace function private.require_uid() returns uuid
language plpgsql stable as $$
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  return auth.uid();
end $$;

create or replace function private.require_admin() returns uuid
language plpgsql stable security definer set search_path = public as $$
begin
  perform private.require_uid();
  if not public.is_system_admin() then raise exception 'FORBIDDEN'; end if;
  return auth.uid();
end $$;


-- ---------------------------------------------------------------------
-- 1. Hồ sơ: tạo phía server
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (new.id,
          coalesce(nullif(trim(new.raw_user_meta_data->>'full_name'), ''), split_part(new.email, '@', 1), 'Runner'),
          new.raw_user_meta_data->>'avatar_url')
  on conflict (id) do nothing;
  return new;
end $$;

-- Gắn trigger nếu project chưa có (không tạo trùng nếu đã có trigger gọi handle_new_user)
do $$
begin
  if not exists (select 1 from pg_trigger
                  where tgrelid = 'auth.users'::regclass
                    and tgfoid = 'public.handle_new_user'::regproc) then
    create trigger on_auth_user_created after insert on auth.users
      for each row execute function public.handle_new_user();
  end if;
end $$;

-- Cho user cũ chưa có hồ sơ (client gọi khi không tìm thấy profile)
create or replace function public.ensure_profile() returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := private.require_uid(); u record;
begin
  if exists (select 1 from public.profiles where id = v_uid) then return; end if;
  select * into u from auth.users where id = v_uid;
  insert into public.profiles (id, display_name, avatar_url)
  values (v_uid,
          coalesce(nullif(trim(u.raw_user_meta_data->>'full_name'), ''), split_part(u.email, '@', 1), 'Runner'),
          u.raw_user_meta_data->>'avatar_url')
  on conflict (id) do nothing;
end $$;
revoke all on function public.ensure_profile() from public, anon;
grant execute on function public.ensure_profile() to authenticated;

-- ---------------------------------------------------------------------
-- 2. Ghi nhận bài chạy GPS trong app (thay bản cũ nhận p_user_id)
--    Sửa lỗi bản cũ: tham chiếu challenges.start_at (không tồn tại) nên lỗi với mọi bài hợp lệ.
-- ---------------------------------------------------------------------
drop function if exists public.submit_and_process_activity(uuid, text, text, timestamptz, timestamptz, integer, integer, numeric, integer, jsonb);

create or replace function private.haversine_m(lat1 numeric, lon1 numeric, lat2 numeric, lon2 numeric)
returns numeric language sql immutable as $$
  select 2 * 6371000 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2) +
    cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lon2 - lon1) / 2), 2)))
$$;

create or replace function public.submit_and_process_activity(
  p_title text, p_source text, p_started_at timestamptz, p_ended_at timestamptz,
  p_elapsed_s integer, p_moving_s integer, p_distance_m numeric, p_avg_pace_s integer, p_track_points jsonb
) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_uid uuid := private.require_uid();
  cfg jsonb := private.economy_config();
  v_points jsonb := coalesce(p_track_points, '[]'::jsonb);
  v_n integer;
  v_gps_m numeric := 0;
  v_spikes integer := 0;
  v_prev jsonb;
  v_p jsonb;
  v_seg numeric;
  v_dt numeric;
  v_distance numeric;
  v_moving integer;
  v_pace integer;
  v_status text := 'APPROVED';
  v_reason text := 'Hoạt động hợp lệ qua kiểm tra tự động.';
  v_activity uuid;
  v_seq integer := 0;
  v_reward jsonb;
begin
  -- Kiểm tra đầu vào cơ bản
  if p_started_at is null or p_ended_at is null or p_ended_at <= p_started_at then raise exception 'INVALID_TIME_RANGE'; end if;
  if p_started_at > now() + interval '5 minutes' then raise exception 'INVALID_TIME_RANGE'; end if;
  if p_ended_at - p_started_at > interval '24 hours' then raise exception 'ACTIVITY_TOO_LONG'; end if;
  if jsonb_typeof(v_points) <> 'array' then raise exception 'INVALID_TRACK_POINTS'; end if;
  v_n := jsonb_array_length(v_points);
  if v_n > 20000 then raise exception 'TOO_MANY_TRACK_POINTS'; end if;

  -- Chống gửi trùng / chồng thời gian với bài chạy khác
  if exists (select 1 from public.activities
              where user_id = v_uid and started_at < p_ended_at and ended_at > p_started_at) then
    raise exception 'ACTIVITY_DUPLICATE';
  end if;
  if (select count(*) from public.activities where user_id = v_uid and created_at > now() - interval '1 day') >= 20 then
    raise exception 'RATE_LIMITED';
  end if;

  -- Tính lại quãng đường từ GPS (không tin số client gửi)
  for v_p in select value from jsonb_array_elements(v_points) loop
    if v_prev is not null then
      v_seg := private.haversine_m((v_prev->>'latitude')::numeric, (v_prev->>'longitude')::numeric,
                                   (v_p->>'latitude')::numeric, (v_p->>'longitude')::numeric);
      v_dt := extract(epoch from ((v_p->>'recorded_at')::timestamptz - (v_prev->>'recorded_at')::timestamptz));
      if v_dt > 0 and v_seg / v_dt > 12 then v_spikes := v_spikes + 1; end if;   -- > 43 km/h
      v_gps_m := v_gps_m + coalesce(v_seg, 0);
    end if;
    v_prev := v_p;
  end loop;

  v_moving := least(greatest(coalesce(p_moving_s, 0), 0), extract(epoch from (p_ended_at - p_started_at))::integer);
  v_distance := case when v_n >= 2 then round(v_gps_m) else greatest(coalesce(p_distance_m, 0), 0) end;
  v_pace := case when v_distance > 0 then round(v_moving / (v_distance / 1000.0)) else 0 end;

  -- Luật xác thực (xem ADR-007)
  if v_distance < 200 then
    v_status := 'REJECTED'; v_reason := 'Quá ngắn (< 200 m), không đủ điều kiện ghi nhận.';
  elsif v_n < 2 then
    v_status := 'PENDING'; v_reason := 'Thiếu dữ liệu GPS — cần quản trị viên xác minh.';
  elsif v_pace < (cfg->>'minValidPace')::numeric * 60 then
    v_status := 'PENDING'; v_reason := 'Tốc độ trung bình nhanh bất thường — chờ xác minh.';
  elsif v_spikes > 3 then
    v_status := 'PENDING'; v_reason := 'Phát hiện nhiều đoạn di chuyển > 43 km/h — chờ xác minh.';
  elsif p_distance_m > 0 and abs(p_distance_m - v_distance) > greatest(0.15 * v_distance, 100) then
    v_status := 'PENDING'; v_reason := 'Quãng đường gửi lên lệch nhiều so với GPS — chờ xác minh.';
  end if;

  insert into public.activities (
    user_id, title, source, started_at, ended_at, elapsed_time_s, moving_time_s,
    distance_m, moving_distance_m, avg_pace_s, status, validation_status, validation_reason)
  values (
    v_uid, left(coalesce(nullif(trim(p_title), ''), 'Buổi chạy'), 120),
    case when p_source in ('DIRECT_GPS', 'STRAVA', 'GARMIN') then p_source else 'DIRECT_GPS' end,
    p_started_at, p_ended_at, greatest(coalesce(p_elapsed_s, 0), v_moving), v_moving,
    v_distance, v_distance, v_pace,
    case v_status when 'APPROVED' then 'READY' when 'PENDING' then 'PROCESSING' else 'REJECTED' end,
    v_status, v_reason)
  returning id into v_activity;

  for v_p in select value from jsonb_array_elements(v_points) loop
    v_seq := v_seq + 1;
    insert into public.activity_track_points (activity_id, sequence, latitude, longitude, accuracy, altitude, speed, recorded_at)
    values (v_activity, v_seq, (v_p->>'latitude')::numeric, (v_p->>'longitude')::numeric,
            (v_p->>'accuracy')::numeric, (v_p->>'altitude')::numeric, (v_p->>'speed')::numeric,
            coalesce((v_p->>'recorded_at')::timestamptz, p_started_at));
  end loop;

  if v_status = 'APPROVED' then
    select jsonb_build_object('earned_xu', earned_xu, 'earned_xp', earned_xp) into v_reward
      from public.activities where id = v_activity;         -- trigger trg_auto_reward đã thưởng
  end if;

  return json_build_object(
    'success', true, 'activity_id', v_activity,
    'validation_status', v_status, 'validation_reason', v_reason,
    'distance_m', v_distance,
    'earned_xp', coalesce((v_reward->>'earned_xp')::integer, 0),
    'earned_xu', coalesce((v_reward->>'earned_xu')::numeric, 0));
end $$;
revoke all on function public.submit_and_process_activity(text, text, timestamptz, timestamptz, integer, integer, numeric, integer, jsonb) from public, anon;
grant execute on function public.submit_and_process_activity(text, text, timestamptz, timestamptz, integer, integer, numeric, integer, jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- 3. Duyệt bài chạy (sửa lỗi: bản cũ đọc profiles.club_id — cột không tồn tại)
-- ---------------------------------------------------------------------
create or replace function public.review_activity(p_activity_id uuid, p_status text) returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := private.require_uid(); v_runner uuid;
begin
  if p_status not in ('APPROVED', 'REJECTED') then raise exception 'INVALID_STATUS'; end if;

  select user_id into v_runner from public.activities where id = p_activity_id and validation_status = 'PENDING';
  if v_runner is null then raise exception 'ACTIVITY_NOT_PENDING'; end if;
  if v_runner = v_uid then raise exception 'FORBIDDEN'; end if;

  -- Admin hệ thống: mọi bài. Chủ nhiệm/Phó CLB: bài của thành viên trong CLB mình quản lý.
  if not public.is_system_admin() and not exists (
       select 1 from public.club_members me
         join public.club_members runner on runner.club_id = me.club_id
        where me.user_id = v_uid and me.status = 'APPROVED' and me.role in ('OWNER', 'CAPTAIN')
          and runner.user_id = v_runner and runner.status = 'APPROVED') then
    raise exception 'FORBIDDEN';
  end if;

  update public.activities
     set validation_status = p_status,
         status = case when p_status = 'APPROVED' then 'READY' else 'REJECTED' end,
         updated_at = now()
   where id = p_activity_id;             -- APPROVED → trigger trg_auto_reward trả thưởng

  insert into public.admin_audit_log (actor_id, action, target, new_value)
  values (v_uid, 'REVIEW_ACTIVITY', p_activity_id::text, jsonb_build_object('status', p_status));
end $$;
revoke all on function public.review_activity(uuid, text) from public, anon;
grant execute on function public.review_activity(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- 4. Tạo thử thách có thu phí (thay bản cũ nhận p_user_id)
-- ---------------------------------------------------------------------
drop function if exists public.create_challenge_with_ledger(uuid, text, text, text, numeric, numeric, integer, integer, text, timestamptz, timestamptz, timestamptz, numeric, numeric, integer, text);
drop function if exists public.create_challenge_with_fee(uuid, text, text, text, numeric, numeric, integer, integer, text, timestamptz, timestamptz, timestamptz, numeric, numeric, integer);
drop function if exists public.create_challenge_with_fee(uuid, text, text, text, numeric, numeric, integer, integer, text, timestamptz, timestamptz, timestamptz, numeric, numeric, integer, integer);

create or replace function public.create_challenge_with_ledger(
  p_title text, p_challenge_type text, p_game_mode text, p_target_km numeric, p_min_km numeric,
  p_min_members integer, p_fixed_team_size integer, p_target_audience text,
  p_start_date timestamptz, p_end_date timestamptz, p_reg_deadline timestamptz,
  p_min_pace numeric, p_max_pace numeric, p_max_slots integer, p_idempotency_key text
) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_uid uuid := private.require_uid();
  v_existing uuid;
  v_config jsonb;
  v_tier jsonb;
  v_base_fee integer := 50;
  v_type_mult numeric := 1.0;
  v_duration_mult numeric := 1.0;
  v_days integer;
  v_fee integer;
  v_challenge uuid;
begin
  -- Gửi lại cùng khóa → trả kết quả cũ (không thu phí 2 lần)
  if p_idempotency_key is null or length(p_idempotency_key) < 8 then raise exception 'IDEMPOTENCY_KEY_REQUIRED'; end if;
  select campaign_id into v_existing from public.ledger_transactions
   where idempotency_key = 'challenge_fee:' || v_uid || ':' || p_idempotency_key;
  if found then return jsonb_build_object('success', true, 'challenge_id', v_existing, 'duplicate', true); end if;

  -- Kiểm tra dữ liệu (không tin client)
  if p_title is null or char_length(trim(p_title)) not between 3 and 120 then raise exception 'INVALID_TITLE'; end if;
  if p_challenge_type not in ('INDIVIDUAL', 'TEAM') then raise exception 'INVALID_CHALLENGE_TYPE'; end if;
  if coalesce(p_target_audience, 'PUBLIC') not in ('PUBLIC', 'CLUB_ONLY', 'INVITE_ONLY') then raise exception 'INVALID_AUDIENCE'; end if;
  if p_start_date is null or p_end_date is null or p_end_date <= p_start_date then raise exception 'INVALID_TIME_RANGE'; end if;
  if p_end_date - p_start_date > interval '366 days' then raise exception 'INVALID_TIME_RANGE'; end if;
  if p_max_slots is null or p_max_slots not between 1 and 10000 then raise exception 'INVALID_MAX_SLOTS'; end if;
  if coalesce(p_target_km, 0) < 0 or coalesce(p_min_km, 0) < 0 then raise exception 'INVALID_DISTANCE'; end if;
  if coalesce(p_min_pace, 3) <= 0 or coalesce(p_max_pace, 15) < coalesce(p_min_pace, 3) then raise exception 'INVALID_PACE'; end if;

  -- Phí theo cấu hình đang PUBLISHED (giữ công thức cũ "Mô hình B")
  select config_value into v_config from public.system_config_versions
   where config_key = 'challenge_fee_model_b' and status = 'PUBLISHED' order by version desc limit 1;
  if v_config is not null then
    for v_tier in select * from jsonb_array_elements(v_config->'tiers') loop
      if p_max_slots >= (v_tier->>'min')::int and (v_tier->>'max' is null or p_max_slots <= (v_tier->>'max')::int) then
        v_base_fee := (v_tier->>'fee')::int;
      end if;
    end loop;
    v_type_mult := case when p_challenge_type = 'TEAM'
                        then coalesce((v_config->'multipliers'->>'type_team')::numeric, 1.3)
                        else coalesce((v_config->'multipliers'->>'type_individual')::numeric, 1.0) end;
    v_days := extract(day from (p_end_date - p_start_date));
    v_duration_mult := case when v_days > 30 then coalesce((v_config->'multipliers'->>'duration_long')::numeric, 1.5)
                            when v_days > 14 then coalesce((v_config->'multipliers'->>'duration_mid_30d')::numeric, 1.2)
                            else coalesce((v_config->'multipliers'->>'duration_short_14d')::numeric, 1.0) end;
  end if;
  v_fee := greatest(round(v_base_fee * v_type_mult * v_duration_mult)::int, 0);

  insert into public.challenges (
    title, challenge_type, game_mode, target_type, target_value, target_km, min_km, min_members,
    fixed_team_size, target_audience, creator_role, start_date, end_date, reg_deadline,
    min_pace, max_pace, max_slots, calculated_fee, fee_charged, created_by)
  values (
    trim(p_title), p_challenge_type, p_game_mode, 'DISTANCE', coalesce(p_target_km, 0), coalesce(p_target_km, 0),
    coalesce(p_min_km, 0), greatest(coalesce(p_min_members, 1), 1), greatest(coalesce(p_fixed_team_size, 0), 0),
    coalesce(p_target_audience, 'PUBLIC'), 'RACE DIRECTOR', p_start_date, p_end_date, p_reg_deadline,
    coalesce(p_min_pace, 3), coalesce(p_max_pace, 15), p_max_slots, v_fee, v_fee, v_uid)
  returning id into v_challenge;

  if v_fee > 0 then
    perform private.ledger_post('CHALLENGE_CREATION_FEE', 'challenge_fee:' || v_uid || ':' || p_idempotency_key,
      'Phí khởi tạo thử thách', v_uid, private.debit_entries(v_uid, v_fee, private.system_account()), v_challenge);
  else
    -- vẫn ghi dấu idempotency để lần gửi lại trả về cùng thử thách
    insert into public.ledger_transactions (type, idempotency_key, reason, created_by, campaign_id)
    values ('CHALLENGE_CREATION_FEE', 'challenge_fee:' || v_uid || ':' || p_idempotency_key, 'Miễn phí', v_uid, v_challenge);
  end if;

  return jsonb_build_object('success', true, 'challenge_id', v_challenge, 'charged_fee', v_fee,
                            'remaining_balance', private.balance(v_uid));
end $$;
revoke all on function public.create_challenge_with_ledger(text, text, text, numeric, numeric, integer, integer, text, timestamptz, timestamptz, timestamptz, numeric, numeric, integer, text) from public, anon;
grant execute on function public.create_challenge_with_ledger(text, text, text, numeric, numeric, integer, integer, text, timestamptz, timestamptz, timestamptz, numeric, numeric, integer, text) to authenticated;

-- ---------------------------------------------------------------------
-- 5. Đóng góp quỹ CLB qua sổ cái
-- ---------------------------------------------------------------------
create or replace function public.contribute_treasury(p_club_id uuid, p_amount numeric) returns numeric
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := private.require_uid(); v_amount numeric := round(p_amount, 1);
begin
  if v_amount is null or v_amount <= 0 or v_amount > 1000000 then raise exception 'INVALID_AMOUNT'; end if;
  if public.club_role(p_club_id) is null then raise exception 'NOT_A_MEMBER'; end if;
  if private.balance(v_uid) < v_amount then raise exception 'INSUFFICIENT_FUNDS'; end if;

  perform private.ledger_post('CLUB_CONTRIBUTION', 'club_contribution:' || gen_random_uuid(),
    'Đóng góp quỹ CLB', v_uid, private.debit_entries(v_uid, v_amount, p_club_id), p_club_id);

  insert into public.club_treasury_log (club_id, user_id, amount, kind) values (p_club_id, v_uid, v_amount, 'CONTRIBUTE');
  return (select treasury_balance from public.clubs where id = p_club_id);
end $$;
revoke all on function public.contribute_treasury(uuid, numeric) from public, anon;
grant execute on function public.contribute_treasury(uuid, numeric) to authenticated;

-- CLB mới không còn được "tặng" 100 Xu từ hư không; quỹ bắt đầu từ 0 và nạp qua sổ cái
create or replace function public.create_club(p_name text, p_description text default null) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_uid uuid := private.require_uid(); v_club public.clubs;
begin
  if p_name is null or trim(p_name) = '' then raise exception 'NAME_REQUIRED'; end if;
  if char_length(trim(p_name)) > 60 then raise exception 'NAME_TOO_LONG'; end if;
  if p_description is not null and char_length(p_description) > 300 then raise exception 'DESC_TOO_LONG'; end if;

  begin
    insert into public.clubs (name, description, owner_id, invite_code, treasury_balance, member_count)
    values (trim(p_name), nullif(trim(p_description), ''), v_uid, encode(gen_random_bytes(6), 'hex'), 0, 0)
    returning * into v_club;
  exception when unique_violation then
    raise exception 'NAME_TAKEN';
  end;

  insert into public.club_members (club_id, user_id, role, status) values (v_club.id, v_uid, 'OWNER', 'APPROVED');
  select * into v_club from public.clubs where id = v_club.id;
  return to_jsonb(v_club);
end $$;
revoke all on function public.create_club(text, text) from public, anon;
grant execute on function public.create_club(text, text) to authenticated;

-- ---------------------------------------------------------------------
-- 6. Giới thiệu bạn bè (sửa lỗi: bản cũ ghi vào bảng activity_history không tồn tại)
--    Người được mời nhận thưởng ngay; người mời nhận khi bạn chạy đủ km (xem reward_activity)
-- ---------------------------------------------------------------------
create or replace function public.apply_referral(p_referrer_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  cfg jsonb := private.economy_config();
  v_bonus numeric := (cfg->>'refBonusReferee')::numeric;
  v_created timestamptz;
begin
  if p_referrer_id = v_uid then raise exception 'CANNOT_REFER_SELF'; end if;
  if not exists (select 1 from public.profiles where id = p_referrer_id) then raise exception 'REFERRER_NOT_FOUND'; end if;

  select created_at into v_created from public.profiles where id = v_uid for update;
  if (select referred_by from public.profiles where id = v_uid) is not null then raise exception 'ALREADY_REFERRED'; end if;
  if v_created < now() - interval '14 days' then raise exception 'REFERRAL_WINDOW_EXPIRED'; end if;
  -- Không cho giới thiệu vòng tròn (A mời B, B mời A)
  if exists (select 1 from public.profiles where id = p_referrer_id and referred_by = v_uid) then
    raise exception 'CANNOT_REFER_SELF';
  end if;

  update public.profiles set referred_by = p_referrer_id where id = v_uid;

  if v_bonus > 0 then
    perform private.ledger_post('REFERRAL_REFEREE', 'referral_referee:' || v_uid, 'Thưởng chào mừng qua lời mời', v_uid,
      jsonb_build_array(
        jsonb_build_object('account_id', v_uid, 'coin_kind', 'BONUS', 'amount', v_bonus),
        jsonb_build_object('account_id', private.system_account(), 'coin_kind', 'BONUS', 'amount', -v_bonus)));
  end if;

  return jsonb_build_object('success', true, 'referee_reward', v_bonus,
                            'referrer_reward', (cfg->>'refBonusInviter')::numeric,
                            'referrer_reward_after_km', (cfg->>'refMinKmRequired')::numeric);
end $$;
revoke all on function public.apply_referral(uuid) from public, anon;
grant execute on function public.apply_referral(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 7. Công cụ tài chính cho admin (thay các bản tin p_admin_id / không kiểm tra quyền)
-- ---------------------------------------------------------------------
drop function if exists public.admin_adjust_user_xu(uuid, uuid, bigint, text, text, text);
drop function if exists public.admin_topup_club_fund(uuid, uuid, bigint, text, text);
drop function if exists public.user_topup_xu(uuid, uuid, bigint, bigint, text, text);

create or replace function public.admin_adjust_user_xu(
  p_target_user_id uuid, p_amount numeric, p_coin_kind text, p_reason text, p_idempotency_key text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_admin uuid := private.require_admin(); v_tx uuid;
begin
  if p_amount is null or p_amount = 0 then raise exception 'INVALID_AMOUNT'; end if;
  if p_coin_kind not in ('BONUS', 'PAID') then raise exception 'INVALID_COIN_KIND'; end if;
  if p_reason is null or char_length(trim(p_reason)) < 5 then raise exception 'REASON_REQUIRED'; end if;
  if not exists (select 1 from public.profiles where id = p_target_user_id) then raise exception 'USER_NOT_FOUND'; end if;

  v_tx := private.ledger_post('ADMIN_ADJUST', 'admin_adjust:' || p_idempotency_key, trim(p_reason), v_admin,
    jsonb_build_array(
      jsonb_build_object('account_id', p_target_user_id, 'coin_kind', p_coin_kind, 'amount', p_amount),
      jsonb_build_object('account_id', private.system_account(), 'coin_kind', p_coin_kind, 'amount', -p_amount)));
  update public.ledger_transactions set approved_by = v_admin where id = v_tx;

  insert into public.admin_audit_log (actor_id, action, target, new_value, reason)
  values (v_admin, 'ADJUST_USER_XU', p_target_user_id::text,
          jsonb_build_object('amount', p_amount, 'coin_kind', p_coin_kind, 'tx', v_tx), trim(p_reason));
  return jsonb_build_object('success', true, 'transaction_id', v_tx, 'balance', private.balance(p_target_user_id));
end $$;

create or replace function public.admin_topup_club_fund(
  p_club_id uuid, p_amount numeric, p_reason text, p_idempotency_key text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_admin uuid := private.require_admin(); v_tx uuid;
begin
  if p_amount is null or p_amount <= 0 then raise exception 'INVALID_AMOUNT'; end if;
  if p_reason is null or char_length(trim(p_reason)) < 5 then raise exception 'REASON_REQUIRED'; end if;
  if not exists (select 1 from public.clubs where id = p_club_id) then raise exception 'CLUB_NOT_FOUND'; end if;

  v_tx := private.ledger_post('CLUB_FUND_TOPUP', 'club_topup:' || p_idempotency_key, trim(p_reason), v_admin,
    jsonb_build_array(
      jsonb_build_object('account_id', p_club_id, 'coin_kind', 'BONUS', 'amount', p_amount),
      jsonb_build_object('account_id', private.system_account(), 'coin_kind', 'BONUS', 'amount', -p_amount)), p_club_id);
  insert into public.admin_audit_log (actor_id, action, target, new_value, reason)
  values (v_admin, 'TOPUP_CLUB_FUND', p_club_id::text, jsonb_build_object('amount', p_amount, 'tx', v_tx), trim(p_reason));
  return jsonb_build_object('success', true, 'transaction_id', v_tx);
end $$;

-- Nạp Xu bằng tiền thật: chỉ admin xác nhận thủ công (sau này: webhook cổng thanh toán dùng service_role)
create or replace function public.user_topup_xu(
  p_target_user_id uuid, p_amount_xu numeric, p_amount_vnd bigint, p_bank_reference text, p_idempotency_key text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_admin uuid := private.require_admin(); v_tx uuid;
begin
  if p_amount_xu is null or p_amount_xu <= 0 or p_amount_vnd is null or p_amount_vnd <= 0 then raise exception 'INVALID_AMOUNT'; end if;
  if p_bank_reference is null or char_length(trim(p_bank_reference)) < 3 then raise exception 'BANK_REFERENCE_REQUIRED'; end if;

  v_tx := private.ledger_post('IAP_TOPUP_VND', 'topup:' || p_bank_reference,
    format('Nạp %s Xu ứng với %s VNĐ (Ref: %s)', p_amount_xu, p_amount_vnd, p_bank_reference), v_admin,
    jsonb_build_array(
      jsonb_build_object('account_id', p_target_user_id, 'coin_kind', 'PAID', 'amount', p_amount_xu),
      jsonb_build_object('account_id', private.system_account(), 'coin_kind', 'PAID', 'amount', -p_amount_xu)));
  update public.ledger_transactions set approved_by = v_admin where id = v_tx;
  insert into public.admin_audit_log (actor_id, action, target, new_value, reason)
  values (v_admin, 'TOPUP_USER_XU', p_target_user_id::text,
          jsonb_build_object('xu', p_amount_xu, 'vnd', p_amount_vnd, 'ref', p_bank_reference, 'tx', v_tx), 'Nạp Xu');
  return jsonb_build_object('success', true, 'transaction_id', v_tx, 'credited_xu', p_amount_xu);
end $$;

revoke all on function public.admin_adjust_user_xu(uuid, numeric, text, text, text) from public, anon;
revoke all on function public.admin_topup_club_fund(uuid, numeric, text, text) from public, anon;
revoke all on function public.user_topup_xu(uuid, numeric, bigint, text, text) from public, anon;
grant execute on function public.admin_adjust_user_xu(uuid, numeric, text, text, text) to authenticated;
grant execute on function public.admin_topup_club_fund(uuid, numeric, text, text) to authenticated;
grant execute on function public.user_topup_xu(uuid, numeric, bigint, text, text) to authenticated;

-- Hàm ghi sổ cũ: chỉ server nội bộ
revoke all on function public.execute_ledger_transaction(text, text, text, uuid, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 8. Cấu hình kinh tế từ trang Admin (bản cũ upsert theo config_key → lỗi vì
--    unique là (config_key, version)). Mỗi lần lưu = một phiên bản mới.
-- ---------------------------------------------------------------------
create or replace function public.admin_publish_config(p_config_key text, p_config_value jsonb) returns integer
language plpgsql security definer set search_path = public as $$
declare v_admin uuid := private.require_admin(); v_next integer; v_old jsonb;
begin
  if p_config_key not in ('economy_global_config', 'challenge_fee_model_b') then raise exception 'UNSUPPORTED_CONFIG_KEY'; end if;
  if jsonb_typeof(p_config_value) <> 'object' then raise exception 'INVALID_CONFIG'; end if;
  if p_config_key = 'economy_global_config' and (
       coalesce((p_config_value->>'kmRate')::numeric, 0) < 0 or coalesce((p_config_value->>'kmRate')::numeric, 0) > 100 or
       coalesce((p_config_value->>'maxDailyReward')::numeric, 0) < 0 or
       coalesce((p_config_value->>'minValidPace')::numeric, 3) <= 0 or
       coalesce((p_config_value->>'maxValidPace')::numeric, 15) < coalesce((p_config_value->>'minValidPace')::numeric, 3)) then
    raise exception 'INVALID_CONFIG';
  end if;

  perform pg_advisory_xact_lock(hashtext('config:' || p_config_key));
  select config_value into v_old from public.system_config_versions
   where config_key = p_config_key and status = 'PUBLISHED' order by version desc limit 1;
  select coalesce(max(version), 0) + 1 into v_next from public.system_config_versions where config_key = p_config_key;

  update public.system_config_versions set status = 'ARCHIVED' where config_key = p_config_key and status = 'PUBLISHED';
  insert into public.system_config_versions (config_key, version, status, config_value, created_by)
  values (p_config_key, v_next, 'PUBLISHED', p_config_value, v_admin);

  insert into public.admin_audit_log (actor_id, action, target, old_value, new_value)
  values (v_admin, 'PUBLISH_CONFIG', p_config_key || ' v' || v_next, v_old, p_config_value);
  return v_next;
end $$;
revoke all on function public.admin_publish_config(text, jsonb) from public, anon;
grant execute on function public.admin_publish_config(text, jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- 9. Kết nối Strava — chỉ server (service_role) gọi, token lưu ở connected_accounts
-- ---------------------------------------------------------------------
create or replace function public.link_provider_connection(
  p_user_id uuid, p_provider text, p_external_user_id text, p_access_token text,
  p_refresh_token text, p_expires_at timestamptz, p_scopes text[] default null
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.connected_accounts
              where provider = p_provider and provider_user_id = p_external_user_id and user_id <> p_user_id) then
    raise exception 'PROVIDER_ACCOUNT_CONFLICT';
  end if;
  delete from public.connected_accounts where user_id = p_user_id and provider = p_provider;
  insert into public.connected_accounts (user_id, provider, provider_user_id, access_token, refresh_token, expires_at)
  values (p_user_id, p_provider, p_external_user_id, p_access_token, p_refresh_token, p_expires_at);
  if p_provider = 'STRAVA' then
    update public.profiles set strava_connected = true, strava_athlete_id = p_external_user_id, updated_at = now()
     where id = p_user_id;
  end if;
end $$;

create or replace function public.unlink_provider_connection(p_user_id uuid, p_provider text) returns text
language plpgsql security definer set search_path = public as $$
declare v_token text;
begin
  delete from public.connected_accounts where user_id = p_user_id and provider = p_provider
  returning access_token into v_token;
  if p_provider = 'STRAVA' then
    update public.profiles set strava_connected = false, strava_athlete_id = null, updated_at = now() where id = p_user_id;
  end if;
  return v_token;
end $$;
revoke all on function public.link_provider_connection(uuid, text, text, text, text, timestamptz, text[]) from public, anon, authenticated;
revoke all on function public.unlink_provider_connection(uuid, text) from public, anon, authenticated;
grant execute on function public.link_provider_connection(uuid, text, text, text, text, timestamptz, text[]) to service_role;
grant execute on function public.unlink_provider_connection(uuid, text) to service_role;

-- ---------------------------------------------------------------------
-- 10. has_permission(p_club_id, p_permission_code): kiểm tra cho chính người gọi
--     (bản 3 tham số vẫn giữ vì các policy club_announcements đang dùng)
-- ---------------------------------------------------------------------
create or replace function public.has_permission(p_club_id uuid, p_permission_code text) returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and public.has_permission(auth.uid(), p_club_id, p_permission_code)
$$;
revoke all on function public.has_permission(uuid, text) from public, anon;
grant execute on function public.has_permission(uuid, text) to authenticated;

-- Hàm nội bộ: chỉ được gọi từ bên trong các hàm SECURITY DEFINER ở trên
revoke execute on all functions in schema private from public, anon, authenticated;

notify pgrst, 'reload schema';
