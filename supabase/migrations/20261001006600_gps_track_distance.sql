-- 006600: Quãng đường bài chạy trong app = đúng con số app đo (GPS-3).
-- Trước đây máy chủ cộng khoảng cách giữa các điểm tuyến. Điểm GPS luôn có nhiễu (rung ±5–15 m) nên cách cộng này
-- DƯ 2–11 % (mô phỏng: phố cao tầng +10,7 %), trong khi app đã hiệu chỉnh bằng vận tốc Doppler (lệch < 2 %).
-- Nay: mỗi điểm mang quãng đường tích luỹ app đo (distance_m). Máy chủ nhận từng đoạn nhưng KẸP theo hình học tuyến:
--   đoạn app báo ≤ 1,1 × khoảng cách thẳng giữa hai điểm + 3 m, và tổng ≤ tổng khoảng cách thẳng
--   → không thể khai khống quá tuyến GPS thật; app cũ (không gửi distance_m) dùng cách cũ.
-- Kèm: lưu quãng đường tích luỹ từng điểm + tính TỪNG KM ngay trên máy chủ (activity_details.splits).
-- Chạy lại nhiều lần vẫn an toàn.

alter table public.activity_track_points add column if not exists distance_m numeric;

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
    v_cd := case when jsonb_typeof(v_p->'distance_m') = 'number' then (v_p->>'distance_m')::numeric end;
    if v_prev is null then v_alt0 := case when jsonb_typeof(v_p->'altitude') = 'number' then (v_p->>'altitude')::numeric end; end if;
    if v_prev is not null then
      v_seg := private.haversine_m((v_prev->>'latitude')::numeric, (v_prev->>'longitude')::numeric,
                                   (v_p->>'latitude')::numeric, (v_p->>'longitude')::numeric);
      v_dt := extract(epoch from ((v_p->>'recorded_at')::timestamptz - (v_prev->>'recorded_at')::timestamptz));
      if v_dt > 0 and v_seg / v_dt > 12 then v_spikes := v_spikes + 1; end if;   -- > 43 km/h
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

notify pgrst, 'reload schema';
