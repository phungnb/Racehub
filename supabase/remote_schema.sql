


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE OR REPLACE FUNCTION "public"."activity_is_countable"("p_status" "text", "p_validation" "text") RETURNS boolean
    LANGUAGE "sql" IMMUTABLE
    AS $$
  select coalesce(upper(p_validation), '') not in ('REJECTED','INVALID','FLAGGED','FRAUD','FAILED')
     and coalesce(upper(p_status), '')     not in ('DELETED','CANCELLED','REJECTED','INVALID')
$$;


ALTER FUNCTION "public"."activity_is_countable"("p_status" "text", "p_validation" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_adjust_user_xu"("p_admin_id" "uuid", "p_target_user_id" "uuid", "p_amount" bigint, "p_coin_kind" "text", "p_reason" "text", "p_idempotency_key" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_tx_id UUID;
  v_system_acc UUID := '00000000-0000-0000-0000-000000000000'::UUID;
BEGIN
  -- Kiểm tra quyền Admin
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_admin_id AND (is_admin = true OR role = 'SYSTEM_ADMIN')) THEN
    RAISE EXCEPTION 'Bạn không có quyền thực hiện thao tác tài chính này.';
  END IF;

  IF EXISTS (SELECT 1 FROM ledger_transactions WHERE idempotency_key = p_idempotency_key) THEN
    RAISE EXCEPTION 'Giao dịch đã tồn tại.';
  END IF;

  -- Tạo giao dịch sổ cái
  INSERT INTO ledger_transactions (type, idempotency_key, reason, created_by, approved_by)
  VALUES ('ADMIN_ADJUST', p_idempotency_key, p_reason, p_admin_id, p_admin_id)
  RETURNING id INTO v_tx_id;

  -- Bút toán ghi nhận vào ví User
  INSERT INTO ledger_entries (transaction_id, account_id, coin_kind, amount)
  VALUES (v_tx_id, p_target_user_id, p_coin_kind, p_amount);

  -- Bút toán đối ứng từ tài khoản hệ thống (Quỹ phát hành)
  INSERT INTO ledger_entries (transaction_id, account_id, coin_kind, amount)
  VALUES (v_tx_id, v_system_acc, p_coin_kind, -p_amount);

  -- Đồng bộ số dư vào bảng profiles
  UPDATE profiles 
  SET xu = xu + p_amount 
  WHERE id = p_target_user_id;

  RETURN json_build_object('success', true, 'transaction_id', v_tx_id);
END;
$$;


ALTER FUNCTION "public"."admin_adjust_user_xu"("p_admin_id" "uuid", "p_target_user_id" "uuid", "p_amount" bigint, "p_coin_kind" "text", "p_reason" "text", "p_idempotency_key" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_topup_club_fund"("p_admin_id" "uuid", "p_club_id" "uuid", "p_amount" bigint, "p_reason" "text", "p_idempotency_key" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_tx_id UUID;
  v_system_acc UUID := '00000000-0000-0000-0000-000000000000'::UUID;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_admin_id AND (is_admin = true OR role = 'SYSTEM_ADMIN')) THEN
    RAISE EXCEPTION 'Không có quyền quản trị.';
  END IF;

  IF EXISTS (SELECT 1 FROM ledger_transactions WHERE idempotency_key = p_idempotency_key) THEN
    RAISE EXCEPTION 'Giao dịch trùng lặp.';
  END IF;

  INSERT INTO ledger_transactions (type, idempotency_key, reason, created_by, approved_by)
  VALUES ('CLUB_FUND_TOPUP', p_idempotency_key, p_reason, p_admin_id, p_admin_id)
  RETURNING id INTO v_tx_id;

  -- Bút toán cộng quỹ CLB (Sử dụng account_id là club_id)
  INSERT INTO ledger_entries (transaction_id, account_id, coin_kind, amount)
  VALUES (v_tx_id, p_club_id, 'PAID', p_amount);

  -- Đối ứng từ tài khoản hệ thống
  INSERT INTO ledger_entries (transaction_id, account_id, coin_kind, amount)
  VALUES (v_tx_id, v_system_acc, 'PAID', -p_amount);

  RETURN json_build_object('success', true, 'transaction_id', v_tx_id);
END;
$$;


ALTER FUNCTION "public"."admin_topup_club_fund"("p_admin_id" "uuid", "p_club_id" "uuid", "p_amount" bigint, "p_reason" "text", "p_idempotency_key" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."apply_referral"("p_referrer_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_current_referred_by uuid;
  v_referrer_exists boolean;
  v_referee_reward int := 50;
  v_referrer_reward int := 100;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;

  IF p_referrer_id = v_user_id THEN
    RAISE EXCEPTION 'CANNOT_REFER_SELF';
  END IF;

  SELECT referred_by INTO v_current_referred_by FROM profiles WHERE id = v_user_id;
  IF v_current_referred_by IS NOT NULL THEN
    RAISE EXCEPTION 'ALREADY_REFERRED';
  END IF;

  SELECT EXISTS(SELECT 1 FROM profiles WHERE id = p_referrer_id) INTO v_referrer_exists;
  IF NOT v_referrer_exists THEN
    RAISE EXCEPTION 'REFERRER_NOT_FOUND';
  END IF;

  UPDATE profiles
    SET referred_by = p_referrer_id,
        xu = COALESCE(xu, 0) + v_referee_reward
    WHERE id = v_user_id;

  UPDATE profiles
    SET xu = COALESCE(xu, 0) + v_referrer_reward
    WHERE id = p_referrer_id;

  INSERT INTO activity_history (user_id, name, description, start_date)
  VALUES
    (v_user_id, 'Được giới thiệu tham gia RaceHub', 'Nhận ' || v_referee_reward || ' Xu chào mừng', now()),
    (p_referrer_id, 'Giới thiệu bạn bè thành công', 'Nhận ' || v_referrer_reward || ' Xu thưởng giới thiệu', now());

  RETURN jsonb_build_object('success', true, 'referee_reward', v_referee_reward, 'referrer_reward', v_referrer_reward);
END;
$$;


ALTER FUNCTION "public"."apply_referral"("p_referrer_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_see"("viewer" "uuid", "target" "uuid", "level" "text") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select case
    when viewer is null   then false
    when viewer = target  then true
    when level = 'PUBLIC' then true
    when level = 'CLUB'   then public.shares_club(viewer, target)
    else false
  end
$$;


ALTER FUNCTION "public"."can_see"("viewer" "uuid", "target" "uuid", "level" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_view_activities"("target" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select public.can_view_profile(target)
     and public.can_see(
           auth.uid(), target,
           coalesce((select activity_visibility from public.profile_settings where user_id = target), 'PUBLIC'))
$$;


ALTER FUNCTION "public"."can_view_activities"("target" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_view_map"("target" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select public.can_view_activities(target)
     and public.can_see(
           auth.uid(), target,
           coalesce((select map_visibility from public.profile_settings where user_id = target), 'PRIVATE'))
$$;


ALTER FUNCTION "public"."can_view_map"("target" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_view_profile"("target" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select public.can_see(
    auth.uid(), target,
    coalesce((select profile_visibility from public.profile_settings where user_id = target), 'PUBLIC'))
$$;


ALTER FUNCTION "public"."can_view_profile"("target" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."club_rank"("p_role" "text") RETURNS integer
    LANGUAGE "sql" IMMUTABLE
    AS $$
  select case p_role when 'OWNER' then 3 when 'CAPTAIN' then 2 when 'MEMBER' then 1 else 0 end
$$;


ALTER FUNCTION "public"."club_rank"("p_role" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."club_role"("p_club" "uuid", "p_user" "uuid" DEFAULT "auth"."uid"()) RETURNS "text"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select m.role from public.club_members m
   where m.club_id = p_club and m.user_id = p_user and m.status = 'APPROVED'
   limit 1
$$;


ALTER FUNCTION "public"."club_role"("p_club" "uuid", "p_user" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."contribute_treasury"("p_club_id" "uuid", "p_amount" numeric) RETURNS numeric
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare v_balance numeric;
begin
  if p_amount is null or p_amount <= 0 then raise exception 'INVALID_AMOUNT'; end if;
  if public.club_role(p_club_id) is null then raise exception 'NOT_A_MEMBER'; end if;

  update public.profiles set xu = round(xu - p_amount, 1)
   where id = auth.uid() and xu >= p_amount;
  if not found then raise exception 'INSUFFICIENT_FUNDS'; end if;

  update public.clubs set treasury_balance = round(treasury_balance + p_amount, 1)
   where id = p_club_id
  returning treasury_balance into v_balance;

  insert into public.club_treasury_log (club_id, user_id, amount, kind)
  values (p_club_id, auth.uid(), p_amount, 'CONTRIBUTE');

  return v_balance;
end $$;


ALTER FUNCTION "public"."contribute_treasury"("p_club_id" "uuid", "p_amount" numeric) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_challenge_with_fee"("p_user_id" "uuid", "p_title" "text", "p_challenge_type" "text", "p_game_mode" "text", "p_target_km" numeric, "p_min_km" numeric, "p_min_members" integer, "p_fixed_team_size" integer, "p_target_audience" "text", "p_start_date" timestamp with time zone, "p_end_date" timestamp with time zone, "p_reg_deadline" timestamp with time zone, "p_min_pace" numeric, "p_max_pace" numeric, "p_fee" integer) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  current_xu INT;
  new_challenge_id UUID;
BEGIN
  -- 1. Khóa và kiểm tra số dư Xu hiện tại của người dùng
  SELECT xu INTO current_xu 
  FROM profiles 
  WHERE id = p_user_id 
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Không tìm thấy thông tin hồ sơ người dùng.';
  END IF;

  IF current_xu < p_fee THEN
    RAISE EXCEPTION 'Số dư không đủ. Bạn cần % Xu nhưng ví chỉ còn % Xu.', p_fee, current_xu;
  END IF;

  -- 2. Trừ Xu trong ví của VĐV
  UPDATE profiles 
  SET xu = xu - p_fee 
  WHERE id = p_user_id;

  -- 3. Tạo bản ghi thử thách mới
  INSERT INTO challenges (
    title, challenge_type, game_mode, target_type, target_km, 
    min_km, min_members, fixed_team_size, target_audience, 
    creator_role, start_date, end_date, reg_deadline, min_pace, max_pace, created_by
  ) VALUES (
    p_title, p_challenge_type, p_game_mode, 'DISTANCE', p_target_km,
    p_min_km, p_min_members, p_fixed_team_size, p_target_audience,
    'RACE DIRECTOR', p_start_date, p_end_date, p_reg_deadline, p_min_pace, p_max_pace, p_user_id
  )
  RETURNING id INTO new_challenge_id;

  -- Trả về kết quả thành công dưới dạng JSON
  RETURN json_build_object(
    'success', true,
    'challenge_id', new_challenge_id,
    'remaining_xu', current_xu - p_fee
  );
END;
$$;


ALTER FUNCTION "public"."create_challenge_with_fee"("p_user_id" "uuid", "p_title" "text", "p_challenge_type" "text", "p_game_mode" "text", "p_target_km" numeric, "p_min_km" numeric, "p_min_members" integer, "p_fixed_team_size" integer, "p_target_audience" "text", "p_start_date" timestamp with time zone, "p_end_date" timestamp with time zone, "p_reg_deadline" timestamp with time zone, "p_min_pace" numeric, "p_max_pace" numeric, "p_fee" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_challenge_with_fee"("p_user_id" "uuid", "p_title" "text", "p_challenge_type" "text", "p_game_mode" "text", "p_target_km" numeric, "p_min_km" numeric, "p_min_members" integer, "p_fixed_team_size" integer, "p_target_audience" "text", "p_start_date" timestamp with time zone, "p_end_date" timestamp with time zone, "p_reg_deadline" timestamp with time zone, "p_min_pace" numeric, "p_max_pace" numeric, "p_max_slots" integer, "p_fee" integer) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  current_xu INT;
  new_challenge_id UUID;
BEGIN
  -- 1. Kiểm tra số dư Xu hiện tại của người dùng
  SELECT xu INTO current_xu 
  FROM profiles 
  WHERE id = p_user_id 
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Không tìm thấy thông tin hồ sơ người dùng.';
  END IF;

  IF current_xu < p_fee THEN
    RAISE EXCEPTION 'Số dư không đủ. Thử thách quy mô này cần % Xu nhưng ví của bạn chỉ còn % Xu.', p_fee, current_xu;
  END IF;

  -- 2. Trừ Xu trong ví của VĐV
  UPDATE profiles 
  SET xu = xu - p_fee 
  WHERE id = p_user_id;

  -- 3. Tạo bản ghi thử thách kèm theo quy mô và mức phí tương ứng
  INSERT INTO challenges (
    title, challenge_type, game_mode, target_type, target_km, 
    min_km, min_members, fixed_team_size, target_audience, 
    creator_role, start_date, end_date, reg_deadline, min_pace, max_pace, 
    max_slots, calculated_fee, created_by
  ) VALUES (
    p_title, p_challenge_type, p_game_mode, 'DISTANCE', p_target_km,
    p_min_km, p_min_members, p_fixed_team_size, p_target_audience,
    'RACE DIRECTOR', p_start_date, p_end_date, p_reg_deadline, p_min_pace, p_max_pace,
    p_max_slots, p_fee, p_user_id
  )
  RETURNING id INTO new_challenge_id;

  RETURN json_build_object(
    'success', true,
    'challenge_id', new_challenge_id,
    'remaining_xu', current_xu - p_fee,
    'charged_fee', p_fee
  );
END;
$$;


ALTER FUNCTION "public"."create_challenge_with_fee"("p_user_id" "uuid", "p_title" "text", "p_challenge_type" "text", "p_game_mode" "text", "p_target_km" numeric, "p_min_km" numeric, "p_min_members" integer, "p_fixed_team_size" integer, "p_target_audience" "text", "p_start_date" timestamp with time zone, "p_end_date" timestamp with time zone, "p_reg_deadline" timestamp with time zone, "p_min_pace" numeric, "p_max_pace" numeric, "p_max_slots" integer, "p_fee" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_challenge_with_ledger"("p_user_id" "uuid", "p_title" "text", "p_challenge_type" "text", "p_game_mode" "text", "p_target_km" numeric, "p_min_km" numeric, "p_min_members" integer, "p_fixed_team_size" integer, "p_target_audience" "text", "p_start_date" timestamp with time zone, "p_end_date" timestamp with time zone, "p_reg_deadline" timestamp with time zone, "p_min_pace" numeric, "p_max_pace" numeric, "p_max_slots" integer, "p_idempotency_key" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_config JSONB;
  v_base_fee INT := 50;
  v_tier JSONB;
  v_type_mult NUMERIC := 1.0;
  v_duration_mult NUMERIC := 1.0;
  v_final_fee INT;
  v_duration_days INT;
  v_current_balance BIGINT;
  v_tx_id UUID;
  v_challenge_id UUID;
  system_account_id UUID := '00000000-0000-0000-0000-000000000000'::UUID; -- Tài khoản hệ thống thu phí
BEGIN
  -- 1. Chống bấm đúp (Idempotency check)
  IF EXISTS (SELECT 1 FROM ledger_transactions WHERE idempotency_key = p_idempotency_key) THEN
    RAISE EXCEPTION 'Giao dịch đã được xử lý trước đó (Idempotency duplicate).';
  END IF;

  -- 2. Đọc cấu hình phí đang PUBLISHED mới nhất từ server (Không tin client)
  SELECT config_value INTO v_config 
  FROM system_config_versions 
  WHERE config_key = 'challenge_fee_model_b' AND status = 'PUBLISHED' 
  ORDER BY version DESC 
  LIMIT 1;

  IF v_config IS NULL THEN
    v_base_fee := 50; -- Fallback an toàn
  ELSE
    -- Tìm bậc phí dựa theo max_slots
    FOR v_tier IN SELECT * FROM jsonb_array_elements(v_config->'tiers')
    LOOP
      IF p_max_slots >= (v_tier->>'min')::INT AND (v_tier->>'max' IS NULL OR p_max_slots <= (v_tier->>'max')::INT) THEN
        v_base_fee := (v_tier->>'fee')::INT;
      END IF;
    END LOOP;

    -- Hệ số theo loại (Cá nhân hay Đồng đội)
    IF p_challenge_type = 'TEAM' THEN
      v_type_mult := COALESCE((v_config->'multipliers'->>'type_team')::NUMERIC, 1.3);
    ELSE
      v_type_mult := COALESCE((v_config->'multipliers'->>'type_individual')::NUMERIC, 1.0);
    END IF;

    -- Hệ số theo thời lượng (Ngày kết thúc - Ngày bắt đầu)
    v_duration_days := EXTRACT(DAY FROM (p_end_date - p_start_date));
    IF v_duration_days > 30 THEN
      v_duration_mult := COALESCE((v_config->'multipliers'->>'duration_long')::NUMERIC, 1.5);
    ELSIF v_duration_days > 14 THEN
      v_duration_mult := COALESCE((v_config->'multipliers'->>'duration_mid_30d')::NUMERIC, 1.2);
    ELSE
      v_duration_mult := COALESCE((v_config->'multipliers'->>'duration_short_14d')::NUMERIC, 1.0);
    END IF;
  END IF;

  -- Tính phí cuối cùng (Làm tròn lên hoặc giữ nguyên số nguyên)
  v_final_fee := ROUND(v_base_fee * v_type_mult * v_duration_mult)::INT;

  -- 3. Kiểm tra số dư ví Xu Nạp (PAID) hoặc Xu Thưởng (BONUS) tổng cộng của user
  SELECT COALESCE(SUM(amount), 0) INTO v_current_balance
  FROM ledger_entries
  WHERE account_id = p_user_id;

  IF v_current_balance < v_final_fee THEN
    RAISE EXCEPTION 'Số dư không đủ. Phí tính toán từ hệ thống là % Xu, ví của bạn hiện có % Xu.', v_final_fee, v_current_balance;
  END IF;

  -- 4. Tạo bút toán Sổ cái kép (Ledger Transaction)
  INSERT INTO ledger_transactions (type, idempotency_key, reason, created_by)
  VALUES ('CHALLENGE_CREATION_FEE', p_idempotency_key, 'Phí khởi tạo thử thách (Mô hình B)', p_user_id)
  RETURNING id INTO v_tx_id;

  -- Trừ tiền ví người dùng
  INSERT INTO ledger_entries (transaction_id, account_id, coin_kind, amount)
  VALUES (v_tx_id, p_user_id, 'PAID', -v_final_fee);

  -- Cộng tiền vào tài khoản hệ thống (Doanh thu phí sàn)
  INSERT INTO ledger_entries (transaction_id, account_id, coin_kind, amount)
  VALUES (v_tx_id, system_account_id, 'PAID', v_final_fee);

  -- 5. Tạo bản ghi Thử thách mới kèm Snapshot cấu hình phí
  INSERT INTO challenges (
    title, challenge_type, game_mode, target_type, target_km, 
    min_km, min_members, fixed_team_size, target_audience, 
    creator_role, start_date, end_date, reg_deadline, min_pace, max_pace, 
    max_slots, calculated_fee, created_by
  ) VALUES (
    p_title, p_challenge_type, p_game_mode, 'DISTANCE', p_target_km,
    p_min_km, p_min_members, p_fixed_team_size, p_target_audience,
    'RACE DIRECTOR', p_start_date, p_end_date, p_reg_deadline, p_min_pace, p_max_pace,
    p_max_slots, v_final_fee, p_user_id
  )
  RETURNING id INTO v_challenge_id;

  -- 6. Đồng bộ số dư sang bảng profiles
  UPDATE profiles SET xu = xu - v_final_fee WHERE id = p_user_id;

  RETURN json_build_object(
    'success', true,
    'challenge_id', v_challenge_id,
    'charged_fee', v_final_fee,
    'remaining_balance', v_current_balance - v_final_fee
  );
END;
$$;


ALTER FUNCTION "public"."create_challenge_with_ledger"("p_user_id" "uuid", "p_title" "text", "p_challenge_type" "text", "p_game_mode" "text", "p_target_km" numeric, "p_min_km" numeric, "p_min_members" integer, "p_fixed_team_size" integer, "p_target_audience" "text", "p_start_date" timestamp with time zone, "p_end_date" timestamp with time zone, "p_reg_deadline" timestamp with time zone, "p_min_pace" numeric, "p_max_pace" numeric, "p_max_slots" integer, "p_idempotency_key" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_club"("p_name" "text", "p_description" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
    _user_id UUID;
    _club RECORD;
    _invite_code TEXT;
BEGIN
    _user_id := auth.uid();
    IF _user_id IS NULL THEN
        RAISE EXCEPTION 'AUTH_REQUIRED';
    END IF;

    IF p_name IS NULL OR trim(p_name) = '' THEN
        RAISE EXCEPTION 'NAME_REQUIRED';
    END IF;
    
    IF length(p_name) > 60 THEN
        RAISE EXCEPTION 'NAME_TOO_LONG';
    END IF;

    _invite_code := encode(gen_random_bytes(3), 'hex');

    INSERT INTO clubs (name, description, owner_id, invite_code, treasury_balance, member_count)
    VALUES (trim(p_name), p_description, _user_id, _invite_code, 100, 1)
    RETURNING * INTO _club;

    INSERT INTO club_members (club_id, user_id, role, status)
    VALUES (_club.id, _user_id, 'OWNER', 'APPROVED');

    RETURN to_jsonb(_club);
END;
$$;


ALTER FUNCTION "public"."create_club"("p_name" "text", "p_description" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."delete_club"("p_club_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    _user_id UUID;
    _club RECORD;
    _role TEXT;
BEGIN
    _user_id := auth.uid();
    IF _user_id IS NULL THEN
        RAISE EXCEPTION 'AUTH_REQUIRED';
    END IF;

    -- Lấy thông tin CLB
    SELECT * INTO _club FROM clubs WHERE id = p_club_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'CLUB_NOT_FOUND';
    END IF;

    -- Kiểm tra role của user trong club_members (hoặc là owner_id của bảng clubs)
    SELECT role INTO _role FROM club_members 
    WHERE club_id = p_club_id AND user_id = _user_id;

    IF _club.owner_id <> _user_id AND _role NOT IN ('OWNER', 'CAPTAIN') THEN
        RAISE EXCEPTION 'NOT_AUTHORIZED';
    END IF;

    -- Tiến hành xóa CLB
    DELETE FROM clubs WHERE id = p_club_id;
END;
$$;


ALTER FUNCTION "public"."delete_club"("p_club_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."delete_club"("p_club_id" "uuid", "p_confirm_name" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
    _user_id UUID;
    _club RECORD;
BEGIN
    -- 1. Lấy ID user đang đăng nhập
    _user_id := auth.uid();
    IF _user_id IS NULL THEN
        RAISE EXCEPTION 'AUTH_REQUIRED';
    END IF;

    -- 2. Lấy thông tin CLB
    SELECT * INTO _club FROM clubs WHERE id = p_club_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'CLUB_NOT_FOUND';
    END IF;

    -- 3. Kiểm tra xem user có phải là chủ sở hữu (owner) hoặc có role OWNER trong club_members không
    IF _club.owner_id <> _user_id AND NOT EXISTS (
        SELECT 1 FROM club_members 
        WHERE club_id = p_club_id AND user_id = _user_id AND role = 'OWNER' AND status = 'APPROVED'
    ) THEN
        RAISE EXCEPTION 'NOT_AUTHORIZED';
    END IF;

    -- 4. Kiểm tra tên xác nhận có khớp không
    IF trim(lower(p_confirm_name)) <> trim(lower(_club.name)) THEN
        RAISE EXCEPTION 'WRONG_NAME';
    END IF;

    -- 5. Thực hiện xóa CLB (Cascade sẽ tự động xóa các bảng liên quan như club_members, v.v.)
    DELETE FROM clubs WHERE id = p_club_id;
END;
$$;


ALTER FUNCTION "public"."delete_club"("p_club_id" "uuid", "p_confirm_name" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."equip_avatar_item"("p_item_id" "uuid", "p_category" "text") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $_$
DECLARE
    v_user_id UUID;
    v_item_exists BOOLEAN;
    v_item_category TEXT;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Unauthorized';
    END IF;

    -- Kiểm tra user có sở hữu item này trong inventory không
    SELECT EXISTS (
        SELECT 1 FROM public.user_inventory 
        WHERE user_id = v_user_id AND item_id = p_item_id
    ) INTO v_item_exists;

    IF NOT v_item_exists THEN
        RAISE EXCEPTION 'Item not owned by user';
    END IF;

    -- Lấy category của item
    SELECT category INTO v_item_category 
    FROM public.avatar_items 
    WHERE id = p_item_id;

    IF v_item_category <> p_category THEN
        RAISE EXCEPTION 'Category mismatch';
    END IF;

    -- Đảm bảo user_equipment đã tồn tại dòng dữ liệu
    INSERT INTO public.user_equipment (user_id)
    VALUES (v_user_id)
    ON CONFLICT (user_id) DO NOTHING;

    -- Cập nhật đúng slot tương ứng
    EXECUTE format(
        'UPDATE public.user_equipment SET %I = $1, updated_at = now() WHERE user_id = $2',
        p_category || '_item_id'
    ) USING p_item_id, v_user_id;

    RETURN TRUE;
END;
$_$;


ALTER FUNCTION "public"."equip_avatar_item"("p_item_id" "uuid", "p_category" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."execute_ledger_transaction"("p_type" "text", "p_idempotency_key" "text", "p_reason" "text", "p_created_by" "uuid", "p_entries" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_tx_id UUID;
  v_entry JSONB;
  v_sum BIGINT := 0;
  v_acc_id UUID;
  v_kind TEXT;
  v_amt BIGINT;
  v_current_balance BIGINT;
BEGIN
  -- 1. Kiểm tra khóa chống trùng lặp (Idempotency)
  IF EXISTS (SELECT 1 FROM ledger_transactions WHERE idempotency_key = p_idempotency_key) THEN
    RAISE EXCEPTION 'Giao dịch đã tồn tại (Idempotency violation).';
  END IF;

  -- 2. Kiểm tra tổng số dư các bút toán có cân bằng (= 0) hay không
  FOR v_entry IN SELECT * FROM jsonb_array_elements(p_entries)
  LOOP
    v_sum := v_sum + (v_entry->>'amount')::BIGINT;
  END LOOP;

  IF v_sum <> 0 THEN
    RAISE EXCEPTION 'Bút toán sổ cái không cân bằng (Tổng amount phải bằng 0, hiện tại = %).', v_sum;
  END IF;

  -- 3. Tạo Transaction Header
  INSERT INTO ledger_transactions (type, idempotency_key, reason, created_by)
  VALUES (p_type, p_idempotency_key, p_reason, p_created_by)
  RETURNING id INTO v_tx_id;

  -- 4. Duyệt qua từng bút toán, kiểm tra chống âm ví và ghi sổ
  FOR v_entry IN SELECT * FROM jsonb_array_elements(p_entries)
  LOOP
    v_acc_id := (v_entry->>'account_id')::UUID;
    v_kind := v_entry->>'coin_kind';
    v_amt := (v_entry->>'amount')::BIGINT;

    -- Nếu là chiều tiền ra (âm), kiểm tra xem ví có đủ số dư cộng dồn từ trước không
    IF v_amt < 0 THEN
      SELECT COALESCE(SUM(amount), 0) INTO v_current_balance
      FROM ledger_entries
      WHERE account_id = v_acc_id AND coin_kind = v_kind;

      IF v_current_balance + v_amt < 0 THEN
        RAISE EXCEPTION 'Số dư ví không đủ để thực hiện giao dịch (Ví hiện tại: %, Cần trừ: %).', v_current_balance, ABS(v_amt);
      END IF;
    END IF;

    -- Thêm bút toán vào sổ cái
    INSERT INTO ledger_entries (transaction_id, account_id, coin_kind, amount)
    VALUES (v_tx_id, v_acc_id, v_kind, v_amt);
  END LOOP;

  -- 5. Đồng bộ số dư vào bảng profiles (để tối ưu hiển thị nhanh, nhưng bản chất vẫn lấy từ ledger)
  -- Cập nhật lại xu tổng trong profiles dựa trên tổng ledger của user đó
  UPDATE profiles p
  SET xu = sub.total_xu
  FROM (
    SELECT account_id, COALESCE(SUM(amount), 0) AS total_xu
    FROM ledger_entries
    WHERE account_id IN (
      SELECT DISTINCT (e->>'account_id')::UUID 
      FROM jsonb_array_elements(p_entries) e
    )
    GROUP BY account_id
  ) sub
  WHERE p.id = sub.account_id;

  RETURN json_build_object('success', true, 'transaction_id', v_tx_id);
END;
$$;


ALTER FUNCTION "public"."execute_ledger_transaction"("p_type" "text", "p_idempotency_key" "text", "p_reason" "text", "p_created_by" "uuid", "p_entries" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_active_config"("p_key" "text") RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select jsonb_build_object(
           'version', version,
           'value', value,
           'effective_from', effective_from)
  from public.config_versions
  where config_key = p_key and effective_from <= now()
  order by effective_from desc, version desc
  limit 1;
$$;


ALTER FUNCTION "public"."get_active_config"("p_key" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_activity_route"("p_activity_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare v_owner uuid;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  select user_id into v_owner from public.activities where id = p_activity_id;
  if v_owner is null or not public.can_view_map(v_owner) then return null; end if;

  return (
    select jsonb_agg(jsonb_build_array(latitude, longitude) order by sequence)
    from (
      select latitude, longitude, sequence,
             row_number() over (order by sequence) as rn,
             count(*) over () as cnt
      from public.activity_track_points
      where activity_id = p_activity_id
    ) s
    where rn % greatest(cnt / 300, 1) = 0
  );
end $$;


ALTER FUNCTION "public"."get_activity_route"("p_activity_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_athlete_profile"("p_user_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_uid         uuid := auth.uid();
  p             public.profiles%rowtype;
  s             public.profile_settings%rowtype;
  v_can_profile boolean;
  v_can_acts    boolean;
  v_stats       jsonb := null;
  v_clubs       jsonb := '[]'::jsonb;
  v_now         timestamp := (now() at time zone 'Asia/Ho_Chi_Minh');
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;

  select * into p from public.profiles where id = p_user_id;
  if not found then return null; end if;

  select * into s from public.profile_settings where user_id = p_user_id;

  v_can_profile := public.can_view_profile(p_user_id);
  v_can_acts    := public.can_view_activities(p_user_id);

  -- Hồ sơ riêng tư: chỉ lộ tên và ảnh (như Strava)
  if not v_can_profile then
    return jsonb_build_object(
      'id', p.id, 'display_name', p.display_name, 'avatar_url', p.avatar_url,
      'can_view_profile', false, 'is_self', false);
  end if;

  if v_can_acts then
    select jsonb_build_object(
      'week',  jsonb_build_object(
                 'distance_m', coalesce(sum(d) filter (where ts >= date_trunc('week',  v_now)), 0),
                 'time_s',     coalesce(sum(t) filter (where ts >= date_trunc('week',  v_now)), 0),
                 'count',      count(*)        filter (where ts >= date_trunc('week',  v_now))),
      'month', jsonb_build_object(
                 'distance_m', coalesce(sum(d) filter (where ts >= date_trunc('month', v_now)), 0),
                 'time_s',     coalesce(sum(t) filter (where ts >= date_trunc('month', v_now)), 0),
                 'count',      count(*)        filter (where ts >= date_trunc('month', v_now))),
      'year',  jsonb_build_object(
                 'distance_m', coalesce(sum(d) filter (where ts >= date_trunc('year',  v_now)), 0),
                 'time_s',     coalesce(sum(t) filter (where ts >= date_trunc('year',  v_now)), 0),
                 'count',      count(*)        filter (where ts >= date_trunc('year',  v_now))),
      'all',   jsonb_build_object(
                 'distance_m', coalesce(sum(d), 0),
                 'time_s',     coalesce(sum(t), 0),
                 'count',      count(*))
    ) into v_stats
    from (
      select coalesce(a.moving_distance_m, a.distance_m, 0)          as d,
             coalesce(a.moving_time_s, a.elapsed_time_s, 0)          as t,
             (a.started_at at time zone 'Asia/Ho_Chi_Minh')          as ts
      from public.activities a
      where a.user_id = p_user_id
        and public.activity_is_countable(a.status, a.validation_status)
    ) x;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'avatar_url', c.avatar_url) order by c.name), '[]'::jsonb)
    into v_clubs
  from public.club_members m
  join public.clubs c on c.id = m.club_id
  where m.user_id = p_user_id and m.status = 'APPROVED';

  return jsonb_build_object(
    'id', p.id,
    'display_name', p.display_name,
    'avatar_url', p.avatar_url,
    'level', p.level,
    'xp', p.xp,
    'joined_at', p.created_at,
    'region', s.region,
    'is_self', v_uid = p_user_id,
    'can_view_profile', true,
    'can_view_activities', v_can_acts,
    'stats', v_stats,
    'clubs', v_clubs
  );
end $$;


ALTER FUNCTION "public"."get_athlete_profile"("p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_challenge_fee"("p_max_participants" integer) RETURNS TABLE("fee" integer, "config_version" integer)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_cfg jsonb := public.get_active_config('challenge_fee_tiers');
  t jsonb;
begin
  if v_cfg is null then
    raise exception 'Chưa có cấu hình biểu phí';
  end if;
  if p_max_participants is null or p_max_participants < 1 then
    raise exception 'Số VĐV không hợp lệ';
  end if;

  for t in select * from jsonb_array_elements(v_cfg -> 'value' -> 'tiers') loop
    if p_max_participants >= (t ->> 'min')::int
       and ((t ->> 'max') is null or p_max_participants <= (t ->> 'max')::int) then
      fee := (t ->> 'fee')::int;
      config_version := (v_cfg ->> 'version')::int;
      return next;
      return;
    end if;
  end loop;
  raise exception 'Không tìm thấy bậc phí phù hợp';
end;
$$;


ALTER FUNCTION "public"."get_challenge_fee"("p_max_participants" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name, avatar_url)
  VALUES (
    new.id,
    COALESCE(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    new.raw_user_meta_data->>'avatar_url'
  );
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."has_permission"("p_user_id" "uuid", "p_club_id" "uuid", "p_permission_code" "text") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    _is_owner BOOLEAN;
    _has_perm BOOLEAN;
BEGIN
    -- 1. Kiểm tra xem user có phải là chủ sở hữu trực tiếp của CLB không
    SELECT EXISTS (
        SELECT 1 FROM clubs WHERE id = p_club_id AND owner_id = p_user_id
    ) INTO _is_owner;

    IF _is_owner THEN
        RETURN TRUE;
    END IF;

    -- 2. Kiểm tra thông qua hệ thống Role & Permission động
    SELECT EXISTS (
        SELECT 1
        FROM club_members cm
        JOIN club_member_roles cmr ON cm.id = cmr.club_member_id
        JOIN role_permissions rp ON cmr.role_id = rp.role_id
        JOIN permissions p ON rp.permission_id = p.id
        WHERE cm.club_id = p_club_id
          AND cm.user_id = p_user_id
          AND cm.status = 'APPROVED'
          AND p.code = p_permission_code
    ) INTO _has_perm;

    RETURN COALESCE(_has_perm, FALSE);
END;
$$;


ALTER FUNCTION "public"."has_permission"("p_user_id" "uuid", "p_club_id" "uuid", "p_permission_code" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_system_admin"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'SYSTEM_ADMIN'
  );
$$;


ALTER FUNCTION "public"."is_system_admin"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."club_members" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "club_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "role" "text" DEFAULT 'MEMBER'::"text",
    "joined_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "status" "text" DEFAULT 'APPROVED'::"text",
    CONSTRAINT "club_members_role_check" CHECK (("role" = ANY (ARRAY['OWNER'::"text", 'ADMIN'::"text", 'MEMBER'::"text"]))),
    CONSTRAINT "club_members_role_chk" CHECK (("role" = ANY (ARRAY['OWNER'::"text", 'CAPTAIN'::"text", 'MEMBER'::"text"]))),
    CONSTRAINT "club_members_status_check" CHECK (("status" = ANY (ARRAY['PENDING'::"text", 'APPROVED'::"text", 'REJECTED'::"text"]))),
    CONSTRAINT "club_members_status_chk" CHECK (("status" = ANY (ARRAY['PENDING'::"text", 'APPROVED'::"text", 'REJECTED'::"text", 'BANNED'::"text"])))
);


ALTER TABLE "public"."club_members" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."join_club"("p_club_id" "uuid") RETURNS "public"."club_members"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare v_club public.clubs; v_row public.club_members; v_cur public.club_members; v_status text;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;

  select * into v_club from public.clubs where id = p_club_id;
  if v_club.id is null then raise exception 'CLUB_NOT_FOUND'; end if;
  if v_club.join_policy = 'INVITE_ONLY' then raise exception 'INVITE_ONLY'; end if;
  if v_club.member_count >= v_club.member_limit then raise exception 'CLUB_FULL'; end if;

  select * into v_cur from public.club_members
   where club_id = p_club_id and user_id = auth.uid();

  if v_cur.id is not null then
    if v_cur.status = 'BANNED' then raise exception 'BANNED'; end if;
    if v_cur.status in ('PENDING','APPROVED') then raise exception 'ALREADY_MEMBER'; end if;
  end if;

  v_status := case when v_club.join_policy = 'OPEN' then 'APPROVED' else 'PENDING' end;

  insert into public.club_members (club_id, user_id, role, status)
  values (p_club_id, auth.uid(), 'MEMBER', v_status)
  on conflict (club_id, user_id)
    do update set status = excluded.status, role = 'MEMBER', joined_at = now()
  returning * into v_row;

  return v_row;
end $$;


ALTER FUNCTION "public"."join_club"("p_club_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."join_club_by_code"("p_code" "text") RETURNS "public"."club_members"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare v_id uuid;
begin
  select id into v_id from public.clubs where invite_code = lower(trim(p_code));
  if v_id is null then raise exception 'INVALID_INVITE'; end if;
  return public.join_club(v_id);
end $$;


ALTER FUNCTION "public"."join_club_by_code"("p_code" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."leave_club"("p_club_id" "uuid", "p_new_owner_id" "uuid" DEFAULT NULL::"uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_role text;
  v_member_count int;
  v_next_owner uuid;
begin
  select role into v_role
  from club_members
  where club_id = p_club_id and user_id = auth.uid();

  if v_role is null then
    raise exception 'NOT_A_MEMBER';
  end if;

  if v_role <> 'OWNER' then
    delete from club_members
    where club_id = p_club_id and user_id = auth.uid();
    return;
  end if;

  -- Từ đây: caller là OWNER
  select count(*) into v_member_count
  from club_members
  where club_id = p_club_id and user_id <> auth.uid();

  if v_member_count = 0 then
    raise exception 'LAST_MEMBER_MUST_DELETE';
  end if;

  if p_new_owner_id is not null then
    if p_new_owner_id = auth.uid() then
      raise exception 'CANNOT_TRANSFER_TO_SELF';
    end if;

    if not exists (
      select 1 from club_members
      where club_id = p_club_id and user_id = p_new_owner_id
    ) then
      raise exception 'TARGET_NOT_MEMBER';
    end if;

    v_next_owner := p_new_owner_id;
  else
    -- tự động chọn phó chủ nhiệm vào CLB sớm nhất
    select user_id into v_next_owner
    from club_members
    where club_id = p_club_id and role = 'VICE'
    order by joined_at asc
    limit 1;

    if v_next_owner is null then
      raise exception 'MUST_ASSIGN_NEW_OWNER';
    end if;
  end if;

  update club_members set role = 'OWNER'
  where club_id = p_club_id and user_id = v_next_owner;

  delete from club_members
  where club_id = p_club_id and user_id = auth.uid();
end;
$$;


ALTER FUNCTION "public"."leave_club"("p_club_id" "uuid", "p_new_owner_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."list_athlete_activities"("p_user_id" "uuid", "p_limit" integer DEFAULT 10, "p_offset" integer DEFAULT 0) RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare v_can_map boolean;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if not public.can_view_activities(p_user_id) then return '[]'::jsonb; end if;

  v_can_map := public.can_view_map(p_user_id);

  return coalesce((
    select jsonb_agg(to_jsonb(t)) from (
      select a.id,
             a.title,
             a.source,
             a.started_at,
             coalesce(a.moving_distance_m, a.distance_m, 0)  as distance_m,
             coalesce(a.moving_time_s, a.elapsed_time_s, 0)  as moving_time_s,
             a.avg_pace_s,
             a.elevation_gain_m,
             (v_can_map and exists (select 1 from public.activity_track_points tp where tp.activity_id = a.id)) as has_map
      from public.activities a
      where a.user_id = p_user_id
        and public.activity_is_countable(a.status, a.validation_status)
      order by a.started_at desc nulls last
      limit least(greatest(p_limit, 1), 50) offset greatest(p_offset, 0)
    ) t
  ), '[]'::jsonb);
end $$;


ALTER FUNCTION "public"."list_athlete_activities"("p_user_id" "uuid", "p_limit" integer, "p_offset" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."publish_config"("p_key" "text", "p_value" "jsonb", "p_effective_from" timestamp with time zone DEFAULT NULL::timestamp with time zone, "p_reason" "text" DEFAULT NULL::"text") RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_next int;
  v_old  jsonb;
  v_eff  timestamptz := coalesce(p_effective_from, now());
begin
  if auth.uid() is null or not public.is_system_admin() then
    raise exception 'Bạn không có quyền thay đổi cấu hình';
  end if;
  if p_reason is null or length(trim(p_reason)) < 3 then
    raise exception 'Cần nhập lý do thay đổi';
  end if;
  if p_effective_from is not null and p_effective_from < now() - interval '1 minute' then
    raise exception 'Ngày hiệu lực không được ở quá khứ';
  end if;

  if p_key = 'challenge_fee_tiers' then
    perform public.validate_fee_tiers(p_value -> 'tiers');
  else
    raise exception 'Khóa cấu hình "%" chưa được hỗ trợ', p_key;
  end if;

  perform pg_advisory_xact_lock(hashtext(p_key));

  select coalesce(max(version), 0) + 1 into v_next
  from public.config_versions where config_key = p_key;

  v_old := public.get_active_config(p_key) -> 'value';

  insert into public.config_versions (config_key, version, value, effective_from, reason, created_by)
  values (p_key, v_next, p_value, v_eff, trim(p_reason), auth.uid());

  insert into public.admin_audit_log (actor_id, action, target, old_value, new_value, reason)
  values (auth.uid(), 'PUBLISH_CONFIG', p_key || ' v' || v_next, v_old, p_value, trim(p_reason));

  return v_next;
end;
$$;


ALTER FUNCTION "public"."publish_config"("p_key" "text", "p_value" "jsonb", "p_effective_from" timestamp with time zone, "p_reason" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."remove_member"("p_member_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare v_row public.club_members; v_me text;
begin
  select * into v_row from public.club_members where id = p_member_id;
  if v_row.id is null then return; end if;

  v_me := public.club_role(v_row.club_id);
  if v_row.user_id = auth.uid() then
    if v_row.role = 'OWNER' then raise exception 'OWNER_CANNOT_LEAVE'; end if;
  else
    if v_me is null or public.club_rank(v_me) <= public.club_rank(v_row.role) then
      raise exception 'FORBIDDEN';
    end if;
  end if;

  delete from public.club_members where id = p_member_id;
end $$;


ALTER FUNCTION "public"."remove_member"("p_member_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."review_activity"("p_activity_id" "uuid", "p_status" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_role text; v_club uuid; v_runner uuid; v_runner_club uuid;
begin
  if p_status not in ('APPROVED', 'REJECTED') then
    raise exception 'Trạng thái không hợp lệ';
  end if;

  select role, club_id into v_role, v_club from public.profiles where id = auth.uid();
  if v_role not in ('SYSTEM_ADMIN', 'CLUB_ADMIN') then
    raise exception 'Bạn không có quyền duyệt hoạt động';
  end if;

  select user_id into v_runner from public.activities
  where id = p_activity_id and validation_status = 'PENDING';
  if v_runner is null then
    raise exception 'Hoạt động không tồn tại hoặc đã được xử lý';
  end if;

  if v_role = 'CLUB_ADMIN' then
    select club_id into v_runner_club from public.profiles where id = v_runner;
    if v_club is null or v_runner_club is distinct from v_club then
      raise exception 'Chỉ được duyệt hoạt động của thành viên trong CLB của bạn';
    end if;
  end if;

  update public.activities
  set validation_status = p_status,
      status = case when p_status = 'APPROVED' then 'COMPLETED' else 'REJECTED' end
  where id = p_activity_id;

  insert into public.admin_audit_log (actor_id, action, target, new_value)
  values (auth.uid(), 'REVIEW_ACTIVITY', p_activity_id::text, jsonb_build_object('status', p_status));
end;
$$;


ALTER FUNCTION "public"."review_activity"("p_activity_id" "uuid", "p_status" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rotate_invite_code"("p_club_id" "uuid") RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare v_code text;
begin
  if public.club_role(p_club_id) not in ('OWNER','CAPTAIN') then raise exception 'FORBIDDEN'; end if;

  loop
    v_code := encode(gen_random_bytes(6), 'hex');
    exit when not exists (select 1 from public.clubs where invite_code = v_code);
  end loop;

  update public.clubs set invite_code = v_code where id = p_club_id;
  return v_code;
end $$;


ALTER FUNCTION "public"."rotate_invite_code"("p_club_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."safe_uuid"("p_text" "text") RETURNS "uuid"
    LANGUAGE "plpgsql" IMMUTABLE
    AS $$
begin
  return p_text::uuid;
exception when others then
  return null;
end $$;


ALTER FUNCTION "public"."safe_uuid"("p_text" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."search_athletes"("p_query" "text", "p_limit" integer DEFAULT 20) RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare v_q text := trim(coalesce(p_query, ''));
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if char_length(v_q) < 2 then return '[]'::jsonb; end if;

  v_q := replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_');

  return coalesce((
    select jsonb_agg(to_jsonb(t)) from (
      select p.id, p.display_name, p.avatar_url, p.level, s.region
      from public.profiles p
      left join public.profile_settings s on s.user_id = p.id
      where p.display_name ilike '%' || v_q || '%'
        and p.id <> auth.uid()
        and coalesce(s.profile_visibility, 'PUBLIC') <> 'PRIVATE'
      order by p.level desc nulls last, p.display_name
      limit least(greatest(p_limit, 1), 30)
    ) t
  ), '[]'::jsonb);
end $$;


ALTER FUNCTION "public"."search_athletes"("p_query" "text", "p_limit" integer) OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."clubs" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "logo_url" "text",
    "owner_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "treasury_balance" numeric(12,1) DEFAULT 0,
    "avatar_url" "text",
    "member_count" integer DEFAULT 0 NOT NULL,
    "member_limit" integer DEFAULT 200 NOT NULL,
    "join_policy" "text" DEFAULT 'APPROVAL'::"text" NOT NULL,
    "invite_code" "text" NOT NULL,
    "announcement" "text",
    "announced_at" timestamp with time zone,
    "announced_by" "uuid",
    "avatar_path" "text",
    CONSTRAINT "clubs_join_policy_chk" CHECK (("join_policy" = ANY (ARRAY['OPEN'::"text", 'APPROVAL'::"text", 'INVITE_ONLY'::"text"]))),
    CONSTRAINT "clubs_member_limit_chk" CHECK ((("member_limit" >= 2) AND ("member_limit" <= 1000))),
    CONSTRAINT "clubs_treasury_nonneg" CHECK (("treasury_balance" >= (0)::numeric))
);


ALTER TABLE "public"."clubs" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_club_announcement"("p_club_id" "uuid", "p_text" "text") RETURNS "public"."clubs"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare v_club public.clubs;
begin
  if public.club_role(p_club_id) not in ('OWNER','CAPTAIN') then raise exception 'FORBIDDEN'; end if;
  if char_length(coalesce(p_text, '')) > 500 then raise exception 'ANNOUNCEMENT_TOO_LONG'; end if;

  update public.clubs
     set announcement = nullif(trim(coalesce(p_text, '')), ''),
         announced_at = case when nullif(trim(coalesce(p_text, '')), '') is null then null else now() end,
         announced_by = case when nullif(trim(coalesce(p_text, '')), '') is null then null else auth.uid() end
   where id = p_club_id
  returning * into v_club;

  return v_club;
end $$;


ALTER FUNCTION "public"."set_club_announcement"("p_club_id" "uuid", "p_text" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_member_role"("p_member_id" "uuid", "p_role" "text") RETURNS "public"."club_members"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare v_row public.club_members;
begin
  if p_role not in ('CAPTAIN','MEMBER') then raise exception 'INVALID_ROLE'; end if;

  select * into v_row from public.club_members where id = p_member_id;
  if v_row.id is null then raise exception 'MEMBER_NOT_FOUND'; end if;
  if public.club_role(v_row.club_id) <> 'OWNER' then raise exception 'FORBIDDEN'; end if;
  if v_row.role = 'OWNER' then raise exception 'FORBIDDEN'; end if;
  if v_row.status <> 'APPROVED' then raise exception 'TARGET_NOT_APPROVED'; end if;

  update public.club_members set role = p_role where id = p_member_id returning * into v_row;
  return v_row;
end $$;


ALTER FUNCTION "public"."set_member_role"("p_member_id" "uuid", "p_role" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_member_status"("p_member_id" "uuid", "p_status" "text") RETURNS "public"."club_members"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare v_row public.club_members; v_me text; v_club public.clubs;
begin
  if p_status not in ('APPROVED','REJECTED','BANNED') then raise exception 'INVALID_STATUS'; end if;

  select * into v_row from public.club_members where id = p_member_id;
  if v_row.id is null then raise exception 'MEMBER_NOT_FOUND'; end if;

  v_me := public.club_role(v_row.club_id);
  if v_me not in ('OWNER','CAPTAIN') then raise exception 'FORBIDDEN'; end if;
  if v_row.role = 'OWNER' then raise exception 'FORBIDDEN'; end if;
  if public.club_rank(v_me) <= public.club_rank(v_row.role) then raise exception 'FORBIDDEN'; end if;

  if p_status = 'APPROVED' then
    select * into v_club from public.clubs where id = v_row.club_id;
    if v_club.member_count >= v_club.member_limit then raise exception 'CLUB_FULL'; end if;
  end if;

  update public.club_members
     set status = p_status,
         joined_at = case when p_status = 'APPROVED' then now() else joined_at end
   where id = p_member_id
  returning * into v_row;

  return v_row;
end $$;


ALTER FUNCTION "public"."set_member_status"("p_member_id" "uuid", "p_status" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."shares_club"("a" "uuid", "b" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1
    from public.club_members x
    join public.club_members y on y.club_id = x.club_id
    where x.user_id = a and y.user_id = b
      and x.status = 'APPROVED' and y.status = 'APPROVED'
  )
$$;


ALTER FUNCTION "public"."shares_club"("a" "uuid", "b" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."submit_and_process_activity"("p_user_id" "uuid", "p_title" "text", "p_source" "text", "p_started_at" timestamp with time zone, "p_ended_at" timestamp with time zone, "p_elapsed_s" integer, "p_moving_s" integer, "p_distance_m" numeric, "p_avg_pace_s" integer, "p_track_points" "jsonb") RETURNS json
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
    v_activity_id UUID;
    v_km NUMERIC;
    v_validation_status TEXT := 'VALID';
    v_validation_reason TEXT := 'Hoạt động hợp lệ qua hệ thống kiểm tra tự động.';
    v_earned_xp INT := 0;
    v_earned_xu NUMERIC := 0;
    v_current_xp INT;
    v_current_xu NUMERIC;
    v_new_xp INT;
    v_new_xu NUMERIC;
    v_new_level INT;
    v_part RECORD;
    v_challenge RECORD;
    v_point JSONB;
    v_seq INT := 0;
BEGIN
    v_km := p_distance_m / 1000.0;

    -- 1. Validation Engine phía Server
    IF v_km < 0.2 THEN
        v_validation_status := 'REJECTED';
        v_validation_reason := 'Quá ngắn (< 200m), không đủ điều kiện ghi nhận.';
    ELSIF p_avg_pace_s > 0 AND p_avg_pace_s < 150 AND v_km > 0.5 THEN
        v_validation_status := 'REVIEW';
        v_validation_reason := 'Tốc độ trung bình quá nhanh bất thường (< 2:30/km).';
    END IF;

    -- 2. Insert Activity
    INSERT INTO activities (
        user_id, title, source, started_at, ended_at, 
        elapsed_time_s, moving_time_s, distance_m, moving_distance_m, 
        avg_pace_s, status, validation_status, validation_reason
    ) VALUES (
        p_user_id, p_title, p_source, p_started_at, p_ended_at,
        p_elapsed_s, p_moving_s, p_distance_m, p_distance_m,
        p_avg_pace_s, 'READY', v_validation_status, v_validation_reason
    ) RETURNING id INTO v_activity_id;

    -- 3. Insert Track Points từ JSONB array
    IF jsonb_array_length(p_track_points) > 0 THEN
        FOR v_point IN SELECT * FROM jsonb_array_elements(p_track_points)
        LOOP
            v_seq := v_seq + 1;
            INSERT INTO activity_track_points (
                activity_id, sequence, latitude, longitude, accuracy, altitude, speed, recorded_at
            ) VALUES (
                v_activity_id,
                v_seq,
                (v_point->>'latitude')::NUMERIC,
                (v_point->>'longitude')::NUMERIC,
                (v_point->>'accuracy')::NUMERIC,
                (v_point->>'altitude')::NUMERIC,
                (v_point->>'speed')::NUMERIC,
                (v_point->>'recorded_at')::TIMESTAMPTZ
            );
        END LOOP;
    END IF;

    -- 4. Nếu VALID -> Phân phối Thưởng & Cập nhật Challenge
    IF v_validation_status = 'VALID' THEN
        v_earned_xp := ROUND(v_km * 50);
        v_earned_xu := ROUND((v_km * 5)::NUMERIC, 1);

        -- Lấy thông tin profile hiện tại
        SELECT xp, xu INTO v_current_xp, v_current_xu FROM profiles WHERE id = p_user_id;
        v_current_xp := COALESCE(v_current_xp, 0);
        v_current_xu := COALESCE(v_current_xu, 0);

        v_new_xp := v_current_xp + v_earned_xp;
        v_new_xu := v_current_xu + v_earned_xu;
        v_new_level := FLOOR(v_new_xp / 500.0) + 1;

        -- Update Profile an toàn từ server
        UPDATE profiles SET xp = v_new_xp, xu = v_new_xu, level = v_new_level WHERE id = p_user_id;

        -- Ghi Ledger chống trùng lặp qua Unique Constraint
        INSERT INTO wallet_transactions (profile_id, amount, transaction_type, reference_id)
        VALUES (p_user_id, v_earned_xu, 'RUN_REWARD', v_activity_id);

        -- 5. Challenge Engine (Đánh giá quy tắc thử thách)
        FOR v_part IN 
            SELECT cp.id, cp.challenge_id, cp.current_progress 
            FROM challenge_participants cp
            JOIN challenges c ON c.id = cp.challenge_id
            WHERE cp.profile_id = p_user_id 
              AND cp.status = 'JOINED'
              AND c.status = 'ACTIVE'
              AND p_started_at >= c.start_at 
              AND p_started_at <= c.end_at
        LOOP
            -- Cập nhật tiến độ tích lũy theo km hợp lệ
            UPDATE challenge_participants 
            SET current_progress = ROUND((current_progress + v_km)::NUMERIC, 2)
            WHERE id = v_part.id;
        END LOOP;
    END IF;

    RETURN json_build_object(
        'success', true,
        'activity_id', v_activity_id,
        'validation_status', v_validation_status,
        'validation_reason', v_validation_reason,
        'earned_xp', v_earned_xp,
        'earned_xu', v_earned_xu
    );
END;
$$;


ALTER FUNCTION "public"."submit_and_process_activity"("p_user_id" "uuid", "p_title" "text", "p_source" "text", "p_started_at" timestamp with time zone, "p_ended_at" timestamp with time zone, "p_elapsed_s" integer, "p_moving_s" integer, "p_distance_m" numeric, "p_avg_pace_s" integer, "p_track_points" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_club_member_count"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  update public.clubs c
     set member_count = (
       select count(*) from public.club_members m
        where m.club_id = c.id and m.status = 'APPROVED'
     )
   where c.id = coalesce(new.club_id, old.club_id);
  return null;
end $$;


ALTER FUNCTION "public"."sync_club_member_count"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."transfer_club_ownership"("p_club_id" "uuid", "p_new_owner_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_caller_role text;
  v_target_role text;
begin
  if p_new_owner_id = auth.uid() then
    raise exception 'CANNOT_TRANSFER_TO_SELF';
  end if;

  select role into v_caller_role
  from club_members
  where club_id = p_club_id and user_id = auth.uid();

  if v_caller_role is distinct from 'OWNER' then
    raise exception 'NOT_AUTHORIZED';
  end if;

  select role into v_target_role
  from club_members
  where club_id = p_club_id and user_id = p_new_owner_id;

  if v_target_role is null then
    raise exception 'TARGET_NOT_MEMBER';
  end if;

  update club_members set role = 'VICE'
  where club_id = p_club_id and user_id = auth.uid();

  update club_members set role = 'OWNER'
  where club_id = p_club_id and user_id = p_new_owner_id;
end;
$$;


ALTER FUNCTION "public"."transfer_club_ownership"("p_club_id" "uuid", "p_new_owner_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."transfer_ownership"("p_club_id" "uuid", "p_to_user" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare v_target public.club_members;
begin
  if public.club_role(p_club_id) <> 'OWNER' then raise exception 'FORBIDDEN'; end if;

  select * into v_target from public.club_members
   where club_id = p_club_id and user_id = p_to_user and status = 'APPROVED';
  if v_target.id is null then raise exception 'TARGET_NOT_APPROVED'; end if;

  update public.club_members set role = 'CAPTAIN'
   where club_id = p_club_id and user_id = auth.uid();
  update public.club_members set role = 'OWNER' where id = v_target.id;
  update public.clubs set owner_id = p_to_user where id = p_club_id;
end $$;


ALTER FUNCTION "public"."transfer_ownership"("p_club_id" "uuid", "p_to_user" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trigger_auto_reward_on_activity"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  v_earned_xu BIGINT;
  v_tx_id UUID;
  v_system_acc UUID := '00000000-0000-0000-0000-000000000000'::UUID;
  v_idempotency_key TEXT;
BEGIN
  -- Chỉ tự động thưởng khi hoạt động được đánh dấu hợp lệ hoặc mặc định thành công
  -- Quy tắc: 1km = 1 Xu Thưởng (làm tròn xuống)
  v_earned_xu := FLOOR(NEW.distance_m / 1000);

  IF v_earned_xu > 0 THEN
    v_idempotency_key := 'auto_reward_' || NEW.id;

    -- Kiểm tra chống trùng lặp
    IF NOT EXISTS (SELECT 1 FROM ledger_transactions WHERE idempotency_key = v_idempotency_key) THEN
      
      INSERT INTO ledger_transactions (type, idempotency_key, reason, created_by)
      VALUES ('AUTO_RUN_REWARD', v_idempotency_key, 'Tự động cày thưởng theo cự ly chạy', NEW.user_id)
      RETURNING id INTO v_tx_id;

      -- Cộng Xu Thưởng cho user
      INSERT INTO ledger_entries (transaction_id, account_id, coin_kind, amount)
      VALUES (v_tx_id, NEW.user_id, 'BONUS', v_earned_xu);

      -- Đối ứng hệ thống
      INSERT INTO ledger_entries (transaction_id, account_id, coin_kind, amount)
      VALUES (v_tx_id, v_system_acc, 'BONUS', -v_earned_xu);

      -- Cập nhật trực tiếp vào profiles
      UPDATE profiles 
      SET xu = xu + v_earned_xu, xp = xp + (v_earned_xu * 10)
      WHERE id = NEW.user_id;

    END IF;
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."trigger_auto_reward_on_activity"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_club"("p_club_id" "uuid", "p_name" "text" DEFAULT NULL::"text", "p_description" "text" DEFAULT NULL::"text", "p_avatar_url" "text" DEFAULT NULL::"text", "p_avatar_path" "text" DEFAULT NULL::"text") RETURNS "public"."clubs"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare v_me text; v_club public.clubs; v_old_path text;
begin
  v_me := public.club_role(p_club_id);
  if v_me not in ('OWNER','CAPTAIN') then raise exception 'FORBIDDEN'; end if;

  select avatar_path into v_old_path from public.clubs where id = p_club_id;

  if p_name is not null then
    if trim(p_name) = '' then raise exception 'NAME_REQUIRED'; end if;
    if char_length(trim(p_name)) > 60 then raise exception 'NAME_TOO_LONG'; end if;
  end if;

  if p_description is not null and char_length(p_description) > 300 then
    raise exception 'DESC_TOO_LONG';
  end if;

  begin
    update public.clubs
       set name        = coalesce(nullif(trim(coalesce(p_name, '')), ''), name),
           description = case when p_description is null then description
                              else nullif(trim(p_description), '') end,
           avatar_url  = case when p_avatar_url is null then avatar_url
                              else nullif(trim(p_avatar_url), '') end,
           avatar_path = case when p_avatar_url is null then avatar_path
                              else nullif(trim(coalesce(p_avatar_path, '')), '') end
     where id = p_club_id
    returning * into v_club;
  exception when unique_violation then
    raise exception 'NAME_TAKEN';
  end;

  if v_club.id is null then raise exception 'CLUB_NOT_FOUND'; end if;

  -- Dọn file ảnh cũ để storage không phình
  if p_avatar_url is not null
     and v_old_path is not null
     and v_old_path is distinct from v_club.avatar_path then
    delete from storage.objects
     where bucket_id = 'club-avatars' and name = v_old_path;
  end if;

  return v_club;
end $$;


ALTER FUNCTION "public"."update_club"("p_club_id" "uuid", "p_name" "text", "p_description" "text", "p_avatar_url" "text", "p_avatar_path" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_club_policy"("p_club_id" "uuid", "p_join_policy" "text" DEFAULT NULL::"text", "p_member_limit" integer DEFAULT NULL::integer) RETURNS "public"."clubs"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare v_club public.clubs; v_count integer;
begin
  if public.club_role(p_club_id) <> 'OWNER' then raise exception 'FORBIDDEN'; end if;

  if p_join_policy is not null and p_join_policy not in ('OPEN','APPROVAL','INVITE_ONLY') then
    raise exception 'INVALID_POLICY';
  end if;

  if p_member_limit is not null then
    if p_member_limit < 2 or p_member_limit > 1000 then raise exception 'INVALID_LIMIT'; end if;
    select member_count into v_count from public.clubs where id = p_club_id;
    if p_member_limit < v_count then raise exception 'LIMIT_BELOW_CURRENT'; end if;
  end if;

  update public.clubs
     set join_policy  = coalesce(p_join_policy, join_policy),
         member_limit = coalesce(p_member_limit, member_limit)
   where id = p_club_id
  returning * into v_club;

  -- Chuyển sang OPEN thì duyệt luôn hàng chờ, trong giới hạn còn trống
  if p_join_policy = 'OPEN' then
    update public.club_members m
       set status = 'APPROVED', joined_at = now()
     where m.id in (
       select id from public.club_members
        where club_id = p_club_id and status = 'PENDING'
        order by joined_at
        limit greatest(v_club.member_limit - v_club.member_count, 0)
     );
    select * into v_club from public.clubs where id = p_club_id;
  end if;

  return v_club;
end $$;


ALTER FUNCTION "public"."update_club_policy"("p_club_id" "uuid", "p_join_policy" "text", "p_member_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."user_topup_xu"("p_admin_id" "uuid", "p_target_user_id" "uuid", "p_amount_xu" bigint, "p_amount_vnd" bigint, "p_bank_reference" "text", "p_idempotency_key" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_tx_id UUID;
  v_system_acc UUID := '00000000-0000-0000-0000-000000000000'::UUID;
BEGIN
  -- 1. Kiểm tra chống trùng lặp giao dịch nạp
  IF EXISTS (SELECT 1 FROM ledger_transactions WHERE idempotency_key = p_idempotency_key) THEN
    RAISE EXCEPTION 'Mã giao dịch nạp xu này đã được xử lý trước đó.';
  END IF;

  -- 2. Tạo Transaction Header cho luồng IAP / Top-up tiền thật
  INSERT INTO ledger_transactions (type, idempotency_key, reason, created_by, approved_by)
  VALUES (
    'IAP_TOPUP_VND', 
    p_idempotency_key, 
    format('Nạp %s Xu ứng với %s VNĐ (Ref: %s)', p_amount_xu, p_amount_vnd, p_bank_reference), 
    p_admin_id, 
    p_admin_id
  )
  RETURNING id INTO v_tx_id;

  -- 3. Bút toán ghi có vào ví Xu Nạp (PAID) của User
  INSERT INTO ledger_entries (transaction_id, account_id, coin_kind, amount)
  VALUES (v_tx_id, p_target_user_id, 'PAID', p_amount_xu);

  -- 4. Bút toán đối ứng tài khoản hệ thống (Khoản thu tiền mặt/ngân hàng)
  INSERT INTO ledger_entries (transaction_id, account_id, coin_kind, amount)
  VALUES (v_tx_id, v_system_acc, 'PAID', -p_amount_xu);

  -- 5. Cập nhật trực tiếp vào bảng profiles để hiển thị nhanh ra giao diện
  UPDATE profiles 
  SET xu = xu + p_amount_xu 
  WHERE id = p_target_user_id;

  RETURN json_build_object(
    'success', true, 
    'transaction_id', v_tx_id, 
    'credited_xu', p_amount_xu
  );
END;
$$;


ALTER FUNCTION "public"."user_topup_xu"("p_admin_id" "uuid", "p_target_user_id" "uuid", "p_amount_xu" bigint, "p_amount_vnd" bigint, "p_bank_reference" "text", "p_idempotency_key" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."validate_fee_tiers"("p_tiers" "jsonb") RETURNS "void"
    LANGUAGE "plpgsql" IMMUTABLE
    AS $$
declare
  n int; i int; t jsonb;
  v_min int; v_max int; v_fee int;
begin
  if p_tiers is null or jsonb_typeof(p_tiers) <> 'array' or jsonb_array_length(p_tiers) = 0 then
    raise exception 'Cần ít nhất một bậc phí';
  end if;

  n := jsonb_array_length(p_tiers);
  for i in 0 .. n - 1 loop
    t := p_tiers -> i;
    v_min := (t ->> 'min')::int;
    v_fee := (t ->> 'fee')::int;

    if v_min is null or v_min < 1 then
      raise exception 'Bậc %: "Từ" phải là số nguyên >= 1', i + 1;
    end if;
    if i = 0 and v_min <> 1 then
      raise exception 'Bậc đầu tiên phải bắt đầu từ 1';
    end if;
    if v_fee is null or v_fee < 0 then
      raise exception 'Bậc %: phí phải là số nguyên >= 0', i + 1;
    end if;

    if i = n - 1 then
      if (t ->> 'max') is not null then
        raise exception 'Bậc cuối phải để trống "Đến" (không giới hạn)';
      end if;
    else
      v_max := (t ->> 'max')::int;
      if v_max is null or v_max < v_min then
        raise exception 'Bậc %: "Đến" phải >= "Từ"', i + 1;
      end if;
      if ((p_tiers -> (i + 1)) ->> 'min')::int <> v_max + 1 then
        raise exception 'Bậc % và %: khoảng bị hở hoặc chồng lấn', i + 1, i + 2;
      end if;
    end if;

    if i > 0 and v_fee < ((p_tiers -> (i - 1)) ->> 'fee')::int then
      raise exception 'Phí bậc sau phải >= phí bậc trước';
    end if;
  end loop;
end;
$$;


ALTER FUNCTION "public"."validate_fee_tiers"("p_tiers" "jsonb") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."achievements" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "code" "text" NOT NULL,
    "title" "text" NOT NULL,
    "description" "text",
    "icon_url" "text",
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL
);


ALTER TABLE "public"."achievements" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."activities" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "title" "text" DEFAULT 'Buổi chạy training'::"text",
    "source" "text" DEFAULT 'DIRECT_GPS'::"text",
    "source_activity_id" "text",
    "started_at" timestamp with time zone,
    "ended_at" timestamp with time zone,
    "elapsed_time_s" integer DEFAULT 0,
    "moving_time_s" integer DEFAULT 0,
    "distance_m" numeric DEFAULT 0,
    "moving_distance_m" numeric DEFAULT 0,
    "avg_pace_s" integer DEFAULT 0,
    "avg_speed_mps" numeric DEFAULT 0,
    "elevation_gain_m" numeric DEFAULT 0,
    "status" "text" DEFAULT 'PROCESSING'::"text",
    "validation_status" "text" DEFAULT 'PENDING'::"text",
    "validation_reason" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."activities" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."activity_track_points" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "activity_id" "uuid",
    "sequence" integer DEFAULT 0,
    "latitude" numeric NOT NULL,
    "longitude" numeric NOT NULL,
    "accuracy" numeric,
    "altitude" numeric,
    "speed" numeric,
    "recorded_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."activity_track_points" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."admin_audit_log" (
    "id" bigint NOT NULL,
    "actor_id" "uuid",
    "action" "text" NOT NULL,
    "target" "text" NOT NULL,
    "old_value" "jsonb",
    "new_value" "jsonb",
    "reason" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."admin_audit_log" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."admin_audit_log_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."admin_audit_log_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."admin_audit_log_id_seq" OWNED BY "public"."admin_audit_log"."id";



CREATE TABLE IF NOT EXISTS "public"."admin_logs" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "admin_id" "uuid",
    "action" "text" NOT NULL,
    "target_table" "text",
    "target_id" "uuid",
    "before_data" "jsonb",
    "after_data" "jsonb",
    "reason" "text",
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL
);


ALTER TABLE "public"."admin_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."audit_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "actor_id" "uuid",
    "club_id" "uuid",
    "action" "text" NOT NULL,
    "target_type" "text",
    "target_id" "uuid",
    "metadata" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."audit_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."avatar_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "category" "text" NOT NULL,
    "rarity" "text" DEFAULT 'common'::"text" NOT NULL,
    "asset_url" "text" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "release_date" timestamp with time zone DEFAULT "now"(),
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    CONSTRAINT "avatar_items_category_check" CHECK (("category" = ANY (ARRAY['base'::"text", 'hair'::"text", 'top'::"text", 'bottom'::"text", 'shoes'::"text", 'hat'::"text", 'glasses'::"text", 'watch'::"text", 'accessory'::"text", 'effect'::"text"]))),
    CONSTRAINT "avatar_items_rarity_check" CHECK (("rarity" = ANY (ARRAY['common'::"text", 'rare'::"text", 'epic'::"text", 'legendary'::"text"])))
);


ALTER TABLE "public"."avatar_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."challenge_participants" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "challenge_id" "uuid",
    "profile_id" "uuid",
    "current_progress" numeric DEFAULT 0,
    "status" "text" DEFAULT 'JOINED'::"text",
    "joined_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."challenge_participants" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."challenge_results" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "challenge_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "current_progress" numeric(10,2) DEFAULT 0,
    "is_completed" boolean DEFAULT false,
    "completed_at" timestamp with time zone,
    "updated_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL
);


ALTER TABLE "public"."challenge_results" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."challenge_rules" (
    "challenge_id" "uuid" NOT NULL,
    "target_distance_m" integer,
    "target_value" numeric,
    "minimum_distance_m" integer DEFAULT 1000,
    "minimum_pace_s_per_km" integer DEFAULT 180,
    "maximum_pace_s_per_km" integer DEFAULT 720,
    "time_metric" "text" DEFAULT 'MOVING_TIME'::"text",
    "cutoff_time_s" integer,
    "require_heart_rate" boolean DEFAULT false,
    "require_cadence" boolean DEFAULT false,
    "require_gps" boolean DEFAULT true,
    "allowed_activity_types" "text"[] DEFAULT ARRAY['RUN'::"text"],
    "allowed_sources" "text"[] DEFAULT ARRAY['STRAVA'::"text", 'GARMIN'::"text", 'RACEHUB'::"text"],
    "scoring_type" "text" DEFAULT 'XP'::"text",
    "reward_xu" integer DEFAULT 0
);


ALTER TABLE "public"."challenge_rules" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."challenge_templates" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "title" "text" NOT NULL,
    "objective_type" "text" NOT NULL,
    "default_target_distance_m" integer,
    "default_target_value" numeric,
    "default_duration_days" integer,
    "description" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."challenge_templates" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."challenges" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "title" "text" NOT NULL,
    "description" "text",
    "start_date" timestamp with time zone NOT NULL,
    "end_date" timestamp with time zone NOT NULL,
    "target_type" "text" DEFAULT 'DISTANCE'::"text",
    "target_value" numeric(10,2) NOT NULL,
    "min_distance" numeric(10,2) DEFAULT 0,
    "pace_min" "text",
    "pace_max" "text",
    "status" "text" DEFAULT 'ACTIVE'::"text",
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "challenge_type" "text" DEFAULT 'INDIVIDUAL'::"text" NOT NULL,
    "game_mode" "text" DEFAULT 'ACCUMULATE'::"text",
    "target_km" numeric DEFAULT 0,
    "min_km" numeric DEFAULT 2.0,
    "min_members" integer DEFAULT 1,
    "days" integer DEFAULT 30,
    "created_by" "uuid",
    "reg_deadline" timestamp with time zone DEFAULT "timezone"('utc'::"text", ("now"() + '7 days'::interval)),
    "min_pace" numeric DEFAULT 3.0,
    "max_pace" numeric DEFAULT 15.0,
    "fixed_team_size" integer DEFAULT 0,
    "creator_role" "text" DEFAULT 'ADMIN'::"text",
    "target_audience" "text" DEFAULT 'PUBLIC'::"text",
    "target_club_id" "uuid",
    "max_slots" integer DEFAULT 50,
    "calculated_fee" integer DEFAULT 50,
    "fee_config_version" integer,
    "fee_charged" integer,
    CONSTRAINT "challenges_status_check" CHECK (("status" = ANY (ARRAY['DRAFT'::"text", 'ACTIVE'::"text", 'FINISHED'::"text", 'ARCHIVED'::"text"]))),
    CONSTRAINT "challenges_target_audience_check" CHECK (("target_audience" = ANY (ARRAY['PUBLIC'::"text", 'CLUB_ONLY'::"text", 'INVITE_ONLY'::"text"])))
);


ALTER TABLE "public"."challenges" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."club_announcements" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "club_id" "uuid",
    "author_id" "uuid",
    "title" "text" NOT NULL,
    "content" "text" NOT NULL,
    "is_pinned" boolean DEFAULT false,
    "status" "text" DEFAULT 'PUBLISHED'::"text",
    "published_at" timestamp with time zone DEFAULT "now"(),
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."club_announcements" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."club_member_roles" (
    "club_member_id" "uuid" NOT NULL,
    "role_id" "uuid" NOT NULL
);


ALTER TABLE "public"."club_member_roles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."club_tournaments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "club_id" "uuid",
    "title" "text" NOT NULL,
    "status" "text" DEFAULT 'UPCOMING'::"text",
    "reward_pool" numeric(10,2) DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    CONSTRAINT "club_tournaments_status_check" CHECK (("status" = ANY (ARRAY['UPCOMING'::"text", 'ONGOING'::"text", 'FINISHED'::"text"])))
);


ALTER TABLE "public"."club_tournaments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."club_treasury_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "club_id" "uuid" NOT NULL,
    "user_id" "uuid",
    "amount" numeric(12,1) NOT NULL,
    "kind" "text" NOT NULL,
    "note" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "club_treasury_log_kind_check" CHECK (("kind" = ANY (ARRAY['CONTRIBUTE'::"text", 'SPEND'::"text", 'REWARD'::"text"])))
);


ALTER TABLE "public"."club_treasury_log" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."config_versions" (
    "id" bigint NOT NULL,
    "config_key" "text" NOT NULL,
    "version" integer NOT NULL,
    "value" "jsonb" NOT NULL,
    "effective_from" timestamp with time zone DEFAULT "now"() NOT NULL,
    "reason" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."config_versions" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."config_versions_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."config_versions_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."config_versions_id_seq" OWNED BY "public"."config_versions"."id";



CREATE TABLE IF NOT EXISTS "public"."connected_accounts" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "provider" "text" NOT NULL,
    "provider_user_id" "text" NOT NULL,
    "access_token" "text",
    "refresh_token" "text",
    "expires_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL
);


ALTER TABLE "public"."connected_accounts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."fraud_flags" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "activity_id" "uuid" NOT NULL,
    "risk_score" integer DEFAULT 0,
    "reason" "text",
    "status" "text" DEFAULT 'PENDING'::"text",
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    CONSTRAINT "fraud_flags_status_check" CHECK (("status" = ANY (ARRAY['PENDING'::"text", 'APPROVED'::"text", 'REJECTED'::"text"])))
);


ALTER TABLE "public"."fraud_flags" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ledger_entries" (
    "id" bigint NOT NULL,
    "transaction_id" "uuid",
    "account_id" "uuid" NOT NULL,
    "coin_kind" "text" NOT NULL,
    "amount" bigint NOT NULL,
    CONSTRAINT "ledger_entries_coin_kind_check" CHECK (("coin_kind" = ANY (ARRAY['PAID'::"text", 'BONUS'::"text"])))
);


ALTER TABLE "public"."ledger_entries" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."ledger_entries_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."ledger_entries_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."ledger_entries_id_seq" OWNED BY "public"."ledger_entries"."id";



CREATE TABLE IF NOT EXISTS "public"."ledger_transactions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "type" "text" NOT NULL,
    "idempotency_key" "text" NOT NULL,
    "campaign_id" "uuid",
    "reason" "text",
    "created_by" "uuid",
    "approved_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."ledger_transactions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."permissions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "code" "text" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."permissions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profile_settings" (
    "user_id" "uuid" NOT NULL,
    "region" "text",
    "profile_visibility" "text" DEFAULT 'PUBLIC'::"text" NOT NULL,
    "activity_visibility" "text" DEFAULT 'PUBLIC'::"text" NOT NULL,
    "map_visibility" "text" DEFAULT 'PRIVATE'::"text" NOT NULL,
    "consented_at" timestamp with time zone,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "profile_settings_activity_visibility_check" CHECK (("activity_visibility" = ANY (ARRAY['PUBLIC'::"text", 'CLUB'::"text", 'PRIVATE'::"text"]))),
    CONSTRAINT "profile_settings_map_visibility_check" CHECK (("map_visibility" = ANY (ARRAY['PUBLIC'::"text", 'CLUB'::"text", 'PRIVATE'::"text"]))),
    CONSTRAINT "profile_settings_profile_visibility_check" CHECK (("profile_visibility" = ANY (ARRAY['PUBLIC'::"text", 'CLUB'::"text", 'PRIVATE'::"text"]))),
    CONSTRAINT "profile_settings_region_check" CHECK ((("region" IS NULL) OR ("char_length"("region") <= 40)))
);


ALTER TABLE "public"."profile_settings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "display_name" "text" NOT NULL,
    "avatar_url" "text",
    "level" integer DEFAULT 1,
    "xp" integer DEFAULT 0,
    "xu" numeric DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "role" "text" DEFAULT 'MEMBER'::"text",
    "is_admin" boolean DEFAULT false,
    "strava_connected" boolean DEFAULT false,
    "strava_access_token" "text",
    "strava_refresh_token" "text",
    "strava_token_expires_at" bigint,
    "strava_athlete_id" "text",
    "referred_by" "uuid"
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."role_permissions" (
    "role_id" "uuid" NOT NULL,
    "permission_id" "uuid" NOT NULL
);


ALTER TABLE "public"."role_permissions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."roles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "code" "text" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."roles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."system_config_versions" (
    "id" integer NOT NULL,
    "config_key" "text" NOT NULL,
    "version" integer NOT NULL,
    "status" "text" DEFAULT 'PUBLISHED'::"text",
    "effective_from" timestamp with time zone DEFAULT "now"(),
    "config_value" "jsonb" NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "system_config_versions_status_check" CHECK (("status" = ANY (ARRAY['DRAFT'::"text", 'PUBLISHED'::"text", 'ARCHIVED'::"text"])))
);


ALTER TABLE "public"."system_config_versions" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."system_config_versions_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."system_config_versions_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."system_config_versions_id_seq" OWNED BY "public"."system_config_versions"."id";



CREATE TABLE IF NOT EXISTS "public"."system_settings" (
    "key" "text" NOT NULL,
    "value" "text" NOT NULL,
    "description" "text",
    "updated_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL
);


ALTER TABLE "public"."system_settings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_achievements" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "achievement_id" "uuid" NOT NULL,
    "unlocked_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL
);


ALTER TABLE "public"."user_achievements" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_avatar" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "gender" "text" DEFAULT 'male'::"text" NOT NULL,
    "skin_tone" "text" DEFAULT '#f5d0b1'::"text" NOT NULL,
    "hair_style" "text" DEFAULT 'default'::"text" NOT NULL,
    "hair_color" "text" DEFAULT '#3b2219'::"text" NOT NULL,
    "level" integer DEFAULT 1 NOT NULL,
    "xp" integer DEFAULT 0 NOT NULL,
    "coins" integer DEFAULT 500 NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "user_avatar_gender_check" CHECK (("gender" = ANY (ARRAY['male'::"text", 'female'::"text"])))
);


ALTER TABLE "public"."user_avatar" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_badges" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "badge_code" "text" NOT NULL,
    "unlocked_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."user_badges" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_equipment" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "base_item_id" "uuid",
    "hair_item_id" "uuid",
    "top_item_id" "uuid",
    "bottom_item_id" "uuid",
    "shoes_item_id" "uuid",
    "hat_item_id" "uuid",
    "glasses_item_id" "uuid",
    "watch_item_id" "uuid",
    "accessory_item_id" "uuid",
    "effect_item_id" "uuid",
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."user_equipment" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_inventory" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "item_id" "uuid" NOT NULL,
    "acquired_at" timestamp with time zone DEFAULT "now"(),
    "acquired_reason" "text" DEFAULT 'starter'::"text"
);


ALTER TABLE "public"."user_inventory" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_titles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "title_code" "text" NOT NULL,
    "is_equipped" boolean DEFAULT false NOT NULL
);


ALTER TABLE "public"."user_titles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."wallet_transactions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "profile_id" "uuid",
    "amount" numeric NOT NULL,
    "transaction_type" "text" NOT NULL,
    "reference_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."wallet_transactions" OWNER TO "postgres";


ALTER TABLE ONLY "public"."admin_audit_log" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."admin_audit_log_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."config_versions" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."config_versions_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."ledger_entries" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."ledger_entries_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."system_config_versions" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."system_config_versions_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."achievements"
    ADD CONSTRAINT "achievements_code_key" UNIQUE ("code");



ALTER TABLE ONLY "public"."achievements"
    ADD CONSTRAINT "achievements_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."activities"
    ADD CONSTRAINT "activities_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."activity_track_points"
    ADD CONSTRAINT "activity_track_points_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."admin_audit_log"
    ADD CONSTRAINT "admin_audit_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."admin_logs"
    ADD CONSTRAINT "admin_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."audit_logs"
    ADD CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."avatar_items"
    ADD CONSTRAINT "avatar_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."challenge_participants"
    ADD CONSTRAINT "challenge_participants_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."challenge_results"
    ADD CONSTRAINT "challenge_results_challenge_id_user_id_key" UNIQUE ("challenge_id", "user_id");



ALTER TABLE ONLY "public"."challenge_results"
    ADD CONSTRAINT "challenge_results_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."challenge_rules"
    ADD CONSTRAINT "challenge_rules_pkey" PRIMARY KEY ("challenge_id");



ALTER TABLE ONLY "public"."challenge_templates"
    ADD CONSTRAINT "challenge_templates_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."challenges"
    ADD CONSTRAINT "challenges_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."club_announcements"
    ADD CONSTRAINT "club_announcements_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."club_member_roles"
    ADD CONSTRAINT "club_member_roles_pkey" PRIMARY KEY ("club_member_id", "role_id");



ALTER TABLE ONLY "public"."club_members"
    ADD CONSTRAINT "club_members_club_id_user_id_key" UNIQUE ("club_id", "user_id");



ALTER TABLE ONLY "public"."club_members"
    ADD CONSTRAINT "club_members_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."club_members"
    ADD CONSTRAINT "club_members_unique_pair" UNIQUE ("club_id", "user_id");



ALTER TABLE ONLY "public"."club_tournaments"
    ADD CONSTRAINT "club_tournaments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."club_treasury_log"
    ADD CONSTRAINT "club_treasury_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."clubs"
    ADD CONSTRAINT "clubs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."config_versions"
    ADD CONSTRAINT "config_versions_config_key_version_key" UNIQUE ("config_key", "version");



ALTER TABLE ONLY "public"."config_versions"
    ADD CONSTRAINT "config_versions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."connected_accounts"
    ADD CONSTRAINT "connected_accounts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."connected_accounts"
    ADD CONSTRAINT "connected_accounts_provider_provider_user_id_key" UNIQUE ("provider", "provider_user_id");



ALTER TABLE ONLY "public"."fraud_flags"
    ADD CONSTRAINT "fraud_flags_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ledger_entries"
    ADD CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ledger_transactions"
    ADD CONSTRAINT "ledger_transactions_idempotency_key_key" UNIQUE ("idempotency_key");



ALTER TABLE ONLY "public"."ledger_transactions"
    ADD CONSTRAINT "ledger_transactions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."permissions"
    ADD CONSTRAINT "permissions_code_key" UNIQUE ("code");



ALTER TABLE ONLY "public"."permissions"
    ADD CONSTRAINT "permissions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profile_settings"
    ADD CONSTRAINT "profile_settings_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."role_permissions"
    ADD CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role_id", "permission_id");



ALTER TABLE ONLY "public"."roles"
    ADD CONSTRAINT "roles_code_key" UNIQUE ("code");



ALTER TABLE ONLY "public"."roles"
    ADD CONSTRAINT "roles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."system_config_versions"
    ADD CONSTRAINT "system_config_versions_config_key_version_key" UNIQUE ("config_key", "version");



ALTER TABLE ONLY "public"."system_config_versions"
    ADD CONSTRAINT "system_config_versions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."system_settings"
    ADD CONSTRAINT "system_settings_pkey" PRIMARY KEY ("key");



ALTER TABLE ONLY "public"."wallet_transactions"
    ADD CONSTRAINT "unique_profile_transaction_ref" UNIQUE ("profile_id", "transaction_type", "reference_id");



ALTER TABLE ONLY "public"."user_achievements"
    ADD CONSTRAINT "user_achievements_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_achievements"
    ADD CONSTRAINT "user_achievements_user_id_achievement_id_key" UNIQUE ("user_id", "achievement_id");



ALTER TABLE ONLY "public"."user_avatar"
    ADD CONSTRAINT "user_avatar_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_avatar"
    ADD CONSTRAINT "user_avatar_user_id_key" UNIQUE ("user_id");



ALTER TABLE ONLY "public"."user_badges"
    ADD CONSTRAINT "user_badges_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_badges"
    ADD CONSTRAINT "user_badges_user_id_badge_code_key" UNIQUE ("user_id", "badge_code");



ALTER TABLE ONLY "public"."user_equipment"
    ADD CONSTRAINT "user_equipment_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_equipment"
    ADD CONSTRAINT "user_equipment_user_id_key" UNIQUE ("user_id");



ALTER TABLE ONLY "public"."user_inventory"
    ADD CONSTRAINT "user_inventory_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_inventory"
    ADD CONSTRAINT "user_inventory_user_id_item_id_key" UNIQUE ("user_id", "item_id");



ALTER TABLE ONLY "public"."user_titles"
    ADD CONSTRAINT "user_titles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_titles"
    ADD CONSTRAINT "user_titles_user_id_title_code_key" UNIQUE ("user_id", "title_code");



ALTER TABLE ONLY "public"."wallet_transactions"
    ADD CONSTRAINT "wallet_transactions_pkey" PRIMARY KEY ("id");



CREATE INDEX "club_members_club_idx" ON "public"."club_members" USING "btree" ("club_id", "status");



CREATE UNIQUE INDEX "club_members_single_owner" ON "public"."club_members" USING "btree" ("club_id") WHERE ("role" = 'OWNER'::"text");



CREATE INDEX "club_members_user_idx" ON "public"."club_members" USING "btree" ("user_id");



CREATE INDEX "club_treasury_log_club_idx" ON "public"."club_treasury_log" USING "btree" ("club_id", "created_at" DESC);



CREATE UNIQUE INDEX "clubs_invite_code_key" ON "public"."clubs" USING "btree" ("invite_code");



CREATE UNIQUE INDEX "clubs_name_lower_key" ON "public"."clubs" USING "btree" ("lower"("name"));



CREATE INDEX "config_versions_active_idx" ON "public"."config_versions" USING "btree" ("config_key", "effective_from" DESC, "version" DESC);



CREATE INDEX "idx_activities_user_validation" ON "public"."activities" USING "btree" ("user_id", "validation_status");



CREATE INDEX "idx_challenge_participants_user" ON "public"."challenge_participants" USING "btree" ("profile_id", "status");



CREATE INDEX "idx_ledger_entries_account_kind" ON "public"."ledger_entries" USING "btree" ("account_id", "coin_kind");



CREATE INDEX "idx_track_points_activity_seq" ON "public"."activity_track_points" USING "btree" ("activity_id", "sequence");



CREATE INDEX "idx_wallet_transactions_profile" ON "public"."wallet_transactions" USING "btree" ("profile_id");



CREATE OR REPLACE TRIGGER "trg_auto_reward" AFTER INSERT OR UPDATE OF "validation_status" ON "public"."activities" FOR EACH ROW WHEN ((("new"."validation_status" = 'APPROVED'::"text") OR ("new"."validation_status" IS NULL))) EXECUTE FUNCTION "public"."trigger_auto_reward_on_activity"();



CREATE OR REPLACE TRIGGER "trg_club_member_count" AFTER INSERT OR DELETE OR UPDATE OF "status" ON "public"."club_members" FOR EACH ROW EXECUTE FUNCTION "public"."sync_club_member_count"();



ALTER TABLE ONLY "public"."activities"
    ADD CONSTRAINT "activities_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."activity_track_points"
    ADD CONSTRAINT "activity_track_points_activity_id_fkey" FOREIGN KEY ("activity_id") REFERENCES "public"."activities"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."admin_audit_log"
    ADD CONSTRAINT "admin_audit_log_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."audit_logs"
    ADD CONSTRAINT "audit_logs_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."audit_logs"
    ADD CONSTRAINT "audit_logs_club_id_fkey" FOREIGN KEY ("club_id") REFERENCES "public"."clubs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."challenge_participants"
    ADD CONSTRAINT "challenge_participants_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."challenge_results"
    ADD CONSTRAINT "challenge_results_challenge_id_fkey" FOREIGN KEY ("challenge_id") REFERENCES "public"."challenges"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."challenge_rules"
    ADD CONSTRAINT "challenge_rules_challenge_id_fkey" FOREIGN KEY ("challenge_id") REFERENCES "public"."challenges"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."challenges"
    ADD CONSTRAINT "challenges_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."challenges"
    ADD CONSTRAINT "challenges_target_club_id_fkey" FOREIGN KEY ("target_club_id") REFERENCES "public"."clubs"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."club_announcements"
    ADD CONSTRAINT "club_announcements_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."club_announcements"
    ADD CONSTRAINT "club_announcements_club_id_fkey" FOREIGN KEY ("club_id") REFERENCES "public"."clubs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."club_member_roles"
    ADD CONSTRAINT "club_member_roles_club_member_id_fkey" FOREIGN KEY ("club_member_id") REFERENCES "public"."club_members"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."club_member_roles"
    ADD CONSTRAINT "club_member_roles_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."club_members"
    ADD CONSTRAINT "club_members_club_id_fkey" FOREIGN KEY ("club_id") REFERENCES "public"."clubs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."club_tournaments"
    ADD CONSTRAINT "club_tournaments_club_id_fkey" FOREIGN KEY ("club_id") REFERENCES "public"."clubs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."club_treasury_log"
    ADD CONSTRAINT "club_treasury_log_club_id_fkey" FOREIGN KEY ("club_id") REFERENCES "public"."clubs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."club_treasury_log"
    ADD CONSTRAINT "club_treasury_log_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."clubs"
    ADD CONSTRAINT "clubs_announced_by_fkey" FOREIGN KEY ("announced_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."config_versions"
    ADD CONSTRAINT "config_versions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."club_members"
    ADD CONSTRAINT "fk_club_members_profiles" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ledger_entries"
    ADD CONSTRAINT "ledger_entries_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "public"."ledger_transactions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profile_settings"
    ADD CONSTRAINT "profile_settings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_referred_by_fkey" FOREIGN KEY ("referred_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."role_permissions"
    ADD CONSTRAINT "role_permissions_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "public"."permissions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."role_permissions"
    ADD CONSTRAINT "role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_achievements"
    ADD CONSTRAINT "user_achievements_achievement_id_fkey" FOREIGN KEY ("achievement_id") REFERENCES "public"."achievements"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_avatar"
    ADD CONSTRAINT "user_avatar_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_badges"
    ADD CONSTRAINT "user_badges_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_equipment"
    ADD CONSTRAINT "user_equipment_accessory_item_id_fkey" FOREIGN KEY ("accessory_item_id") REFERENCES "public"."avatar_items"("id");



ALTER TABLE ONLY "public"."user_equipment"
    ADD CONSTRAINT "user_equipment_base_item_id_fkey" FOREIGN KEY ("base_item_id") REFERENCES "public"."avatar_items"("id");



ALTER TABLE ONLY "public"."user_equipment"
    ADD CONSTRAINT "user_equipment_bottom_item_id_fkey" FOREIGN KEY ("bottom_item_id") REFERENCES "public"."avatar_items"("id");



ALTER TABLE ONLY "public"."user_equipment"
    ADD CONSTRAINT "user_equipment_effect_item_id_fkey" FOREIGN KEY ("effect_item_id") REFERENCES "public"."avatar_items"("id");



ALTER TABLE ONLY "public"."user_equipment"
    ADD CONSTRAINT "user_equipment_glasses_item_id_fkey" FOREIGN KEY ("glasses_item_id") REFERENCES "public"."avatar_items"("id");



ALTER TABLE ONLY "public"."user_equipment"
    ADD CONSTRAINT "user_equipment_hair_item_id_fkey" FOREIGN KEY ("hair_item_id") REFERENCES "public"."avatar_items"("id");



ALTER TABLE ONLY "public"."user_equipment"
    ADD CONSTRAINT "user_equipment_hat_item_id_fkey" FOREIGN KEY ("hat_item_id") REFERENCES "public"."avatar_items"("id");



ALTER TABLE ONLY "public"."user_equipment"
    ADD CONSTRAINT "user_equipment_shoes_item_id_fkey" FOREIGN KEY ("shoes_item_id") REFERENCES "public"."avatar_items"("id");



ALTER TABLE ONLY "public"."user_equipment"
    ADD CONSTRAINT "user_equipment_top_item_id_fkey" FOREIGN KEY ("top_item_id") REFERENCES "public"."avatar_items"("id");



ALTER TABLE ONLY "public"."user_equipment"
    ADD CONSTRAINT "user_equipment_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_equipment"
    ADD CONSTRAINT "user_equipment_watch_item_id_fkey" FOREIGN KEY ("watch_item_id") REFERENCES "public"."avatar_items"("id");



ALTER TABLE ONLY "public"."user_inventory"
    ADD CONSTRAINT "user_inventory_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "public"."avatar_items"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_inventory"
    ADD CONSTRAINT "user_inventory_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_titles"
    ADD CONSTRAINT "user_titles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."wallet_transactions"
    ADD CONSTRAINT "wallet_transactions_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



CREATE POLICY "Activities visible by owner privacy" ON "public"."activities" FOR SELECT USING ((("auth"."uid"() = "user_id") OR ("public"."can_view_activities"("user_id") AND "public"."activity_is_countable"("status", "validation_status"))));



CREATE POLICY "Allow public insert clubs" ON "public"."clubs" FOR INSERT WITH CHECK (true);



CREATE POLICY "Allow public insert profile" ON "public"."profiles" FOR INSERT WITH CHECK (true);



CREATE POLICY "Allow public select clubs" ON "public"."clubs" FOR SELECT USING (true);



CREATE POLICY "Allow public select profile" ON "public"."profiles" FOR SELECT USING (true);



CREATE POLICY "Cho phép user tạo challenge mới" ON "public"."challenges" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "Cho phép user đã đăng nhập đọc permissions" ON "public"."permissions" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Cho phép user đã đăng nhập đọc role_permissions" ON "public"."role_permissions" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Cho phép user đã đăng nhập đọc roles" ON "public"."roles" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Cho phép đọc challenge" ON "public"."challenges" FOR SELECT USING (true);



CREATE POLICY "Ghi audit_logs" ON "public"."audit_logs" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() = "actor_id"));



CREATE POLICY "Public profiles are viewable by everyone" ON "public"."profiles" FOR SELECT USING (true);



CREATE POLICY "Public read avatar items" ON "public"."avatar_items" FOR SELECT USING (true);



CREATE POLICY "Quản lý club_member_roles" ON "public"."club_member_roles" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."club_members" "cm"
  WHERE (("cm"."id" = "club_member_roles"."club_member_id") AND "public"."has_permission"("auth"."uid"(), "cm"."club_id", 'member.role.assign'::"text"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."club_members" "cm"
  WHERE (("cm"."id" = "club_member_roles"."club_member_id") AND "public"."has_permission"("auth"."uid"(), "cm"."club_id", 'member.role.assign'::"text")))));



CREATE POLICY "Sửa announcements" ON "public"."club_announcements" FOR UPDATE TO "authenticated" USING (("public"."has_permission"("auth"."uid"(), "club_id", 'announcement.edit'::"text") OR ("author_id" = "auth"."uid"())));



CREATE POLICY "Track points insert own" ON "public"."activity_track_points" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."activities" "a"
  WHERE (("a"."id" = "activity_track_points"."activity_id") AND ("a"."user_id" = "auth"."uid"())))));



CREATE POLICY "Track points select owner or shared map" ON "public"."activity_track_points" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."activities" "a"
  WHERE (("a"."id" = "activity_track_points"."activity_id") AND (("a"."user_id" = "auth"."uid"()) OR "public"."can_view_map"("a"."user_id"))))));



CREATE POLICY "Tạo announcements" ON "public"."club_announcements" FOR INSERT TO "authenticated" WITH CHECK ((("auth"."uid"() = "author_id") AND "public"."has_permission"("auth"."uid"(), "club_id", 'announcement.create'::"text")));



CREATE POLICY "User manage own avatar" ON "public"."user_avatar" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "User manage own badges" ON "public"."user_badges" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "User manage own equipment" ON "public"."user_equipment" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "User manage own inventory" ON "public"."user_inventory" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "User manage own titles" ON "public"."user_titles" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can insert own activities" ON "public"."activities" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can insert their own avatar" ON "public"."user_avatar" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can read their own avatar" ON "public"."user_avatar" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update own activities" ON "public"."activities" FOR UPDATE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update own profile" ON "public"."profiles" FOR UPDATE USING (("auth"."uid"() = "id"));



CREATE POLICY "Users can update their own avatar" ON "public"."user_avatar" FOR UPDATE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Xem announcements của CLB" ON "public"."club_announcements" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."club_members" "cm"
  WHERE (("cm"."club_id" = "club_announcements"."club_id") AND ("cm"."user_id" = "auth"."uid"()) AND ("cm"."status" = 'APPROVED'::"text")))));



CREATE POLICY "Xem audit_logs" ON "public"."audit_logs" FOR SELECT TO "authenticated" USING ("public"."has_permission"("auth"."uid"(), "club_id", 'club.edit'::"text"));



CREATE POLICY "Xem club_member_roles trong cùng CLB" ON "public"."club_member_roles" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."club_members" "cm"
  WHERE (("cm"."id" = "club_member_roles"."club_member_id") AND (("cm"."user_id" = "auth"."uid"()) OR "public"."has_permission"("auth"."uid"(), "cm"."club_id", 'member.view'::"text"))))));



CREATE POLICY "Xóa announcements" ON "public"."club_announcements" FOR DELETE TO "authenticated" USING ("public"."has_permission"("auth"."uid"(), "club_id", 'announcement.delete'::"text"));



ALTER TABLE "public"."achievements" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."activities" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."activity_track_points" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "admin read audit log" ON "public"."admin_audit_log" FOR SELECT TO "authenticated" USING ("public"."is_system_admin"());



CREATE POLICY "admin read config_versions" ON "public"."config_versions" FOR SELECT TO "authenticated" USING ("public"."is_system_admin"());



ALTER TABLE "public"."admin_audit_log" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."admin_logs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."audit_logs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."avatar_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."challenge_participants" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."challenge_results" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."challenge_rules" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."challenge_templates" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."challenges" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."club_announcements" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."club_member_roles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."club_members" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "club_members_leave" ON "public"."club_members" FOR DELETE TO "authenticated" USING ((("user_id" = "auth"."uid"()) AND ("role" <> 'OWNER'::"text")));



CREATE POLICY "club_members_select" ON "public"."club_members" FOR SELECT TO "authenticated" USING ((("status" = 'APPROVED'::"text") OR ("user_id" = "auth"."uid"()) OR ("public"."club_role"("club_id") = ANY (ARRAY['OWNER'::"text", 'CAPTAIN'::"text"]))));



ALTER TABLE "public"."club_tournaments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."club_treasury_log" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "club_treasury_select" ON "public"."club_treasury_log" FOR SELECT TO "authenticated" USING (("public"."club_role"("club_id") IS NOT NULL));



ALTER TABLE "public"."clubs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "clubs_delete_owner" ON "public"."clubs" FOR DELETE TO "authenticated" USING (("owner_id" = "auth"."uid"()));



CREATE POLICY "clubs_select" ON "public"."clubs" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "clubs_update_staff" ON "public"."clubs" FOR UPDATE TO "authenticated" USING (("public"."club_role"("id") = ANY (ARRAY['OWNER'::"text", 'CAPTAIN'::"text"]))) WITH CHECK (("public"."club_role"("id") = ANY (ARRAY['OWNER'::"text", 'CAPTAIN'::"text"])));



ALTER TABLE "public"."config_versions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."connected_accounts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."fraud_flags" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."ledger_entries" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."ledger_transactions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."permissions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."profile_settings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "read system_settings" ON "public"."system_settings" FOR SELECT TO "authenticated" USING (true);



ALTER TABLE "public"."role_permissions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."roles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "settings insert own" ON "public"."profile_settings" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "settings select own" ON "public"."profile_settings" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "settings update own" ON "public"."profile_settings" FOR UPDATE USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."system_config_versions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."system_settings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_achievements" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_avatar" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_badges" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_equipment" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_inventory" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_titles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."wallet_transactions" ENABLE ROW LEVEL SECURITY;




ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";






ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."club_members";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."clubs";



GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";






















































































































































GRANT ALL ON FUNCTION "public"."activity_is_countable"("p_status" "text", "p_validation" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."activity_is_countable"("p_status" "text", "p_validation" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."activity_is_countable"("p_status" "text", "p_validation" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_adjust_user_xu"("p_admin_id" "uuid", "p_target_user_id" "uuid", "p_amount" bigint, "p_coin_kind" "text", "p_reason" "text", "p_idempotency_key" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."admin_adjust_user_xu"("p_admin_id" "uuid", "p_target_user_id" "uuid", "p_amount" bigint, "p_coin_kind" "text", "p_reason" "text", "p_idempotency_key" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_adjust_user_xu"("p_admin_id" "uuid", "p_target_user_id" "uuid", "p_amount" bigint, "p_coin_kind" "text", "p_reason" "text", "p_idempotency_key" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_topup_club_fund"("p_admin_id" "uuid", "p_club_id" "uuid", "p_amount" bigint, "p_reason" "text", "p_idempotency_key" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."admin_topup_club_fund"("p_admin_id" "uuid", "p_club_id" "uuid", "p_amount" bigint, "p_reason" "text", "p_idempotency_key" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_topup_club_fund"("p_admin_id" "uuid", "p_club_id" "uuid", "p_amount" bigint, "p_reason" "text", "p_idempotency_key" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."apply_referral"("p_referrer_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."apply_referral"("p_referrer_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."apply_referral"("p_referrer_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."can_see"("viewer" "uuid", "target" "uuid", "level" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."can_see"("viewer" "uuid", "target" "uuid", "level" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_see"("viewer" "uuid", "target" "uuid", "level" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."can_view_activities"("target" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."can_view_activities"("target" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_view_activities"("target" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."can_view_map"("target" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."can_view_map"("target" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_view_map"("target" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."can_view_profile"("target" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."can_view_profile"("target" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_view_profile"("target" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."club_rank"("p_role" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."club_rank"("p_role" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."club_rank"("p_role" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."club_role"("p_club" "uuid", "p_user" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."club_role"("p_club" "uuid", "p_user" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."club_role"("p_club" "uuid", "p_user" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."contribute_treasury"("p_club_id" "uuid", "p_amount" numeric) TO "anon";
GRANT ALL ON FUNCTION "public"."contribute_treasury"("p_club_id" "uuid", "p_amount" numeric) TO "authenticated";
GRANT ALL ON FUNCTION "public"."contribute_treasury"("p_club_id" "uuid", "p_amount" numeric) TO "service_role";



GRANT ALL ON FUNCTION "public"."create_challenge_with_fee"("p_user_id" "uuid", "p_title" "text", "p_challenge_type" "text", "p_game_mode" "text", "p_target_km" numeric, "p_min_km" numeric, "p_min_members" integer, "p_fixed_team_size" integer, "p_target_audience" "text", "p_start_date" timestamp with time zone, "p_end_date" timestamp with time zone, "p_reg_deadline" timestamp with time zone, "p_min_pace" numeric, "p_max_pace" numeric, "p_fee" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."create_challenge_with_fee"("p_user_id" "uuid", "p_title" "text", "p_challenge_type" "text", "p_game_mode" "text", "p_target_km" numeric, "p_min_km" numeric, "p_min_members" integer, "p_fixed_team_size" integer, "p_target_audience" "text", "p_start_date" timestamp with time zone, "p_end_date" timestamp with time zone, "p_reg_deadline" timestamp with time zone, "p_min_pace" numeric, "p_max_pace" numeric, "p_fee" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_challenge_with_fee"("p_user_id" "uuid", "p_title" "text", "p_challenge_type" "text", "p_game_mode" "text", "p_target_km" numeric, "p_min_km" numeric, "p_min_members" integer, "p_fixed_team_size" integer, "p_target_audience" "text", "p_start_date" timestamp with time zone, "p_end_date" timestamp with time zone, "p_reg_deadline" timestamp with time zone, "p_min_pace" numeric, "p_max_pace" numeric, "p_fee" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."create_challenge_with_fee"("p_user_id" "uuid", "p_title" "text", "p_challenge_type" "text", "p_game_mode" "text", "p_target_km" numeric, "p_min_km" numeric, "p_min_members" integer, "p_fixed_team_size" integer, "p_target_audience" "text", "p_start_date" timestamp with time zone, "p_end_date" timestamp with time zone, "p_reg_deadline" timestamp with time zone, "p_min_pace" numeric, "p_max_pace" numeric, "p_max_slots" integer, "p_fee" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."create_challenge_with_fee"("p_user_id" "uuid", "p_title" "text", "p_challenge_type" "text", "p_game_mode" "text", "p_target_km" numeric, "p_min_km" numeric, "p_min_members" integer, "p_fixed_team_size" integer, "p_target_audience" "text", "p_start_date" timestamp with time zone, "p_end_date" timestamp with time zone, "p_reg_deadline" timestamp with time zone, "p_min_pace" numeric, "p_max_pace" numeric, "p_max_slots" integer, "p_fee" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_challenge_with_fee"("p_user_id" "uuid", "p_title" "text", "p_challenge_type" "text", "p_game_mode" "text", "p_target_km" numeric, "p_min_km" numeric, "p_min_members" integer, "p_fixed_team_size" integer, "p_target_audience" "text", "p_start_date" timestamp with time zone, "p_end_date" timestamp with time zone, "p_reg_deadline" timestamp with time zone, "p_min_pace" numeric, "p_max_pace" numeric, "p_max_slots" integer, "p_fee" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."create_challenge_with_ledger"("p_user_id" "uuid", "p_title" "text", "p_challenge_type" "text", "p_game_mode" "text", "p_target_km" numeric, "p_min_km" numeric, "p_min_members" integer, "p_fixed_team_size" integer, "p_target_audience" "text", "p_start_date" timestamp with time zone, "p_end_date" timestamp with time zone, "p_reg_deadline" timestamp with time zone, "p_min_pace" numeric, "p_max_pace" numeric, "p_max_slots" integer, "p_idempotency_key" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."create_challenge_with_ledger"("p_user_id" "uuid", "p_title" "text", "p_challenge_type" "text", "p_game_mode" "text", "p_target_km" numeric, "p_min_km" numeric, "p_min_members" integer, "p_fixed_team_size" integer, "p_target_audience" "text", "p_start_date" timestamp with time zone, "p_end_date" timestamp with time zone, "p_reg_deadline" timestamp with time zone, "p_min_pace" numeric, "p_max_pace" numeric, "p_max_slots" integer, "p_idempotency_key" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_challenge_with_ledger"("p_user_id" "uuid", "p_title" "text", "p_challenge_type" "text", "p_game_mode" "text", "p_target_km" numeric, "p_min_km" numeric, "p_min_members" integer, "p_fixed_team_size" integer, "p_target_audience" "text", "p_start_date" timestamp with time zone, "p_end_date" timestamp with time zone, "p_reg_deadline" timestamp with time zone, "p_min_pace" numeric, "p_max_pace" numeric, "p_max_slots" integer, "p_idempotency_key" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."create_club"("p_name" "text", "p_description" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."create_club"("p_name" "text", "p_description" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_club"("p_name" "text", "p_description" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."delete_club"("p_club_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."delete_club"("p_club_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."delete_club"("p_club_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."delete_club"("p_club_id" "uuid", "p_confirm_name" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."delete_club"("p_club_id" "uuid", "p_confirm_name" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."delete_club"("p_club_id" "uuid", "p_confirm_name" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."equip_avatar_item"("p_item_id" "uuid", "p_category" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."equip_avatar_item"("p_item_id" "uuid", "p_category" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."equip_avatar_item"("p_item_id" "uuid", "p_category" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."execute_ledger_transaction"("p_type" "text", "p_idempotency_key" "text", "p_reason" "text", "p_created_by" "uuid", "p_entries" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."execute_ledger_transaction"("p_type" "text", "p_idempotency_key" "text", "p_reason" "text", "p_created_by" "uuid", "p_entries" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."execute_ledger_transaction"("p_type" "text", "p_idempotency_key" "text", "p_reason" "text", "p_created_by" "uuid", "p_entries" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_active_config"("p_key" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."get_active_config"("p_key" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_active_config"("p_key" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_activity_route"("p_activity_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_activity_route"("p_activity_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_activity_route"("p_activity_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_athlete_profile"("p_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_athlete_profile"("p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_athlete_profile"("p_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_challenge_fee"("p_max_participants" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."get_challenge_fee"("p_max_participants" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_challenge_fee"("p_max_participants" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";



GRANT ALL ON FUNCTION "public"."has_permission"("p_user_id" "uuid", "p_club_id" "uuid", "p_permission_code" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."has_permission"("p_user_id" "uuid", "p_club_id" "uuid", "p_permission_code" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_permission"("p_user_id" "uuid", "p_club_id" "uuid", "p_permission_code" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_system_admin"() TO "anon";
GRANT ALL ON FUNCTION "public"."is_system_admin"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_system_admin"() TO "service_role";



GRANT ALL ON TABLE "public"."club_members" TO "anon";
GRANT SELECT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."club_members" TO "authenticated";
GRANT ALL ON TABLE "public"."club_members" TO "service_role";



GRANT ALL ON FUNCTION "public"."join_club"("p_club_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."join_club"("p_club_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."join_club"("p_club_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."join_club_by_code"("p_code" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."join_club_by_code"("p_code" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."join_club_by_code"("p_code" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."leave_club"("p_club_id" "uuid", "p_new_owner_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."leave_club"("p_club_id" "uuid", "p_new_owner_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."leave_club"("p_club_id" "uuid", "p_new_owner_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."list_athlete_activities"("p_user_id" "uuid", "p_limit" integer, "p_offset" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."list_athlete_activities"("p_user_id" "uuid", "p_limit" integer, "p_offset" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."list_athlete_activities"("p_user_id" "uuid", "p_limit" integer, "p_offset" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."publish_config"("p_key" "text", "p_value" "jsonb", "p_effective_from" timestamp with time zone, "p_reason" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."publish_config"("p_key" "text", "p_value" "jsonb", "p_effective_from" timestamp with time zone, "p_reason" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."publish_config"("p_key" "text", "p_value" "jsonb", "p_effective_from" timestamp with time zone, "p_reason" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."remove_member"("p_member_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."remove_member"("p_member_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."remove_member"("p_member_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."review_activity"("p_activity_id" "uuid", "p_status" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."review_activity"("p_activity_id" "uuid", "p_status" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."review_activity"("p_activity_id" "uuid", "p_status" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."rotate_invite_code"("p_club_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."rotate_invite_code"("p_club_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rotate_invite_code"("p_club_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."safe_uuid"("p_text" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."safe_uuid"("p_text" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."safe_uuid"("p_text" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."search_athletes"("p_query" "text", "p_limit" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."search_athletes"("p_query" "text", "p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."search_athletes"("p_query" "text", "p_limit" integer) TO "service_role";



GRANT ALL ON TABLE "public"."clubs" TO "anon";
GRANT ALL ON TABLE "public"."clubs" TO "authenticated";
GRANT ALL ON TABLE "public"."clubs" TO "service_role";



GRANT ALL ON FUNCTION "public"."set_club_announcement"("p_club_id" "uuid", "p_text" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."set_club_announcement"("p_club_id" "uuid", "p_text" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_club_announcement"("p_club_id" "uuid", "p_text" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."set_member_role"("p_member_id" "uuid", "p_role" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."set_member_role"("p_member_id" "uuid", "p_role" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_member_role"("p_member_id" "uuid", "p_role" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."set_member_status"("p_member_id" "uuid", "p_status" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."set_member_status"("p_member_id" "uuid", "p_status" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_member_status"("p_member_id" "uuid", "p_status" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."shares_club"("a" "uuid", "b" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."shares_club"("a" "uuid", "b" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."shares_club"("a" "uuid", "b" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."submit_and_process_activity"("p_user_id" "uuid", "p_title" "text", "p_source" "text", "p_started_at" timestamp with time zone, "p_ended_at" timestamp with time zone, "p_elapsed_s" integer, "p_moving_s" integer, "p_distance_m" numeric, "p_avg_pace_s" integer, "p_track_points" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."submit_and_process_activity"("p_user_id" "uuid", "p_title" "text", "p_source" "text", "p_started_at" timestamp with time zone, "p_ended_at" timestamp with time zone, "p_elapsed_s" integer, "p_moving_s" integer, "p_distance_m" numeric, "p_avg_pace_s" integer, "p_track_points" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."submit_and_process_activity"("p_user_id" "uuid", "p_title" "text", "p_source" "text", "p_started_at" timestamp with time zone, "p_ended_at" timestamp with time zone, "p_elapsed_s" integer, "p_moving_s" integer, "p_distance_m" numeric, "p_avg_pace_s" integer, "p_track_points" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."sync_club_member_count"() TO "anon";
GRANT ALL ON FUNCTION "public"."sync_club_member_count"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."sync_club_member_count"() TO "service_role";



GRANT ALL ON FUNCTION "public"."transfer_club_ownership"("p_club_id" "uuid", "p_new_owner_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."transfer_club_ownership"("p_club_id" "uuid", "p_new_owner_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."transfer_club_ownership"("p_club_id" "uuid", "p_new_owner_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."transfer_ownership"("p_club_id" "uuid", "p_to_user" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."transfer_ownership"("p_club_id" "uuid", "p_to_user" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."transfer_ownership"("p_club_id" "uuid", "p_to_user" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."trigger_auto_reward_on_activity"() TO "anon";
GRANT ALL ON FUNCTION "public"."trigger_auto_reward_on_activity"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trigger_auto_reward_on_activity"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_club"("p_club_id" "uuid", "p_name" "text", "p_description" "text", "p_avatar_url" "text", "p_avatar_path" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."update_club"("p_club_id" "uuid", "p_name" "text", "p_description" "text", "p_avatar_url" "text", "p_avatar_path" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_club"("p_club_id" "uuid", "p_name" "text", "p_description" "text", "p_avatar_url" "text", "p_avatar_path" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."update_club_policy"("p_club_id" "uuid", "p_join_policy" "text", "p_member_limit" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."update_club_policy"("p_club_id" "uuid", "p_join_policy" "text", "p_member_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_club_policy"("p_club_id" "uuid", "p_join_policy" "text", "p_member_limit" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."user_topup_xu"("p_admin_id" "uuid", "p_target_user_id" "uuid", "p_amount_xu" bigint, "p_amount_vnd" bigint, "p_bank_reference" "text", "p_idempotency_key" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."user_topup_xu"("p_admin_id" "uuid", "p_target_user_id" "uuid", "p_amount_xu" bigint, "p_amount_vnd" bigint, "p_bank_reference" "text", "p_idempotency_key" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."user_topup_xu"("p_admin_id" "uuid", "p_target_user_id" "uuid", "p_amount_xu" bigint, "p_amount_vnd" bigint, "p_bank_reference" "text", "p_idempotency_key" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."validate_fee_tiers"("p_tiers" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."validate_fee_tiers"("p_tiers" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."validate_fee_tiers"("p_tiers" "jsonb") TO "service_role";


















GRANT ALL ON TABLE "public"."achievements" TO "anon";
GRANT ALL ON TABLE "public"."achievements" TO "authenticated";
GRANT ALL ON TABLE "public"."achievements" TO "service_role";



GRANT ALL ON TABLE "public"."activities" TO "anon";
GRANT ALL ON TABLE "public"."activities" TO "authenticated";
GRANT ALL ON TABLE "public"."activities" TO "service_role";



GRANT ALL ON TABLE "public"."activity_track_points" TO "anon";
GRANT ALL ON TABLE "public"."activity_track_points" TO "authenticated";
GRANT ALL ON TABLE "public"."activity_track_points" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."admin_audit_log" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."admin_audit_log" TO "authenticated";
GRANT ALL ON TABLE "public"."admin_audit_log" TO "service_role";



GRANT ALL ON SEQUENCE "public"."admin_audit_log_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."admin_audit_log_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."admin_audit_log_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."admin_logs" TO "anon";
GRANT ALL ON TABLE "public"."admin_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."admin_logs" TO "service_role";



GRANT ALL ON TABLE "public"."audit_logs" TO "anon";
GRANT ALL ON TABLE "public"."audit_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."audit_logs" TO "service_role";



GRANT ALL ON TABLE "public"."avatar_items" TO "anon";
GRANT ALL ON TABLE "public"."avatar_items" TO "authenticated";
GRANT ALL ON TABLE "public"."avatar_items" TO "service_role";



GRANT ALL ON TABLE "public"."challenge_participants" TO "anon";
GRANT ALL ON TABLE "public"."challenge_participants" TO "authenticated";
GRANT ALL ON TABLE "public"."challenge_participants" TO "service_role";



GRANT ALL ON TABLE "public"."challenge_results" TO "anon";
GRANT ALL ON TABLE "public"."challenge_results" TO "authenticated";
GRANT ALL ON TABLE "public"."challenge_results" TO "service_role";



GRANT ALL ON TABLE "public"."challenge_rules" TO "anon";
GRANT ALL ON TABLE "public"."challenge_rules" TO "authenticated";
GRANT ALL ON TABLE "public"."challenge_rules" TO "service_role";



GRANT ALL ON TABLE "public"."challenge_templates" TO "anon";
GRANT ALL ON TABLE "public"."challenge_templates" TO "authenticated";
GRANT ALL ON TABLE "public"."challenge_templates" TO "service_role";



GRANT ALL ON TABLE "public"."challenges" TO "anon";
GRANT ALL ON TABLE "public"."challenges" TO "authenticated";
GRANT ALL ON TABLE "public"."challenges" TO "service_role";



GRANT ALL ON TABLE "public"."club_announcements" TO "anon";
GRANT ALL ON TABLE "public"."club_announcements" TO "authenticated";
GRANT ALL ON TABLE "public"."club_announcements" TO "service_role";



GRANT ALL ON TABLE "public"."club_member_roles" TO "anon";
GRANT ALL ON TABLE "public"."club_member_roles" TO "authenticated";
GRANT ALL ON TABLE "public"."club_member_roles" TO "service_role";



GRANT ALL ON TABLE "public"."club_tournaments" TO "anon";
GRANT ALL ON TABLE "public"."club_tournaments" TO "authenticated";
GRANT ALL ON TABLE "public"."club_tournaments" TO "service_role";



GRANT ALL ON TABLE "public"."club_treasury_log" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."club_treasury_log" TO "authenticated";
GRANT ALL ON TABLE "public"."club_treasury_log" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."config_versions" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."config_versions" TO "authenticated";
GRANT ALL ON TABLE "public"."config_versions" TO "service_role";



GRANT ALL ON SEQUENCE "public"."config_versions_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."config_versions_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."config_versions_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."connected_accounts" TO "anon";
GRANT ALL ON TABLE "public"."connected_accounts" TO "authenticated";
GRANT ALL ON TABLE "public"."connected_accounts" TO "service_role";



GRANT ALL ON TABLE "public"."fraud_flags" TO "anon";
GRANT ALL ON TABLE "public"."fraud_flags" TO "authenticated";
GRANT ALL ON TABLE "public"."fraud_flags" TO "service_role";



GRANT ALL ON TABLE "public"."ledger_entries" TO "anon";
GRANT ALL ON TABLE "public"."ledger_entries" TO "authenticated";
GRANT ALL ON TABLE "public"."ledger_entries" TO "service_role";



GRANT ALL ON SEQUENCE "public"."ledger_entries_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."ledger_entries_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."ledger_entries_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."ledger_transactions" TO "anon";
GRANT ALL ON TABLE "public"."ledger_transactions" TO "authenticated";
GRANT ALL ON TABLE "public"."ledger_transactions" TO "service_role";



GRANT ALL ON TABLE "public"."permissions" TO "anon";
GRANT ALL ON TABLE "public"."permissions" TO "authenticated";
GRANT ALL ON TABLE "public"."permissions" TO "service_role";



GRANT ALL ON TABLE "public"."profile_settings" TO "anon";
GRANT ALL ON TABLE "public"."profile_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."profile_settings" TO "service_role";



GRANT ALL ON TABLE "public"."profiles" TO "anon";
GRANT ALL ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";



GRANT ALL ON TABLE "public"."role_permissions" TO "anon";
GRANT ALL ON TABLE "public"."role_permissions" TO "authenticated";
GRANT ALL ON TABLE "public"."role_permissions" TO "service_role";



GRANT ALL ON TABLE "public"."roles" TO "anon";
GRANT ALL ON TABLE "public"."roles" TO "authenticated";
GRANT ALL ON TABLE "public"."roles" TO "service_role";



GRANT ALL ON TABLE "public"."system_config_versions" TO "anon";
GRANT ALL ON TABLE "public"."system_config_versions" TO "authenticated";
GRANT ALL ON TABLE "public"."system_config_versions" TO "service_role";



GRANT ALL ON SEQUENCE "public"."system_config_versions_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."system_config_versions_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."system_config_versions_id_seq" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."system_settings" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."system_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."system_settings" TO "service_role";



GRANT ALL ON TABLE "public"."user_achievements" TO "anon";
GRANT ALL ON TABLE "public"."user_achievements" TO "authenticated";
GRANT ALL ON TABLE "public"."user_achievements" TO "service_role";



GRANT ALL ON TABLE "public"."user_avatar" TO "anon";
GRANT ALL ON TABLE "public"."user_avatar" TO "authenticated";
GRANT ALL ON TABLE "public"."user_avatar" TO "service_role";



GRANT ALL ON TABLE "public"."user_badges" TO "anon";
GRANT ALL ON TABLE "public"."user_badges" TO "authenticated";
GRANT ALL ON TABLE "public"."user_badges" TO "service_role";



GRANT ALL ON TABLE "public"."user_equipment" TO "anon";
GRANT ALL ON TABLE "public"."user_equipment" TO "authenticated";
GRANT ALL ON TABLE "public"."user_equipment" TO "service_role";



GRANT ALL ON TABLE "public"."user_inventory" TO "anon";
GRANT ALL ON TABLE "public"."user_inventory" TO "authenticated";
GRANT ALL ON TABLE "public"."user_inventory" TO "service_role";



GRANT ALL ON TABLE "public"."user_titles" TO "anon";
GRANT ALL ON TABLE "public"."user_titles" TO "authenticated";
GRANT ALL ON TABLE "public"."user_titles" TO "service_role";



GRANT ALL ON TABLE "public"."wallet_transactions" TO "anon";
GRANT ALL ON TABLE "public"."wallet_transactions" TO "authenticated";
GRANT ALL ON TABLE "public"."wallet_transactions" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";































