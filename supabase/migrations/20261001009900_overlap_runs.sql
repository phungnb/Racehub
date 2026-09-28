-- 009900: MỘT TÀI KHOẢN — MỖI THỜI ĐIỂM CHỈ TÍNH MỘT BÀI CHẠY
-- Trường hợp cần xử lý: một tài khoản bật ghi trên nhiều thiết bị (dùng chung tài khoản, hoặc một người mang 2 máy),
-- ví dụ máy A chạy 2 giờ, trong khung giờ đó máy B cũng ghi vài bài ngắn hơn.
--   • Hai bài "trùng giờ" khi phần thời gian chồng nhau > 60 giây (chừa lệch đồng hồ giữa các máy).
--   • Chỉ bài DÀI NHẤT được tính: bài mới dài hơn tổng các bài trùng giờ đang được tính trên 10% → bài mới được tính, các bài
--     cũ chuyển "Không ghi nhận", thu hồi Xu / XP / nhiệm vụ / thử thách đã cộng. Ngược lại bài mới được lưu nhưng không tính.
--   • Bài mới nghi vấn (đang chờ xác minh) không được thay bài đã tính.
--   • Trước đây bài dài gửi sau bị báo "đã lưu" rồi mất; nay bài vẫn nằm trong lịch sử, ghi rõ lý do.
--   • Hai máy gửi CÙNG LÚC: khóa theo tài khoản trong lúc chèn, nên không còn lọt cả hai bài.
--   • Gửi lại đúng bài cũ (mạng chập chờn): vẫn báo ACTIVITY_DUPLICATE, không tạo bài mới.
-- Áp cho mọi đường ghi bài (GPS trong app, Strava / Garmin / COROS) qua trigger trước khi chèn.
-- Cần 009800. Chạy được trong SQL Editor: không DO $$, không SELECT INTO, không LIMIT, không RETURNING INTO. Chạy lại an toàn.

-- Quãng đường dùng để so bài (như khi tính thưởng)
create or replace function private.activity_meters(p_moving numeric, p_distance numeric) returns numeric
language sql immutable set search_path = public as $$
  select greatest(coalesce(nullif(p_moving, 0), p_distance, 0), 0)
$$;

-- Bài đang được tính (đã duyệt hoặc chờ xác minh) của một người, chồng giờ > 60 giây với [p_start, p_end]
create or replace function private.overlap_ids(p_user uuid, p_start timestamptz, p_end timestamptz, p_except uuid default null) returns uuid[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(x.id order by x.started_at), '{}')
    from public.activities x
   where x.user_id = p_user and x.id is distinct from p_except
     and coalesce(x.status, '') not in ('DELETED', 'REJECTED') and coalesce(x.validation_status, '') <> 'REJECTED'
     and x.started_at < p_end and coalesce(x.ended_at, x.started_at) > p_start
     and least(coalesce(x.ended_at, x.started_at), p_end) - greatest(x.started_at, p_start) > interval '60 seconds'
$$;

create or replace function private.overlap_meters(p_ids uuid[]) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(private.activity_meters(x.moving_distance_m, x.distance_m)), 0) from public.activities x where x.id = any(p_ids)
$$;

-- Thu hồi thưởng km (Xu + XP) của một bài đã thưởng. Nhiệm vụ / huy hiệu / điểm danh do trg_game_on_run_removed thu hồi
-- khi bài chuyển REJECTED; thử thách do trg_challenge_progress tính lại.
create or replace function private.revoke_run_reward(p_activity uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare a public.activities := (select x from public.activities x where x.id = p_activity for update);
begin
  if a.id is null or a.rewarded_at is null then return; end if;
  if coalesce(a.earned_xu, 0) > 0 then
    perform private.ledger_post('RUN_REWARD_REVERSAL', 'run_reward_reversal:' || a.id, p_reason, a.user_id,
      jsonb_build_array(
        jsonb_build_object('account_id', a.user_id, 'coin_kind', 'BONUS', 'amount', -a.earned_xu),
        jsonb_build_object('account_id', private.system_account(), 'coin_kind', 'BONUS', 'amount', a.earned_xu)),
      a.id, true);
  end if;
  if coalesce(a.earned_xp, 0) > 0 then
    update public.profiles
       set xp = greatest(coalesce(xp, 0) - a.earned_xp, 0), level = private.level_for_xp(greatest(coalesce(xp, 0) - a.earned_xp, 0))
     where id = a.user_id;
  end if;
  update public.activities set earned_xu = 0, earned_xp = 0 where id = a.id;
end $$;

-- Chạy TRƯỚC khi chèn, sau trg_aa_activity_shared và trg_ab_activity_review_scope (đã biết bài có nghi vấn hay không)
create or replace function private.activity_overlap_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_end timestamptz;
  v_ids uuid[];
  v_old numeric;
  v_new numeric;
  v_id uuid;
begin
  if new.user_id is null or new.started_at is null or coalesce(new.status, '') = 'DELETED' then return new; end if;
  -- Hai máy gửi cùng lúc: bài sau chờ bài trước ghi xong rồi mới so
  perform pg_advisory_xact_lock(hashtextextended('activity_overlap:' || new.user_id::text, 0));
  v_end := coalesce(new.ended_at, new.started_at + make_interval(secs => greatest(coalesce(new.elapsed_time_s, new.moving_time_s, 0), 0)));

  -- Gửi lại đúng bài cũ (không có mã bài của nguồn) → không tạo bài mới
  if new.source_activity_id is null and exists (
       select 1 from public.activities x
        where x.user_id = new.user_id and x.source is not distinct from new.source and x.source_activity_id is null
          and x.started_at = new.started_at and coalesce(x.ended_at, x.started_at) = v_end) then
    raise exception 'ACTIVITY_DUPLICATE';
  end if;

  v_ids := private.overlap_ids(new.user_id, new.started_at, v_end, new.id);
  if cardinality(v_ids) = 0 then return new; end if;
  v_old := private.overlap_meters(v_ids);
  v_new := private.activity_meters(new.moving_distance_m, new.distance_m);

  if new.validation_status = 'APPROVED' and new.rewarded_at is null and v_new > v_old * 1.1 then
    -- Bài mới dài hơn hẳn → tính bài mới, bỏ các bài trùng giờ
    foreach v_id in array v_ids loop
      perform private.revoke_run_reward(v_id, 'Thu hồi thưởng — bài trùng giờ với bài dài hơn');
    end loop;
    update public.activities
       set validation_status = 'REJECTED', status = 'REJECTED', validation_reason = 'Trùng giờ với bài chạy khác.',
           review_detail = left('Trùng giờ với bài ' || new.id || ' (' || round(v_new / 1000.0, 2) || ' km) — chỉ tính bài dài hơn.', 500),
           updated_at = now()
     where id = any(v_ids);
    return new;
  end if;

  -- Ngược lại: lưu bài mới vào lịch sử nhưng không tính
  new.review_detail := left('Trùng giờ với ' || array_to_string(v_ids, ', ') || ' (' || round(v_old / 1000.0, 2) || ' km đang được tính)'
                            || coalesce(' · ' || new.review_detail, '') || '.', 500);
  new.validation_status := 'REJECTED';
  new.status := 'REJECTED';
  new.validation_reason := 'Trùng giờ với bài chạy khác.';
  return new;
end $$;

drop trigger if exists trg_ac_activity_overlap on public.activities;
create trigger trg_ac_activity_overlap before insert on public.activities
  for each row execute function private.activity_overlap_guard();

revoke all on function private.activity_meters(numeric, numeric), private.overlap_ids(uuid, timestamptz, timestamptz, uuid),
  private.overlap_meters(uuid[]), private.revoke_run_reward(uuid, text), private.activity_overlap_guard() from public, anon, authenticated;

-- Strava / Garmin / COROS: bản 002400, chỉ đổi bước bỏ qua bài trùng giờ
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

  -- Cùng một buổi chạy đã được ghi từ nguồn khác (vd GPS trong app) → không tính 2 lần.
  -- 009900: trừ khi bài này dài hơn hẳn các bài trùng giờ đang được tính (vd đồng hồ ghi đủ 2 giờ, điện thoại chỉ ghi một đoạn)
  if exists (select 1 from public.activities
              where user_id = p_user_id and coalesce(status, '') <> 'DELETED'
                and started_at < v_ended and coalesce(ended_at, started_at) > v_started)
     and v_distance <= 1.1 * private.overlap_meters(private.overlap_ids(p_user_id, v_started, v_ended)) then
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

-- GPS trong app: bản 009100, chỉ đổi bước chặn trùng
create or replace function public.submit_and_process_activity(
  p_title text, p_source text, p_started_at timestamptz, p_ended_at timestamptz,
  p_elapsed_s integer, p_moving_s integer, p_distance_m numeric, p_avg_pace_s integer, p_track_points jsonb
) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_uid uuid := private.require_uid();
  cfg jsonb := private.economy_config();
  -- 009100: ngưỡng chống gian lận do admin đặt (Quản trị → Hệ thống → Chính sách vận hành)
  ac jsonb := private.ops_config()->'antiCheat';
  v_pace_min integer := round((private.ops_config()->'antiCheat'->>'minPaceMin')::numeric * 60);
  v_points jsonb := coalesce(p_track_points, '[]'::jsonb);
  v_n integer;
  v_gps_m numeric := 0;
  -- Quãng đường theo app (đã kẹp) + từng km
  v_trk_m numeric := 0;
  v_cd numeric;
  v_cd_prev numeric;
  v_step numeric;
  v_seg_t numeric;
  v_sd numeric := 0;
  v_st numeric := 0;
  v_over numeric;
  v_over_t numeric;
  v_alt0 numeric;
  v_splits jsonb := '[]'::jsonb;
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
  -- Mất tín hiệu GPS: đoạn > 60 giây và > 150 m giữa hai điểm liên tiếp (tắt màn hình, hầm…) = tuyến bị nối thẳng
  v_gaps integer := 0;
  v_gap_s numeric := 0;
  v_gap_m numeric := 0;
  v_score integer := 0;
begin
  -- Kiểm tra đầu vào cơ bản
  if p_started_at is null or p_ended_at is null or p_ended_at <= p_started_at then raise exception 'INVALID_TIME_RANGE'; end if;
  if p_started_at > now() + interval '5 minutes' then raise exception 'INVALID_TIME_RANGE'; end if;
  if p_ended_at - p_started_at > interval '24 hours' then raise exception 'ACTIVITY_TOO_LONG'; end if;
  if jsonb_typeof(v_points) <> 'array' then raise exception 'INVALID_TRACK_POINTS'; end if;
  v_n := jsonb_array_length(v_points);
  if v_n > 20000 then raise exception 'TOO_MANY_TRACK_POINTS'; end if;

  -- 009900: bài trùng giờ với bài khác do trigger trg_ac_activity_overlap xử lý (chỉ tính bài dài nhất);
  -- ở đây chỉ chặn gửi lại đúng bài cũ
  if exists (select 1 from public.activities
              where user_id = v_uid and source_activity_id is null
                and started_at = p_started_at and ended_at = p_ended_at) then
    raise exception 'ACTIVITY_DUPLICATE';
  end if;
  if (select count(*) from public.activities where user_id = v_uid and created_at > now() - interval '1 day') >= (ac->>'dailyRunLimit')::int then
    raise exception 'RATE_LIMITED';
  end if;

  -- Tính lại quãng đường từ GPS (không tin số client gửi)
  for v_p in select value from jsonb_array_elements(v_points) loop
    v_cd := case when jsonb_typeof(v_p->'distance_m') = 'number' then (v_p->>'distance_m')::numeric end;
    if v_prev is null then v_alt0 := case when jsonb_typeof(v_p->'altitude') = 'number' then (v_p->>'altitude')::numeric end; end if;
    if v_prev is not null then
      v_seg := private.haversine_m((v_prev->>'latitude')::numeric, (v_prev->>'longitude')::numeric,
                                   (v_p->>'latitude')::numeric, (v_p->>'longitude')::numeric);
      v_dt := extract(epoch from ((v_p->>'recorded_at')::timestamptz - (v_prev->>'recorded_at')::timestamptz));
      if v_dt > 0 and v_seg / v_dt > (ac->>'spikeKmh')::numeric / 3.6 then v_spikes := v_spikes + 1; end if;
      if v_dt > 60 and v_seg > 150 then v_gaps := v_gaps + 1; v_gap_s := v_gap_s + v_dt; v_gap_m := v_gap_m + v_seg; end if;
      v_gps_m := v_gps_m + coalesce(v_seg, 0);
      -- Đoạn theo app: có distance_m ở cả hai điểm → dùng, kẹp [0, 1,1 × đoạn thẳng + 3 m]; thiếu → đoạn thẳng
      v_step := case when v_cd is not null and v_cd_prev is not null
                     then least(greatest(v_cd - v_cd_prev, 0), 1.1 * coalesce(v_seg, 0) + 3)
                     else coalesce(v_seg, 0) end;
      v_trk_m := v_trk_m + v_step;
      -- Từng km: đoạn ≤ 30 s tính đủ giờ; dài hơn (đứng chờ / mất tín hiệu) chỉ tính phần di chuyển ước lượng ≥ 1,5 m/s
      if v_dt > 0 then
        v_seg_t := case when v_dt <= 30 then v_dt else least(v_dt, v_step / 1.5) end;
        v_sd := v_sd + v_step; v_st := v_st + v_seg_t;
        while v_sd >= 1000 loop
          v_over := v_sd - 1000;
          v_over_t := case when v_step > 0 then v_seg_t * v_over / v_step else 0 end;
          v_splits := v_splits || jsonb_build_object('distance_m', 1000, 'moving_s', greatest(0, round(v_st - v_over_t)),
            'elev_m', case when v_alt0 is not null and jsonb_typeof(v_p->'altitude') = 'number' then round(((v_p->>'altitude')::numeric - v_alt0) * 10) / 10 end,
            'hr', null);
          v_sd := v_over; v_st := v_over_t;
          v_alt0 := case when jsonb_typeof(v_p->'altitude') = 'number' then (v_p->>'altitude')::numeric end;
        end loop;
      end if;
    end if;
    v_cd_prev := v_cd;
    v_t0 := coalesce(v_t0, (v_p->>'recorded_at')::timestamptz, p_started_at);
    v_t := v_t || extract(epoch from (coalesce((v_p->>'recorded_at')::timestamptz, v_t0) - v_t0));
    v_c := v_c || v_trk_m;
    v_prev := v_p;
  end loop;

  -- Đoạn liên tục dài nhất có tốc độ ≥ 20 km/h, ≥ 17 km/h, ≥ 25 km/h
  for v_i in 2 .. coalesce(array_length(v_t, 1), 0) loop
    while v_j < v_i and v_t[v_i] - v_t[v_j] > 30 loop v_j := v_j + 1; end loop;
    v_w := v_t[v_i] - v_t[v_j];
    if v_w < 15 then continue; end if;
    v_sp := (v_c[v_i] - v_c[v_j]) / v_w;
    if v_sp >= (ac->>'severeKmh')::numeric / 3.6 then v_run_sev := coalesce(v_run_sev, v_t[v_j]); v_sev := greatest(v_sev, v_t[v_i] - v_run_sev); else v_run_sev := null; end if;
    if v_sp >= (ac->>'highKmh')::numeric / 3.6 then v_run_nor := coalesce(v_run_nor, v_t[v_j]); v_nor := greatest(v_nor, v_t[v_i] - v_run_nor); else v_run_nor := null; end if;
    if v_sp >= (ac->>'vehicleKmh')::numeric / 3.6 then v_run_veh := coalesce(v_run_veh, v_t[v_j]); v_veh := greatest(v_veh, v_t[v_i] - v_run_veh); else v_run_veh := null; end if;
  end loop;
  if v_veh >= (ac->>'vehicleS')::numeric then
    v_flags := v_flags || jsonb_build_object('code', 'VEHICLE_BURST', 'severity', 'SEVERE', 'durationS', round(v_veh));
    v_score := v_score + 35;
  end if;
  if v_sev >= (ac->>'severeS')::numeric then
    v_flags := v_flags || jsonb_build_object('code', 'SUSTAINED_SPEED', 'severity', 'SEVERE', 'durationS', round(v_sev));
    v_score := v_score + 35;
  elsif v_nor >= (ac->>'highS')::numeric then
    v_flags := v_flags || jsonb_build_object('code', 'SUSTAINED_SPEED', 'severity', 'HIGH', 'durationS', round(v_nor));
    v_score := v_score + 28;
  end if;
  if v_spikes > (ac->>'spikeMax')::int then
    v_flags := v_flags || jsonb_build_object('code', 'GPS_TELEPORT', 'severity', 'HIGH', 'count', v_spikes);
    v_score := v_score + 20;
  end if;

  if v_gaps > 0 then
    v_flags := v_flags || jsonb_build_object('code', 'GPS_GAP', 'severity', case when v_gap_m > greatest(500, 0.25 * v_gps_m) then 'HIGH' else 'INFO' end,
      'count', v_gaps, 'durationS', round(v_gap_s), 'meters', round(v_gap_m));
  end if;
  v_moving := least(greatest(coalesce(p_moving_s, 0), 0), extract(epoch from (p_ended_at - p_started_at))::integer);
  v_distance := case when v_n >= 2 then round(least(v_trk_m, v_gps_m)) else greatest(coalesce(p_distance_m, 0), 0) end;
  v_pace := case when v_distance > 0 then round(v_moving / (v_distance / 1000.0)) else 0 end;

  -- Luật xác thực (xem ADR-007)
  if v_distance < 200 then
    v_status := 'REJECTED'; v_reason := 'Quá ngắn (< 200 m), không đủ điều kiện ghi nhận.';
  elsif v_n < 2 then
    v_status := 'PENDING'; v_score := greatest(v_score, 40);
    v_reason := 'Bài không có dữ liệu GPS — không đối chiếu được quãng đường.';
  elsif v_pace < v_pace_min then
    v_status := 'PENDING'; v_score := greatest(v_score, 75);
    v_reason := 'Pace trung bình nhanh hơn ' || (v_pace_min / 60) || ':' || lpad((v_pace_min % 60)::text, 2, '0') || '/km — vượt khả năng chạy bộ.';
  elsif v_veh >= (ac->>'vehicleS')::numeric then
    v_status := 'PENDING'; v_score := greatest(v_score, 85);
    v_reason := 'Di chuyển ≥ ' || (ac->>'vehicleKmh') || ' km/h liên tục ' || round(v_veh) || ' giây — giống đi xe.';
  elsif v_sev >= (ac->>'severeS')::numeric then
    v_status := 'PENDING'; v_score := greatest(v_score, 70);
    v_reason := 'Giữ tốc độ ≥ ' || (ac->>'severeKmh') || ' km/h liên tục ' || round(v_sev) || ' giây.';
  elsif v_nor >= (ac->>'highS')::numeric then
    v_status := 'PENDING'; v_score := greatest(v_score, 65);
    v_reason := 'Giữ tốc độ ≥ ' || (ac->>'highKmh') || ' km/h liên tục ' || round(v_nor) || ' giây.';
  elsif v_spikes > (ac->>'spikeMax')::int then
    v_status := 'PENDING'; v_score := greatest(v_score, 50);
    v_reason := 'Vị trí GPS nhảy xa bất thường ' || v_spikes || ' lần (> ' || (ac->>'spikeKmh') || ' km/h).';
  elsif v_gap_m > greatest(500, 0.25 * v_gps_m) then
    v_status := 'PENDING'; v_score := greatest(v_score, 40);
    v_reason := 'Mất tín hiệu GPS ' || greatest(1, round(v_gap_s / 60)) || ' phút — ' || round(v_gap_m / 1000.0, 2)
                || ' km được nối thẳng, không đối chiếu được tuyến (thường do tắt màn hình khi ghi bằng trình duyệt).';
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

  -- 008500: ngoài thử thách / giải / chiến dịch, trigger tự duyệt bài nghi vấn → trả về trạng thái thật
  v_status := (select x.validation_status from public.activities x where x.id = v_activity);
  v_reason := (select x.validation_reason from public.activities x where x.id = v_activity);

  for v_p in select value from jsonb_array_elements(v_points) loop
    v_seq := v_seq + 1;
    insert into public.activity_track_points (activity_id, sequence, latitude, longitude, accuracy, altitude, speed, recorded_at, distance_m)
    values (v_activity, v_seq, (v_p->>'latitude')::numeric, (v_p->>'longitude')::numeric,
            (v_p->>'accuracy')::numeric, (v_p->>'altitude')::numeric, (v_p->>'speed')::numeric,
            coalesce((v_p->>'recorded_at')::timestamptz, p_started_at), round(v_c[v_seq], 1));
  end loop;

  -- Từng km (km lẻ cuối ≥ 100 m) — màn chi tiết bài chạy đọc thẳng, khớp quãng đường đã lưu
  if v_n >= 2 then
    if v_sd >= 100 and v_st > 0 then
      v_splits := v_splits || jsonb_build_object('distance_m', round(v_sd), 'moving_s', round(v_st), 'elev_m', null, 'hr', null);
    end if;
    insert into public.activity_details (activity_id, splits, start_lat, start_lng, detailed)
    values (v_activity, v_splits, (v_points->0->>'latitude')::numeric, (v_points->0->>'longitude')::numeric, true)
    on conflict (activity_id) do update set splits = excluded.splits;
  end if;

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
