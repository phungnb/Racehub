-- 002400: Duyệt bài chuyên nghiệp + tùy chọn bắt buộc nhịp tim.
-- • Bài chạy bình thường được ghi nhận NGAY. Chỉ bài nghi gian lận mới chờ duyệt, kèm mức nghi vấn
--   (Trung bình / Cao / Rất cao) và lý do cụ thể. Bỏ luật cũ "pace chậm hơn 15:00 → chờ duyệt" (không phải gian lận).
-- • Bài chờ duyệt: báo cho người chạy và ban quản trị các CLB của họ; chủ nhiệm / quản trị viên CLB hoặc admin duyệt.
--   Duyệt xong báo kết quả cho người chạy.
-- • Thử thách có thể bật "Bắt buộc có nhịp tim": bài không có dữ liệu nhịp tim không được tính.
-- Cần file 002300. Chạy lại nhiều lần vẫn an toàn.

alter table public.challenges add column if not exists require_hr boolean not null default false;
alter table public.activities add column if not exists reviewed_by uuid references public.profiles(id) on delete set null;
alter table public.activities add column if not exists reviewed_at timestamptz;

-- Mức nghi vấn từ điểm 0–100, và nhãn tiếng Việt
create or replace function private.risk_level(p_score integer) returns text
language sql immutable as $$
  select case when p_score >= 85 then 'CRITICAL' when p_score >= 65 then 'HIGH' when p_score >= 35 then 'MEDIUM' else 'LOW' end
$$;
create or replace function private.risk_label(p_level text) returns text
language sql immutable as $$
  select case p_level when 'CRITICAL' then 'Rất cao' when 'HIGH' then 'Cao' when 'MEDIUM' then 'Trung bình' else 'Thấp' end
$$;

-- ---------------------------------------------------------------------
-- 1. Nhập bài từ Strava: chỉ nghi gian lận mới chờ duyệt, lý do có mức nghi vấn
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
  v_level text;
  v_score integer := 0;
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
  -- Chỉ bài NGHI GIAN LẬN mới chờ duyệt; bài chạy chậm / đi bộ vẫn được ghi nhận ngay (thử thách tự lọc theo pace riêng)
  if v_manual then
    v_status := 'PENDING'; v_level := 'HIGH'; v_score := 70;
    v_reason := 'Bài nhập tay — không có dữ liệu thiết bị (GPS, thời gian thực) để xác minh.';
  elsif v_sport = 'VirtualRun' then
    v_status := 'PENDING'; v_level := 'MEDIUM'; v_score := 40;
    v_reason := 'Chạy máy / chạy ảo — không có tuyến GPS để đối chiếu quãng đường.';
  elsif not v_has_gps then
    v_status := 'PENDING'; v_level := 'MEDIUM'; v_score := 40;
    v_reason := 'Bài không có tuyến GPS — không đối chiếu được quãng đường.';
  elsif v_pace < (cfg->>'minValidPace')::numeric * 60 then
    v_status := 'PENDING'; v_level := 'HIGH'; v_score := 75;
    v_reason := 'Pace trung bình ' || (v_pace / 60) || ':' || lpad((v_pace % 60)::text, 2, '0') || '/km — nhanh hơn kỷ lục thế giới.';
  elsif v_max_speed is not null and v_max_speed > 12 then
    v_status := 'PENDING'; v_level := 'HIGH'; v_score := 70;
    v_reason := 'Vận tốc tối đa ' || round(v_max_speed * 3.6) || ' km/h — vượt khả năng chạy bộ (> 43 km/h).';
  end if;
  -- Bộ phân tích gian lận (máy chủ ứng dụng, xem features/activity/model/fraud.ts) → chờ ban quản trị xác minh
  if v_status = 'APPROVED' and v_risk->>'verdict' = 'REVIEW' then
    v_status := 'PENDING';
    v_level := coalesce(v_risk->>'level', 'HIGH');
    v_score := coalesce((v_risk->>'score')::int, 65);
    v_reason := coalesce(nullif(v_risk->>'reason', ''), 'Dữ liệu bài chạy bất thường') || '.';
  end if;
  if v_status = 'PENDING' then
    v_reason := left('Mức nghi vấn: ' || private.risk_label(v_level) || '. ' || v_reason
                     || ' Bài được tính sau khi ban quản trị CLB hoặc admin xác minh.', 500);
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
    case when v_status = 'PENDING' then v_score else (v_risk->>'score')::int end,
    case when v_status = 'PENDING' then v_level else v_risk->>'level' end, v_risk->'flags')
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
-- 2. Bài GPS trong app: lý do có mức nghi vấn
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
    v_status := 'PENDING'; v_score := greatest(v_score, 40);
    v_reason := 'Bài không có dữ liệu GPS — không đối chiếu được quãng đường.';
  elsif v_pace < (cfg->>'minValidPace')::numeric * 60 then
    v_status := 'PENDING'; v_score := greatest(v_score, 75);
    v_reason := 'Pace trung bình nhanh hơn 3:00/km — vượt khả năng chạy bộ.';
  elsif v_veh >= 30 then
    v_status := 'PENDING'; v_score := greatest(v_score, 85);
    v_reason := 'Di chuyển ≥ 25 km/h liên tục ' || round(v_veh) || ' giây — giống đi xe.';
  elsif v_sev >= 120 then
    v_status := 'PENDING'; v_score := greatest(v_score, 70);
    v_reason := 'Giữ tốc độ ≥ 20 km/h (pace 3:00) liên tục ' || round(v_sev) || ' giây.';
  elsif v_nor >= 180 then
    v_status := 'PENDING'; v_score := greatest(v_score, 65);
    v_reason := 'Giữ tốc độ ≥ 17 km/h (pace 3:32) liên tục ' || round(v_nor) || ' giây.';
  elsif v_spikes > 3 then
    v_status := 'PENDING'; v_score := greatest(v_score, 50);
    v_reason := 'Vị trí GPS nhảy xa bất thường ' || v_spikes || ' lần (> 43 km/h).';
  elsif p_distance_m > 0 and abs(p_distance_m - v_distance) > greatest(0.15 * v_distance, 100) then
    v_status := 'PENDING'; v_score := greatest(v_score, 45);
    v_reason := 'Quãng đường app gửi lên lệch nhiều so với tuyến GPS.';
  end if;
  if v_status = 'PENDING' then
    v_reason := left('Mức nghi vấn: ' || private.risk_label(private.risk_level(v_score)) || '. ' || v_reason
                     || ' Bài được tính sau khi ban quản trị CLB hoặc admin xác minh.', 500);
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
    least(v_score, 100), private.risk_level(v_score),
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

-- ---------------------------------------------------------------------
-- 3. Báo khi bài vào hàng chờ duyệt: người chạy + ban quản trị các CLB của họ
-- ---------------------------------------------------------------------
create or replace function private.activity_pending_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare m record;
begin
  perform private.notify(new.user_id, null, 'RUN_REVIEW', 'Bài chạy đang chờ xác minh',
    coalesce(new.validation_reason, 'Bài chạy có dữ liệu bất thường.'), '/activities/' || new.id, null, true);
  for m in select distinct staff.user_id, staff.club_id
             from public.club_members runner
             join public.club_members staff on staff.club_id = runner.club_id
            where runner.user_id = new.user_id and runner.status = 'APPROVED'
              and staff.status = 'APPROVED' and staff.role in ('OWNER', 'CAPTAIN') and staff.user_id <> new.user_id loop
    perform private.notify(m.user_id, m.club_id, 'CLUB_RUN_REVIEW',
      private.display_name(new.user_id) || ' có bài chạy cần duyệt',
      round(coalesce(new.distance_m, 0) / 1000.0, 2) || ' km · ' || coalesce(new.validation_reason, ''),
      '/clubs/' || m.club_id || '/members?tab=review', new.user_id, true);
  end loop;
  return new;
end $$;

drop trigger if exists trg_activity_pending_notify on public.activities;
create trigger trg_activity_pending_notify
  after insert or update of validation_status on public.activities
  for each row when (new.validation_status = 'PENDING') execute function private.activity_pending_notify();

-- ---------------------------------------------------------------------
-- 4. Duyệt bài: admin hệ thống, hoặc chủ nhiệm / quản trị viên CLB có người chạy là thành viên
-- ---------------------------------------------------------------------
create or replace function private.can_review_activity(p_runner uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_system_admin() or exists (
    select 1 from public.club_members me join public.club_members runner on runner.club_id = me.club_id
     where me.user_id = auth.uid() and me.status = 'APPROVED' and me.role in ('OWNER', 'CAPTAIN')
       and runner.user_id = p_runner and runner.status = 'APPROVED')
$$;

create or replace function public.review_activity(p_activity_id uuid, p_status text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  a public.activities := (select x from public.activities x where x.id = p_activity_id and x.validation_status = 'PENDING');
begin
  if p_status not in ('APPROVED', 'REJECTED') then raise exception 'INVALID_STATUS'; end if;
  if a.id is null then raise exception 'ACTIVITY_NOT_PENDING'; end if;
  if a.user_id = v_uid or not private.can_review_activity(a.user_id) then raise exception 'FORBIDDEN'; end if;

  update public.activities
     set validation_status = p_status,
         status = case when p_status = 'APPROVED' then 'READY' else 'REJECTED' end,
         reviewed_by = v_uid, reviewed_at = now(), updated_at = now()
   where id = a.id;                      -- APPROVED → trigger trả thưởng + cộng vào thử thách

  insert into public.admin_audit_log (actor_id, action, target, new_value)
  values (v_uid, 'REVIEW_ACTIVITY', a.id::text, jsonb_build_object('status', p_status));

  perform private.notify(a.user_id, null, 'RUN_REVIEW',
    case when p_status = 'APPROVED' then 'Bài chạy đã được xác minh' else 'Bài chạy không được ghi nhận' end,
    round(coalesce(a.distance_m, 0) / 1000.0, 2) || ' km — ' ||
      case when p_status = 'APPROVED' then 'đã cộng Xu, XP và tính vào thử thách.'
           else 'ban quản trị xác định dữ liệu không hợp lệ.' end,
    '/activities/' || a.id, v_uid, true);
end $$;

-- Danh sách bài chờ duyệt của thành viên một CLB (cho ban quản trị CLB)
create or replace function public.club_pending_activities(p_club_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.club_is_staff(p_club_id) and not public.is_system_admin() then raise exception 'FORBIDDEN'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object(
      'id', a.id, 'title', a.title, 'distance_m', a.distance_m, 'moving_time_s', a.moving_time_s,
      'started_at', a.started_at, 'created_at', a.created_at, 'source', a.source,
      'validation_reason', a.validation_reason, 'risk_score', a.risk_score, 'risk_level', a.risk_level, 'risk_flags', a.risk_flags,
      'user_id', a.user_id, 'can_review', a.user_id <> auth.uid(),
      'profiles', jsonb_build_object('display_name', pr.display_name, 'avatar_url', pr.avatar_url))
      order by a.created_at desc), '[]'::jsonb)
    from public.activities a
    join public.club_members m on m.user_id = a.user_id and m.club_id = p_club_id and m.status = 'APPROVED'
    join public.profiles pr on pr.id = a.user_id
   where a.validation_status = 'PENDING' and coalesce(a.status, '') <> 'DELETED');
end $$;

-- ---------------------------------------------------------------------
-- 5. Thử thách: bắt buộc có nhịp tim
-- ---------------------------------------------------------------------
create or replace function private.challenge_apply_activity(p_activity_id uuid, p_only_participant uuid default null) returns integer
language plpgsql security definer set search_path = public as $$
declare
  a public.activities := (select x from public.activities x where x.id = p_activity_id);
  r record;
  v_day date;
  v_km numeric;
  v_already numeric;
  v_counted numeric;
  n integer := 0;
begin
  if a.id is null or a.user_id is null or a.validation_status is distinct from 'APPROVED'
     or not public.activity_is_countable(a.status, a.validation_status) then
    return 0;
  end if;
  v_km := greatest(coalesce(nullif(a.moving_distance_m, 0), a.distance_m, 0), 0) / 1000.0;
  v_day := (a.started_at at time zone 'Asia/Ho_Chi_Minh')::date;

  for r in
    select p.id as pid, c.*
      from public.challenge_participants p join public.challenges c on c.id = p.challenge_id
     where p.profile_id = a.user_id and p.status in ('JOINED', 'COMPLETED')
       and (p_only_participant is null or p.id = p_only_participant)
       and c.status = 'ACTIVE'
       and a.started_at >= c.start_date and a.started_at < c.end_date
  loop
    -- Luật: cự ly tối thiểu mỗi bài (trừ chuỗi ngày — cộng dồn trong ngày), khoảng pace, bắt buộc nhịp tim
    if r.objective <> 'STREAK_DAYS' and v_km < coalesce(r.min_km, 0) then continue; end if;
    if coalesce(a.avg_pace_s, 0) > 0 and (a.avg_pace_s < coalesce(r.min_pace, 0) * 60
                                          or a.avg_pace_s > coalesce(r.max_pace, 99) * 60) then continue; end if;
    if r.require_hr and coalesce(a.avg_heartrate, 0) <= 0 then continue; end if;

    v_counted := v_km * 1000;
    if coalesce(r.daily_cap_km, 0) > 0 then
      v_already := (select coalesce(sum(e.counted_m), 0) from public.challenge_progress_events e
                     where e.participant_id = r.pid and e.day = v_day and e.activity_id <> a.id);
      v_counted := least(v_counted, greatest(r.daily_cap_km * 1000 - v_already, 0));
    end if;

    insert into public.challenge_progress_events (challenge_id, participant_id, activity_id, day, distance_m, counted_m, moving_s)
    values (r.id, r.pid, a.id, v_day, v_km * 1000, v_counted, coalesce(a.moving_time_s, 0))
    on conflict (participant_id, activity_id) do nothing;
    if found then
      perform private.challenge_recompute_participant(r.pid);
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;

-- Ban quản trị đặt tùy chọn luật cho thử thách (trước giờ xuất phát): { require_hr: bool }
create or replace function public.set_challenge_options(p_challenge_id uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  c public.challenges := (select x from public.challenges x where x.id = p_challenge_id);
begin
  if c.id is null then raise exception 'CHALLENGE_NOT_FOUND'; end if;
  if not private.challenge_is_manager(c) then raise exception 'FORBIDDEN'; end if;
  if c.status <> 'ACTIVE' or now() >= c.start_date then raise exception 'CHALLENGE_RULES_LOCKED'; end if;
  update public.challenges set require_hr = coalesce((p->>'require_hr')::boolean, require_hr) where id = c.id;
  return jsonb_build_object('require_hr', (select x.require_hr from public.challenges x where x.id = c.id));
end $$;

-- ---------------------------------------------------------------------
-- 6. Quyền
-- ---------------------------------------------------------------------
revoke all on function public.ingest_provider_activity(uuid, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.ingest_provider_activity(uuid, text, text, jsonb) to service_role;
revoke all on function public.submit_and_process_activity(text, text, timestamptz, timestamptz, integer, integer, numeric, integer, jsonb) from public, anon;
grant execute on function public.submit_and_process_activity(text, text, timestamptz, timestamptz, integer, integer, numeric, integer, jsonb) to authenticated;
revoke all on function public.review_activity(uuid, text), public.club_pending_activities(uuid), public.set_challenge_options(uuid, jsonb) from public, anon;
grant execute on function public.review_activity(uuid, text), public.club_pending_activities(uuid), public.set_challenge_options(uuid, jsonb) to authenticated;
revoke all on function private.can_review_activity(uuid), private.activity_pending_notify() from public, anon, authenticated;

notify pgrst, 'reload schema';
