-- 002300: Chống gian lận bài chạy.
-- • Bài từ Strava: máy chủ ứng dụng tải streams (time, distance, latlng, heartrate, cadence) và chạy bộ phân tích
--   features/activity/model/fraud.ts (tốc độ duy trì, đoạn đi xe, GPS nhảy, sải chân, nhịp tim so với pace,
--   so với lịch sử) → gửi kèm p_activity.risk. Kết luận REVIEW → bài chờ ban quản trị CLB xác minh
--   (không cộng Xu, không tính vào thử thách cho tới khi được duyệt).
-- • Bài ghi bằng GPS trong app: tính ngay trong CSDL cùng luật tốc độ duy trì / đoạn đi xe.
-- • Lưu mức rủi ro vào activities.risk_score / risk_level / risk_flags để ban quản trị xem khi duyệt.
-- Chạy lại nhiều lần vẫn an toàn.

alter table public.activities add column if not exists risk_score integer;
alter table public.activities add column if not exists risk_level text;
alter table public.activities add column if not exists risk_flags jsonb;

-- ---------------------------------------------------------------------
-- 1. Tiếp nhận bài từ Strava/Garmin/Coros: thêm p_activity.risk = {score, level, verdict, reason, flags}
-- ---------------------------------------------------------------------
create or replace function public.ingest_provider_activity(
  p_user_id uuid, p_source text, p_external_id text, p_activity jsonb
) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  cfg jsonb := private.economy_config();
  v_sport text := coalesce(p_activity->>'sport_type', 'Run');
  v_started timestamptz := (p_activity->>'started_at')::timestamptz;
  v_elapsed integer := greatest(coalesce((p_activity->>'elapsed_s')::numeric, 0), 0)::integer;
  v_moving integer := greatest(coalesce((p_activity->>'moving_s')::numeric, 0), 0)::integer;
  v_distance numeric := greatest(coalesce((p_activity->>'distance_m')::numeric, 0), 0);
  v_max_speed numeric := (p_activity->>'max_speed_mps')::numeric;
  v_manual boolean := coalesce((p_activity->>'manual')::boolean, false);
  v_has_gps boolean := coalesce((p_activity->>'has_gps')::boolean, true);
  v_ended timestamptz;
  v_pace integer;
  v_connected_at timestamptz;
  v_status text := 'APPROVED';
  v_reason text := 'Hợp lệ (đồng bộ tự động).';
  v_history_only boolean := false;
  v_existing public.activities%rowtype;
  v_id uuid;
  a public.activities%rowtype;
  v_risk jsonb := case when jsonb_typeof(p_activity->'risk') = 'object' then p_activity->'risk' end;
begin
  if p_source not in ('STRAVA', 'GARMIN', 'COROS') then raise exception 'INVALID_SOURCE'; end if;
  if p_external_id is null or v_started is null then raise exception 'INVALID_ACTIVITY'; end if;
  if not exists (select 1 from public.profiles where id = p_user_id) then raise exception 'USER_NOT_FOUND'; end if;

  -- Đã có → chỉ cập nhật tiêu đề (Strava gửi aspect "update" khi đổi tên)
  v_existing := (select x from public.activities x where x.source = p_source and x.source_activity_id = p_external_id);
  if v_existing.id is not null then
    if v_existing.user_id <> p_user_id then raise exception 'ACTIVITY_OWNER_MISMATCH'; end if;
    update public.activities
       set title = left(coalesce(nullif(trim(p_activity->>'title'), ''), title), 120), updated_at = now()
     where id = v_existing.id and title is distinct from left(coalesce(nullif(trim(p_activity->>'title'), ''), title), 120);
    return jsonb_build_object('result', case when found then 'UPDATED' else 'DUPLICATE' end,
                              'activity_id', v_existing.id, 'validation_status', v_existing.validation_status);
  end if;

  -- Không phải chạy bộ / quá ngắn → bỏ qua, không lưu
  if v_sport not in ('Run', 'TrailRun', 'VirtualRun') then
    return jsonb_build_object('result', 'SKIPPED', 'reason', 'NOT_RUN');
  end if;
  if v_distance < 200 or v_moving <= 0 then
    return jsonb_build_object('result', 'SKIPPED', 'reason', 'TOO_SHORT');
  end if;
  if v_started > now() + interval '10 minutes' then
    return jsonb_build_object('result', 'SKIPPED', 'reason', 'FUTURE_START');
  end if;

  v_ended := v_started + make_interval(secs => greatest(v_elapsed, v_moving));
  v_pace := round(v_moving / (v_distance / 1000.0));

  -- Cùng một buổi chạy đã được ghi từ nguồn khác (vd GPS trong app) → không tính 2 lần
  if exists (select 1 from public.activities
              where user_id = p_user_id and coalesce(status, '') <> 'DELETED'
                and started_at < v_ended and coalesce(ended_at, started_at) > v_started) then
    return jsonb_build_object('result', 'SKIPPED', 'reason', 'OVERLAPS_EXISTING_ACTIVITY');
  end if;

  -- Luật hợp lệ
  if v_manual then
    v_status := 'PENDING'; v_reason := 'Bài nhập tay (không có dữ liệu thiết bị) — chờ xác minh.';
  elsif v_sport = 'VirtualRun' then
    v_status := 'PENDING'; v_reason := 'Chạy máy / chạy ảo — chờ xác minh.';
  elsif not v_has_gps then
    v_status := 'PENDING'; v_reason := 'Thiếu dữ liệu GPS — chờ xác minh.';
  elsif v_pace < (cfg->>'minValidPace')::numeric * 60 then
    v_status := 'PENDING'; v_reason := 'Pace nhanh bất thường — chờ xác minh.';
  elsif v_pace > (cfg->>'maxValidPace')::numeric * 60 then
    v_status := 'PENDING'; v_reason := 'Pace chậm hơn giới hạn chạy bộ — chờ xác minh.';
  elsif v_max_speed is not null and v_max_speed > 12 then
    v_status := 'PENDING'; v_reason := 'Vận tốc tối đa > 43 km/h — chờ xác minh.';
  end if;
  -- Bộ phân tích gian lận (máy chủ ứng dụng, xem features/activity/model/fraud.ts) → chờ ban quản trị xác minh
  if v_status = 'APPROVED' and v_risk->>'verdict' = 'REVIEW' then
    v_status := 'PENDING';
    v_reason := left('Nghi vấn: ' || coalesce(nullif(v_risk->>'reason', ''), 'dữ liệu bất thường') || ' — chờ ban quản trị xác minh.', 400);
  end if;

  -- Bài chạy trước khi kết nối: lưu lịch sử, không thưởng (tránh "đổ" hàng tháng dữ liệu cũ lấy Xu)
  v_connected_at := (select max(ca.created_at) from public.connected_accounts ca
                      where ca.user_id = p_user_id and ca.provider = p_source);
  v_history_only := v_connected_at is not null and v_started < v_connected_at;

  v_id := gen_random_uuid();
  insert into public.activities (
    id, user_id, title, source, source_activity_id, sport_type, started_at, ended_at,
    elapsed_time_s, moving_time_s, distance_m, moving_distance_m, avg_pace_s,
    avg_speed_mps, max_speed_mps, avg_heartrate, elevation_gain_m, is_manual, device_name,
    status, validation_status, validation_reason, rewarded_at, earned_xu, earned_xp,
    risk_score, risk_level, risk_flags)
  values (
    v_id, p_user_id, left(coalesce(nullif(trim(p_activity->>'title'), ''), 'Buổi chạy'), 120), p_source, p_external_id, v_sport,
    v_started, v_ended, v_elapsed, v_moving, v_distance, v_distance, v_pace,
    (p_activity->>'avg_speed_mps')::numeric, v_max_speed, (p_activity->>'avg_heartrate')::numeric,
    coalesce((p_activity->>'elevation_gain_m')::numeric, 0), v_manual, left(p_activity->>'device_name', 80),
    case v_status when 'APPROVED' then 'READY' else 'PROCESSING' end, v_status,
    case when v_history_only then v_reason || ' Bài chạy trước khi kết nối — chỉ lưu lịch sử.' else v_reason end,
    case when v_history_only then now() end,
    case when v_history_only then 0 end,
    case when v_history_only then 0 end,
    (v_risk->>'score')::int, v_risk->>'level', v_risk->'flags')
  on conflict (source, source_activity_id) where source_activity_id is not null do nothing;

  if not exists (select 1 from public.activities x where x.id = v_id) then  -- request song song đã chèn trước
    v_id := (select x.id from public.activities x where x.source = p_source and x.source_activity_id = p_external_id);
    return jsonb_build_object('result', 'DUPLICATE', 'activity_id', v_id);
  end if;

  a := (select x from public.activities x where x.id = v_id);   -- trigger đã trả thưởng nếu APPROVED
  return jsonb_build_object('result', 'IMPORTED', 'activity_id', v_id,
    'validation_status', a.validation_status, 'reason', a.validation_reason,
    'history_only', v_history_only,
    'earned_xu', coalesce(a.earned_xu, 0), 'earned_xp', coalesce(a.earned_xp, 0));
end $$;

-- ---------------------------------------------------------------------
-- 2. Bài chạy GPS trong app: thêm luật tốc độ duy trì (cửa sổ 30 s) và đoạn đi xe
-- ---------------------------------------------------------------------
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
  -- Tốc độ duy trì (quãng đường trong cửa sổ 30 s) — cùng luật với features/activity/model/fraud.ts
  v_t numeric[] := '{}';
  v_c numeric[] := '{}';
  v_t0 timestamptz;
  v_i integer; v_j integer := 1; v_w numeric; v_sp numeric;
  v_run_sev numeric; v_run_nor numeric; v_run_veh numeric;
  v_sev numeric := 0; v_nor numeric := 0; v_veh numeric := 0;
  v_flags jsonb := '[]'::jsonb;
  v_score integer := 0;
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
    v_t0 := coalesce(v_t0, (v_p->>'recorded_at')::timestamptz, p_started_at);
    v_t := v_t || extract(epoch from (coalesce((v_p->>'recorded_at')::timestamptz, v_t0) - v_t0));
    v_c := v_c || v_gps_m;
    v_prev := v_p;
  end loop;

  -- Đoạn liên tục dài nhất có tốc độ ≥ 20 km/h, ≥ 17 km/h, ≥ 25 km/h
  for v_i in 2 .. coalesce(array_length(v_t, 1), 0) loop
    while v_j < v_i and v_t[v_i] - v_t[v_j] > 30 loop v_j := v_j + 1; end loop;
    v_w := v_t[v_i] - v_t[v_j];
    if v_w < 15 then continue; end if;
    v_sp := (v_c[v_i] - v_c[v_j]) / v_w;
    if v_sp >= 20 / 3.6 then v_run_sev := coalesce(v_run_sev, v_t[v_j]); v_sev := greatest(v_sev, v_t[v_i] - v_run_sev); else v_run_sev := null; end if;
    if v_sp >= 17 / 3.6 then v_run_nor := coalesce(v_run_nor, v_t[v_j]); v_nor := greatest(v_nor, v_t[v_i] - v_run_nor); else v_run_nor := null; end if;
    if v_sp >= 25 / 3.6 then v_run_veh := coalesce(v_run_veh, v_t[v_j]); v_veh := greatest(v_veh, v_t[v_i] - v_run_veh); else v_run_veh := null; end if;
  end loop;
  if v_veh >= 30 then
    v_flags := v_flags || jsonb_build_object('code', 'VEHICLE_BURST', 'severity', 'SEVERE', 'durationS', round(v_veh));
    v_score := v_score + 35;
  end if;
  if v_sev >= 120 then
    v_flags := v_flags || jsonb_build_object('code', 'SUSTAINED_SPEED', 'severity', 'SEVERE', 'durationS', round(v_sev));
    v_score := v_score + 35;
  elsif v_nor >= 180 then
    v_flags := v_flags || jsonb_build_object('code', 'SUSTAINED_SPEED', 'severity', 'HIGH', 'durationS', round(v_nor));
    v_score := v_score + 28;
  end if;
  if v_spikes > 3 then
    v_flags := v_flags || jsonb_build_object('code', 'GPS_TELEPORT', 'severity', 'HIGH', 'count', v_spikes);
    v_score := v_score + 20;
  end if;

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
  elsif v_veh >= 30 then
    v_status := 'PENDING'; v_reason := 'Nghi vấn: di chuyển ≥ 25 km/h trong ' || round(v_veh) || ' giây (giống đi xe) — chờ xác minh.';
  elsif v_sev >= 120 then
    v_status := 'PENDING'; v_reason := 'Nghi vấn: giữ tốc độ ≥ 20 km/h (pace 3:00) liên tục ' || round(v_sev) || ' giây — chờ xác minh.';
  elsif v_nor >= 180 then
    v_status := 'PENDING'; v_reason := 'Nghi vấn: giữ tốc độ ≥ 17 km/h (pace 3:32) liên tục ' || round(v_nor) || ' giây — chờ xác minh.';
  elsif v_spikes > 3 then
    v_status := 'PENDING'; v_reason := 'Phát hiện nhiều đoạn di chuyển > 43 km/h — chờ xác minh.';
  elsif p_distance_m > 0 and abs(p_distance_m - v_distance) > greatest(0.15 * v_distance, 100) then
    v_status := 'PENDING'; v_reason := 'Quãng đường gửi lên lệch nhiều so với GPS — chờ xác minh.';
  end if;

  v_activity := gen_random_uuid();
  insert into public.activities (
    id, user_id, title, source, started_at, ended_at, elapsed_time_s, moving_time_s,
    distance_m, moving_distance_m, avg_pace_s, status, validation_status, validation_reason,
    risk_score, risk_level, risk_flags)
  values (
    v_activity, v_uid, left(coalesce(nullif(trim(p_title), ''), 'Buổi chạy'), 120),
    case when p_source in ('DIRECT_GPS', 'STRAVA', 'GARMIN') then p_source else 'DIRECT_GPS' end,
    p_started_at, p_ended_at, greatest(coalesce(p_elapsed_s, 0), v_moving), v_moving,
    v_distance, v_distance, v_pace,
    case v_status when 'APPROVED' then 'READY' when 'PENDING' then 'PROCESSING' else 'REJECTED' end,
    v_status, v_reason,
    least(v_score, 100), case when v_score >= 85 then 'CRITICAL' when v_score >= 65 then 'HIGH' when v_score >= 35 then 'MEDIUM' else 'LOW' end,
    case when jsonb_array_length(v_flags) > 0 then v_flags end);

  for v_p in select value from jsonb_array_elements(v_points) loop
    v_seq := v_seq + 1;
    insert into public.activity_track_points (activity_id, sequence, latitude, longitude, accuracy, altitude, speed, recorded_at)
    values (v_activity, v_seq, (v_p->>'latitude')::numeric, (v_p->>'longitude')::numeric,
            (v_p->>'accuracy')::numeric, (v_p->>'altitude')::numeric, (v_p->>'speed')::numeric,
            coalesce((v_p->>'recorded_at')::timestamptz, p_started_at));
  end loop;

  if v_status = 'APPROVED' then
    v_reward := (select jsonb_build_object('earned_xu', x.earned_xu, 'earned_xp', x.earned_xp)
                   from public.activities x where x.id = v_activity);         -- trigger trg_auto_reward đã thưởng
  end if;

  return json_build_object(
    'success', true, 'activity_id', v_activity,
    'validation_status', v_status, 'validation_reason', v_reason,
    'distance_m', v_distance,
    'earned_xp', coalesce((v_reward->>'earned_xp')::integer, 0),
    'earned_xu', coalesce((v_reward->>'earned_xu')::numeric, 0));
end $$;

revoke all on function public.ingest_provider_activity(uuid, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.ingest_provider_activity(uuid, text, text, jsonb) to service_role;
revoke all on function public.submit_and_process_activity(text, text, timestamptz, timestamptz, integer, integer, numeric, integer, jsonb) from public, anon;
grant execute on function public.submit_and_process_activity(text, text, timestamptz, timestamptz, integer, integer, numeric, integer, jsonb) to authenticated;

notify pgrst, 'reload schema';
