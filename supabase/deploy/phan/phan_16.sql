-- RaceHub — PHẦN 16/17 (tạo tự động bằng scripts/db-bundle.mjs — KHÔNG sửa tay).
-- Gồm: 010000, 010100, 010200, 010300
-- Supabase → SQL Editor → New query → dán TOÀN BỘ phần này → Run. Lỗi thì không có gì thay đổi; chạy lại vẫn an toàn.
-- Xong thì chạy phần tiếp theo.
begin;
-- ===================================================================
-- 20261001010000_gps_policy_v1.sql
-- ===================================================================
-- 010000: CHÍNH SÁCH CHỐNG GIAN LẬN GPS V1 — ưu tiên công nhận bài chạy, chỉ giữ bài có dấu hiệu bất thường RÕ RÀNG.
--   • Mất GPS một đoạn KHÔNG phải gian lận: tính đủ quãng đường, không trừ km. Chỉ giữ bài khi đoạn nối thẳng nhanh như đi xe
--     (> antiCheat.severeKmh) hoặc chiếm hơn antiCheat.gapReviewPct % bài chạy (mặc định 50; 100 = không bao giờ giữ vì mất GPS).
--     Ví dụ bài xe máy tắt GPS 2,99 / 3,01 km vẫn bị giữ; bài mất GPS 1 km trong 10 km được tính đủ 10 km.
--   • GPS nhảy xa: đoạn nhảy không được tính vào km (không thể làm tăng quãng đường); chỉ giữ bài khi hơn 10% số điểm bị nhảy (tuyến không đáng tin).
--   • Số km app gửi lệch với tuyến GPS: chỉ ghi nhận (máy chủ luôn tự tính km từ tuyến), không giữ bài.
--   • Giữ nguyên: tốc độ phi thực tế / đi xe, pace nhanh hơn ngưỡng, bài không có GPS, bài nhập tay (Strava) → chờ xác minh.
--   • Trùng giờ / trùng nguồn: 009900 (chỉ tính một bài). Admin không phải duyệt tay từng bài.
-- Cần 009900. Chạy được trong SQL Editor: không DO $$, không SELECT INTO, không LIMIT, không RETURNING INTO. Chạy lại an toàn.

create or replace function private.ops_defaults() returns jsonb
language sql immutable set search_path = public as $$
  select jsonb_build_object(
    'features', jsonb_build_object('nearby', true, 'market', true, 'bibMarket', true, 'knowledge', true, 'races', true, 'cups', true, 'orgs', true),
    'tracking', jsonb_build_object('autoPauseAfterS', 10, 'longStopAskMin', 10, 'longStopAutoStopMin', 30, 'trimTailMin', 2),
    'antiCheat', jsonb_build_object('dailyRunLimit', 20, 'minPaceMin', 3, 'vehicleKmh', 25, 'vehicleS', 30, 'severeKmh', 20, 'severeS', 120,
                                    'highKmh', 17, 'highS', 180, 'spikeKmh', 43, 'spikeMax', 3, 'autoApproveMaxScore', 0, 'gapReviewPct', 50),
    'content', jsonb_build_object('enterprise', jsonb_build_object(
      'title', 'Phong trào chạy bộ cho cả tổ chức',
      'subtitle', 'Chiến dịch, bảng xếp hạng phòng ban, quản lý nhiều CLB và báo cáo cho nhân sự — tự động từ Strava và GPS, không cần bảng tính.',
      'features', jsonb_build_array(
        jsonb_build_object('title', 'Chiến dịch sức khoẻ', 'text', 'Tạo chiến dịch theo tổng km, số buổi hoặc số ngày chạy; mục tiêu chung cả tổ chức và mục tiêu mỗi người.'),
        jsonb_build_object('title', 'Xếp hạng theo đơn vị', 'text', 'Phòng ban, chi nhánh, lớp hoặc CLB thi đua với nhau — tính cả tổng và bình quân đầu người cho công bằng.'),
        jsonb_build_object('title', 'Quản lý nhiều CLB', 'text', 'Liên đoàn mời CLB tham gia; thành viên CLB tự được tính vào chiến dịch. Có thể tài trợ CLB Pro cho cả hệ thống.'),
        jsonb_build_object('title', 'Báo cáo cho nhân sự', 'text', 'km, số buổi, số ngày chạy của từng người theo khoảng ngày; mã nhân viên, đơn vị; xuất Excel.'),
        jsonb_build_object('title', 'Thương hiệu riêng', 'text', 'Logo, ảnh bìa, màu chủ đề, khẩu hiệu; bảng tin nội bộ như một CLB lớn; chứng nhận hoàn thành thiết kế theo mẫu công ty.'),
        jsonb_build_object('title', 'Quản lý như phòng nhân sự', 'text', 'Tự duyệt theo email công ty, nhập danh sách từ Excel, đơn vị nhiều cấp, trưởng đơn vị tự quản lý người của mình.'),
        jsonb_build_object('title', 'Trao giải minh bạch', 'text', 'Chốt kết quả, duyệt top trước khi trao, ngày hội ×2 / ×3, quay thưởng may mắn có mã kiểm chứng.'),
        jsonb_build_object('title', 'Chống gian lận, tôn trọng riêng tư', 'text', 'Chỉ tính bài chạy hợp lệ (GPS, pace, duyệt); người chạy tắt chia sẻ bài nào thì bài đó không vào bảng.'))),
      'plans', private.plan_content_defaults()))
$$;

create or replace function private.valid_ops(c jsonb) returns boolean
language sql immutable as $$
  select private.ops_num_ok(c, 'tracking', 'autoPauseAfterS', 5, 60)
     and private.ops_num_ok(c, 'tracking', 'longStopAskMin', 3, 60)
     and private.ops_num_ok(c, 'tracking', 'longStopAutoStopMin', 10, 240)
     and private.ops_num_ok(c, 'tracking', 'trimTailMin', 1, 30)
     and (c->'tracking'->>'longStopAutoStopMin')::numeric > (c->'tracking'->>'longStopAskMin')::numeric
     and private.ops_num_ok(c, 'antiCheat', 'dailyRunLimit', 3, 100)
     and private.ops_num_ok(c, 'antiCheat', 'minPaceMin', 2, 5)
     and private.ops_num_ok(c, 'antiCheat', 'vehicleKmh', 20, 60)
     and private.ops_num_ok(c, 'antiCheat', 'vehicleS', 10, 600)
     and private.ops_num_ok(c, 'antiCheat', 'severeKmh', 15, 40)
     and private.ops_num_ok(c, 'antiCheat', 'severeS', 30, 1800)
     and private.ops_num_ok(c, 'antiCheat', 'highKmh', 12, 35)
     and private.ops_num_ok(c, 'antiCheat', 'highS', 30, 3600)
     and private.ops_num_ok(c, 'antiCheat', 'spikeKmh', 30, 150)
     and private.ops_num_ok(c, 'antiCheat', 'spikeMax', 1, 100)
     and private.ops_num_ok(c, 'antiCheat', 'autoApproveMaxScore', 0, 100)
     and private.ops_num_ok(c, 'antiCheat', 'gapReviewPct', 10, 100)
     and (c->'antiCheat'->>'highKmh')::numeric < (c->'antiCheat'->>'severeKmh')::numeric
     and (c->'antiCheat'->>'severeKmh')::numeric < (c->'antiCheat'->>'vehicleKmh')::numeric
     and not exists (select 1 from jsonb_each(c->'features') f where jsonb_typeof(f.value) <> 'boolean')
     and jsonb_typeof(c->'content'->'enterprise') = 'object'
     and char_length(coalesce(c->'content'->'enterprise'->>'title', '')) between 3 and 90
     and char_length(coalesce(c->'content'->'enterprise'->>'subtitle', '')) <= 400
     and jsonb_typeof(c->'content'->'enterprise'->'features') = 'array'
     and jsonb_array_length(c->'content'->'enterprise'->'features') between 1 and 12
     and not exists (select 1 from jsonb_array_elements(c->'content'->'enterprise'->'features') f
                      where char_length(coalesce(f->>'title', '')) not between 2 and 60 or char_length(coalesce(f->>'text', '')) > 300)
     and private.valid_plan_content(c->'content'->'plans')
$$;

-- GPS trong app: bản 009900, đổi phần mất tín hiệu / điểm nhảy / lệch km
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
  -- 010000: đoạn mất GPS có tốc độ nối thẳng như đi xe; điểm nhảy xa (không tính vào quãng đường)
  v_gap_fast integer := 0;
  v_jump_m numeric := 0;
  v_fast boolean;
  v_prev_fast boolean := false;
  v_prev_step numeric := 0;
  v_prev2 jsonb;
  v_direct numeric;
  v_dt2 numeric;
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
      -- Mất tín hiệu (> 60 giây, > 150 m): tính đủ đoạn nối thẳng; chỉ đáng ngờ khi tốc độ nối thẳng như đi xe.
      v_fast := false;
      if v_dt > 60 and v_seg > 150 then
        v_gaps := v_gaps + 1; v_gap_s := v_gap_s + v_dt; v_gap_m := v_gap_m + v_seg;
        if v_seg / v_dt > (ac->>'severeKmh')::numeric / 3.6 then v_gap_fast := v_gap_fast + 1; end if;
      elsif v_dt > 0 and v_seg / v_dt > (ac->>'spikeKmh')::numeric / 3.6 then
        v_fast := true;
      end if;
      v_gps_m := v_gps_m + coalesce(v_seg, 0);
      -- Đoạn theo app: có distance_m ở cả hai điểm → dùng, kẹp [0, 1,1 × đoạn thẳng + 3 m]; thiếu → đoạn thẳng
      v_step := case when v_cd is not null and v_cd_prev is not null
                     then least(greatest(v_cd - v_cd_prev, 0), 1.1 * coalesce(v_seg, 0) + 3)
                     else coalesce(v_seg, 0) end;
      -- Điểm nhảy (vọt ra xa rồi quay về ngay): bỏ hai đoạn qua điểm đó, nối thẳng từ điểm trước nó → GPS nhảy không làm tăng km.
      -- Di chuyển nhanh LIÊN TỤC (đi xe) không phải điểm nhảy: vẫn tính và vẫn bị kiểm tra tốc độ bên dưới.
      if v_fast and v_prev_fast and v_prev2 is not null then
        v_direct := private.haversine_m((v_prev2->>'latitude')::numeric, (v_prev2->>'longitude')::numeric,
                                        (v_p->>'latitude')::numeric, (v_p->>'longitude')::numeric);
        v_dt2 := extract(epoch from ((v_p->>'recorded_at')::timestamptz - (v_prev2->>'recorded_at')::timestamptz));
        if v_dt2 > 0 and v_direct / v_dt2 <= (ac->>'spikeKmh')::numeric / 3.6 then
          v_spikes := v_spikes + 1;
          v_jump_m := v_jump_m + v_prev_step + v_step;
          v_trk_m := v_trk_m - v_prev_step;
          v_sd := greatest(v_sd - v_prev_step, 0);
          v_c[array_length(v_c, 1)] := v_trk_m;
          v_step := v_direct;
          v_fast := false;
        end if;
      end if;
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
      v_prev_fast := v_fast;
      v_prev_step := v_step;
    end if;
    v_cd_prev := v_cd;
    v_t0 := coalesce(v_t0, (v_p->>'recorded_at')::timestamptz, p_started_at);
    v_t := v_t || extract(epoch from (coalesce((v_p->>'recorded_at')::timestamptz, v_t0) - v_t0));
    v_c := v_c || v_trk_m;
    v_prev2 := v_prev;
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
    v_flags := v_flags || jsonb_build_object('code', 'GPS_TELEPORT', 'severity', case when v_spikes > 0.1 * v_n then 'HIGH' else 'INFO' end,
      'count', v_spikes, 'meters', round(v_jump_m));
    v_score := v_score + 20;
  end if;

  if v_gaps > 0 then
    v_flags := v_flags || jsonb_build_object('code', 'GPS_GAP',
      'severity', case when v_gap_fast > 0 or v_gap_m > (ac->>'gapReviewPct')::numeric / 100 * greatest(least(v_trk_m, v_gps_m), 1) then 'HIGH' else 'INFO' end,
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
  -- 010000 (chính sách V1): một dấu hiệu nhẹ không giữ bài. Điểm nhảy đã bị loại khỏi km, lệch số km app gửi chỉ ghi nhận
  -- (máy chủ luôn tự tính km); mất GPS chỉ giữ bài khi đoạn nối thẳng nhanh như đi xe hoặc chiếm phần lớn bài chạy.
  elsif v_spikes > (ac->>'spikeMax')::int and v_spikes > 0.1 * v_n then
    v_status := 'PENDING'; v_score := greatest(v_score, 50);
    v_reason := 'Vị trí GPS nhảy xa bất thường ' || v_spikes || ' / ' || v_n || ' điểm (> ' || (ac->>'spikeKmh') || ' km/h) — tuyến không đáng tin.';
  elsif v_gap_fast > 0 then
    v_status := 'PENDING'; v_score := greatest(v_score, 60);
    v_reason := 'Mất tín hiệu GPS ' || greatest(1, round(v_gap_s / 60)) || ' phút — đoạn nối thẳng nhanh hơn ' || (ac->>'severeKmh') || ' km/h.';
  elsif v_gap_m > (ac->>'gapReviewPct')::numeric / 100 * greatest(v_distance, 1) then
    v_status := 'PENDING'; v_score := greatest(v_score, 40);
    v_reason := 'Mất tín hiệu GPS ' || greatest(1, round(v_gap_s / 60)) || ' phút — ' || round(v_gap_m / 1000.0, 2) || ' / '
                || round(v_distance / 1000.0, 2) || ' km không có tuyến (> ' || (ac->>'gapReviewPct') || '% bài chạy).';
  end if;
  if p_distance_m > 0 and abs(p_distance_m - v_distance) > greatest(0.15 * v_distance, 100) then
    v_flags := v_flags || jsonb_build_object('code', 'DISTANCE_MISMATCH', 'severity', 'INFO', 'meters', round(p_distance_m - v_distance));
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

revoke all on function private.ops_defaults(), private.valid_ops(jsonb) from public, anon, authenticated;

notify pgrst, 'reload schema';

-- ===================================================================
-- 20261001010100_qa_hardening.sql
-- ===================================================================
-- 010100: VÁ SAU NGHIỆM THU
-- 1. Chín bảng tạo sau này còn quyền ghi mặc định (INSERT / UPDATE / DELETE) cho anon và authenticated. RLS không có luật ghi
--    nên thực tế đã bị chặn, nhưng thu hồi để hai lớp bảo vệ: mọi thao tác ghi chỉ đi qua RPC đã kiểm tra quyền.
-- 2. Yêu cầu báo giá Doanh nghiệp (gửi được khi chưa đăng nhập): trước chỉ giới hạn theo số điện thoại → đổi số là gửi được
--    hàng loạt, spam thông báo tới admin. Thêm giới hạn 5 / ngày mỗi tài khoản và 20 / giờ cho toàn bộ khách chưa đăng nhập.
-- Chạy được trong SQL Editor: không DO $$, không SELECT INTO, không LIMIT, không RETURNING INTO. Chạy lại an toàn.

revoke insert, update, delete, truncate on public.challenge_honor_prefs, public.challenge_honorees, public.challenge_honors,
  public.item_promo_redemptions, public.item_promotions, public.partners, public.voucher_campaigns, public.voucher_codes,
  public.voucher_grants from anon, authenticated;

create index if not exists org_leads_user_idx on public.org_leads (user_id, created_at desc);

create or replace function public.request_enterprise_quote(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_phone text := regexp_replace(trim(coalesce(p->>'phone', '')), '\s+', ' ', 'g');
  v_id uuid;
  a record;
begin
  if char_length(trim(coalesce(p->>'contact_name', ''))) < 2 then raise exception 'NAME_REQUIRED'; end if;
  if char_length(trim(coalesce(p->>'org_name', ''))) < 2 then raise exception 'ORG_NAME_REQUIRED'; end if;
  if v_phone !~ '^[0-9+ .()-]{8,20}$' then raise exception 'INVALID_PHONE'; end if;
  if (select count(*) from public.org_leads l where l.phone = v_phone and l.created_at > now() - interval '1 day') >= 3 then
    raise exception 'RATE_LIMITED';
  end if;
  -- 010100: đổi số điện thoại để gửi hàng loạt → giới hạn thêm theo tài khoản và tổng số yêu cầu chưa đăng nhập
  if auth.uid() is not null
     and (select count(*) from public.org_leads l where l.user_id = auth.uid() and l.created_at > now() - interval '1 day') >= 5 then
    raise exception 'RATE_LIMITED';
  end if;
  if auth.uid() is null
     and (select count(*) from public.org_leads l where l.user_id is null and l.created_at > now() - interval '1 hour') >= 20 then
    raise exception 'RATE_LIMITED';
  end if;
  v_id := gen_random_uuid();
  insert into public.org_leads (id, user_id, contact_name, org_name, kind, size, phone, email, note)
  values (v_id, auth.uid(), left(trim(p->>'contact_name'), 80), left(trim(p->>'org_name'), 120),
          case when p->>'kind' in ('COMPANY', 'FEDERATION', 'SCHOOL', 'OTHER') then p->>'kind' else 'OTHER' end,
          case when coalesce(p->>'size', '') ~ '^[0-9]{1,7}$' then greatest((p->>'size')::int, 1) end, v_phone,
          nullif(left(trim(coalesce(p->>'email', '')), 120), ''), nullif(left(trim(coalesce(p->>'note', '')), 1000), ''));
  for a in select pr.id from public.profiles pr where pr.role = 'SYSTEM_ADMIN' loop
    perform private.notify(a.id, null, 'ENTERPRISE_LEAD', 'Yêu cầu báo giá Doanh nghiệp: ' || left(trim(p->>'org_name'), 80),
      left(trim(p->>'contact_name'), 80) || ' · ' || v_phone, '/admin?tab=enterprise', auth.uid(), true);
  end loop;
  return jsonb_build_object('id', v_id);
end $$;

notify pgrst, 'reload schema';

-- ===================================================================
-- 20261001010200_race_rename.sql
-- ===================================================================
-- 010200: ĐỔI TÊN "Giải chạy ảo" → "Giải chạy" (tên tính năng, không đổi chức năng).
-- Đổi chữ trong: trang Hướng dẫn / Điều khoản / Quyền riêng tư, bài Kiến thức, thông báo cấp quyền tổ chức giải,
-- lý do trừ Xu khi tạo giải, thẻ gói mặc định. Thông báo / giao dịch đã gửi trước đây giữ nguyên chữ cũ.
-- Chạy được trong SQL Editor: không DO $$, không SELECT INTO, không LIMIT, không RETURNING INTO. Chạy lại an toàn.

update public.help_pages
   set title = replace(replace(replace(title, 'GIẢI CHẠY ẢO', 'GIẢI CHẠY'), 'Giải chạy ảo', 'Giải chạy'), 'giải chạy ảo', 'giải chạy'), summary = replace(replace(replace(summary, 'GIẢI CHẠY ẢO', 'GIẢI CHẠY'), 'Giải chạy ảo', 'Giải chạy'), 'giải chạy ảo', 'giải chạy'), body = replace(replace(replace(body, 'GIẢI CHẠY ẢO', 'GIẢI CHẠY'), 'Giải chạy ảo', 'Giải chạy'), 'giải chạy ảo', 'giải chạy')
 where title ilike '%chạy ảo%' or summary ilike '%chạy ảo%' or body ilike '%giải chạy ảo%';

update public.content_articles
   set title = replace(replace(replace(title, 'GIẢI CHẠY ẢO', 'GIẢI CHẠY'), 'Giải chạy ảo', 'Giải chạy'), 'giải chạy ảo', 'giải chạy'), summary = replace(replace(replace(summary, 'GIẢI CHẠY ẢO', 'GIẢI CHẠY'), 'Giải chạy ảo', 'Giải chạy'), 'giải chạy ảo', 'giải chạy'), body = replace(replace(replace(body, 'GIẢI CHẠY ẢO', 'GIẢI CHẠY'), 'Giải chạy ảo', 'Giải chạy'), 'giải chạy ảo', 'giải chạy'), ctas = replace(replace(replace(ctas::text, 'GIẢI CHẠY ẢO', 'GIẢI CHẠY'), 'Giải chạy ảo', 'Giải chạy'), 'giải chạy ảo', 'giải chạy')::jsonb
 where title ilike '%giải chạy ảo%' or summary ilike '%giải chạy ảo%' or body ilike '%giải chạy ảo%' or ctas::text ilike '%giải chạy ảo%';

-- Thông báo khi admin cấp quyền tổ chức giải (bản 003800, chỉ đổi chữ)
create or replace function public.admin_set_race_organizer(p_owner_type text, p_owner_id uuid, p_allow boolean, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := private.require_admin();
begin
  if upper(p_owner_type) not in ('USER', 'CLUB') then raise exception 'INVALID_OWNER'; end if;
  if p_allow then
    insert into public.race_organizer_grants (owner_type, owner_id, note, granted_by) values (upper(p_owner_type), p_owner_id, p_note, v_uid)
    on conflict (owner_type, owner_id) do update set note = excluded.note, granted_by = excluded.granted_by, created_at = now();
    if upper(p_owner_type) = 'CLUB' then
      perform private.notify_club(p_owner_id, true, 'CLUB_PRO', 'CLB được cấp quyền tổ chức giải chạy', null, '/races/new', v_uid);
    else
      perform private.notify(p_owner_id, null, 'VIP', 'Bạn được cấp quyền tổ chức giải chạy', null, '/races/new', v_uid, true);
    end if;
  else
    delete from public.race_organizer_grants where owner_type = upper(p_owner_type) and owner_id = p_owner_id;
  end if;
  insert into public.admin_audit_log (actor_id, action, target, new_value)
  values (v_uid, 'RACE_ORGANIZER', p_owner_id::text, jsonb_build_object('type', upper(p_owner_type), 'allow', p_allow, 'note', p_note));
end $$;

-- Tạo giải: lý do trừ phí trong lịch sử Xu (bản 003800, chỉ đổi chữ)
create or replace function public.create_virtual_race(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  v_id uuid := gen_random_uuid();
  v_club uuid := nullif(p->>'club_id', '')::uuid;
  v_title text := trim(coalesce(p->>'title', ''));
  v_start timestamptz := (p->>'start_at')::timestamptz;
  v_end timestamptz := (p->>'end_at')::timestamptz;
  v_close timestamptz := coalesce(nullif(p->>'reg_close_at', '')::timestamptz, (p->>'end_at')::timestamptz);
  v_aud text := upper(coalesce(p->>'audience', 'PUBLIC'));
  v_max integer := nullif(p->>'max_participants', '')::integer;
  v_prefix text := upper(coalesce(nullif(trim(p->>'bib_prefix'), ''), 'RH'));
  v_dist numeric[];
  v_admin boolean := public.is_system_admin();
  v_payer uuid;
  v_fee integer := 0;
  v_pass uuid;
begin
  if not v_admin then
    if v_club is not null then
      if not public.club_is_staff(v_club) then raise exception 'FORBIDDEN'; end if;
      if not exists (select 1 from public.race_organizer_grants g where g.owner_type = 'CLUB' and g.owner_id = v_club) then raise exception 'RACE_ORGANIZER_REQUIRED'; end if;
    elsif not exists (select 1 from public.race_organizer_grants g where g.owner_type = 'USER' and g.owner_id = v_uid) then
      raise exception 'RACE_ORGANIZER_REQUIRED';
    end if;
    if v_max is null then raise exception 'CAPACITY_REQUIRED'; end if;
  end if;
  if length(v_title) < 3 or length(v_title) > 120 then raise exception 'INVALID_TITLE'; end if;
  if v_start is null or v_end is null or v_end <= v_start then raise exception 'INVALID_TIME_RANGE'; end if;
  if v_end < now() or v_end - v_start > interval '92 days' then raise exception 'INVALID_DURATION'; end if;
  if v_close > v_end or v_close < now() then raise exception 'INVALID_REG_CLOSE'; end if;
  if v_aud not in ('PUBLIC', 'CLUB_ONLY') or (v_aud = 'CLUB_ONLY' and v_club is null) then raise exception 'INVALID_AUDIENCE'; end if;
  if v_max is not null and (v_max < 2 or v_max > 100000) then raise exception 'INVALID_MAX'; end if;
  if v_prefix !~ '^[A-Z0-9]{1,6}$' then raise exception 'INVALID_BIB_PREFIX'; end if;
  v_dist := (select array_agg(d order by d) from (
               select distinct round((e)::numeric, 2) as d from jsonb_array_elements_text(coalesce(p->'distances', '[]'::jsonb)) as t(e)) s);
  if v_dist is null or array_length(v_dist, 1) > 6 or v_dist[1] < 1 or v_dist[array_length(v_dist, 1)] > 250 then
    raise exception 'INVALID_DISTANCES';
  end if;

  -- Phí theo quy mô (admin miễn phí). Lượt tạo (vé) dùng trước, rồi mới trừ Xu.
  if not v_admin then
    v_payer := coalesce(v_club, v_uid);
    perform private.issue_credits(case when v_club is null then 'USER' else 'CLUB' end, v_payer);
    v_fee := private.challenge_creation_fee(false, v_max, v_start, v_end);
    if v_fee > 0 then
      v_pass := (select t.id from (select x.id, row_number() over (order by x.expires_at nulls last, x.max_slots, x.created_at) as rn
                                     from public.challenge_passes x
                                    where x.owner_id = v_payer and x.remaining > 0 and x.max_slots >= v_max
                                      and (x.expires_at is null or x.expires_at > now())) t where t.rn = 1);
      if v_pass is not null then
        update public.challenge_passes set remaining = remaining - 1, updated_at = now() where id = v_pass;
        v_fee := 0;
      elsif private.balance(v_payer) < v_fee then
        raise exception '%', case when v_club is null then 'INSUFFICIENT_BALANCE' else 'INSUFFICIENT_TREASURY' end;
      else
        perform private.ledger_post('RACE_FEE', 'race_fee:' || v_id, 'Phí tạo giải chạy: ' || v_title, v_uid,
          private.debit_entries(v_payer, v_fee, private.system_account()), v_id);
        if v_club is not null then
          insert into public.club_treasury_log (club_id, user_id, amount, kind, note)
          values (v_club, v_uid, -v_fee, 'SPEND', left('Phí tạo giải: ' || v_title, 200));
        end if;
      end if;
    end if;
  end if;

  insert into public.virtual_races (id, organizer_id, club_id, title, description, start_at, end_at, reg_close_at, distances,
                                    audience, max_participants, bib_prefix, fee_charged, pass_id)
  values (v_id, v_uid, v_club, v_title, nullif(left(trim(coalesce(p->>'description', '')), 3000), ''), v_start, v_end, v_close,
          v_dist, v_aud, v_max, v_prefix, v_fee, v_pass);
  return v_id;
end $$;

-- Thẻ gói mặc định (bản 009200, chỉ đổi chữ)
create or replace function private.plan_content_defaults() returns jsonb
language sql immutable as $$
  select jsonb_build_object(
    'free', jsonb_build_object('title', 'Miễn phí', 'subtitle', '',
      'perks', jsonb_build_array(
        'Ghi bài bằng GPS trong app hoặc tự động từ Strava',
        'Xu, XP, cấp độ, huy hiệu, nhiệm vụ, nhân vật',
        'Tham gia thử thách, CLB, giải chạy, tổ chức không giới hạn',
        'Tạo miễn phí thử thách cá nhân và thử thách nhóm tới {freeSlots} người',
        'Thử thách đông hơn {freeSlots} người: trả Xu theo quy mô'),
      'note', 'VIP không tăng km, XP hay thứ hạng — mọi runner thi đấu công bằng.'),
    'clubFree', jsonb_build_object('title', 'CLB Miễn phí', 'subtitle', '',
      'perks', jsonb_build_array(
        'Tối đa {clubMaxMembers} thành viên',
        '{clubMaxOpen} thử thách nội bộ miễn phí cùng lúc, mỗi thử thách ≤ {clubMaxSlots} người (cần ≥ {clubMinActive} thành viên có bài chạy trong {activeDays} ngày)',
        'Tối đa {clubCaptains} quản trị viên',
        'Bảng tin, chat, lịch, điểm danh QR, quỹ VietQR, bảng xếp hạng',
        'Ngày hội ×2/×3, đại sảnh danh vọng, cửa hàng CLB, giao lưu CLB'),
      'note', 'CLB miễn phí vượt số thành viên vẫn giữ đủ người, chỉ chưa duyệt thêm người mới cho tới khi nâng Pro.'),
    'org', jsonb_build_object('title', 'RaceHub Doanh nghiệp', 'subtitle', 'Báo giá riêng theo số người và thời hạn',
      'perks', jsonb_build_array(
        'Chiến dịch sức khoẻ cho cả tổ chức (km, số buổi, số ngày chạy)',
        'Bảng xếp hạng phòng ban / chi nhánh / CLB — tổng và bình quân đầu người',
        'Nhập danh sách nhân viên từ Excel, tự duyệt email công ty, đơn vị nhiều cấp',
        'Báo cáo theo mã nhân viên, xuất Excel',
        'Chốt kết quả, chứng nhận hoàn thành, quay thưởng minh bạch',
        'Quản lý nhiều CLB, tài trợ CLB Pro cho cả hệ thống'),
      'note', ''))
$$;

notify pgrst, 'reload schema';

-- ===================================================================
-- 20261001010300_account_risks.sql
-- ===================================================================
-- 010300: TÀI KHOẢN BẤT THƯỜNG (Quản trị → Người dùng → Tài khoản bất thường)
-- Gom các dấu hiệu dùng chung tài khoản / nuôi nhiều tài khoản / ăn gian Xu thành một danh sách cho admin xem và khóa:
--   • TWO_PLACES     hai bài chạy cùng lúc ở hai nơi cách nhau > 2 km (một tài khoản, hai người chạy)
--   • SHARED_DEVICE  một thiết bị đăng nhập nhiều tài khoản (theo đăng ký thông báo đẩy; chỉ lưu mã băm, không lưu địa chỉ)
--   • OVERLAP        nhiều bài bị loại vì trùng giờ với bài khác (009900)
--   • REFERRAL_FARM  mời ≥ 3 người đã nhận thưởng giới thiệu nhưng mỗi người chỉ chạy ≤ 1 bài (nghi tự tạo tài khoản ảo)
--   • SUSPICIOUS     nhiều bài nghi vấn nặng (điểm rủi ro ≥ 50) bị giữ hoặc bị từ chối
-- Chỉ là gợi ý để admin xem xét — không tự khóa ai. Điểm 0–100, chỉ liệt kê từ 20 điểm.
-- Chạy được trong SQL Editor: không DO $$, không SELECT INTO, không LIMIT, không RETURNING INTO. Chạy lại an toàn.

create table if not exists private.device_links (
  device text not null,                          -- md5(endpoint thông báo đẩy): nhận ra cùng máy, không lộ địa chỉ
  user_id uuid not null references public.profiles(id) on delete cascade,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  primary key (device, user_id)
);
create index if not exists device_links_user_idx on private.device_links (user_id);
revoke all on private.device_links from public, anon, authenticated;

create or replace function private.track_device_link() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into private.device_links (device, user_id) values (md5(new.endpoint), new.user_id)
  on conflict (device, user_id) do update set last_seen = now();
  return new;
end $$;

drop trigger if exists trg_push_device_link on public.push_subscriptions;
create trigger trg_push_device_link after insert or update of user_id, last_seen_at on public.push_subscriptions
  for each row execute function private.track_device_link();

-- Thiết bị đang đăng ký hiện có
insert into private.device_links (device, user_id, first_seen, last_seen)
select md5(s.endpoint), s.user_id, s.created_at, s.last_seen_at from public.push_subscriptions s
on conflict (device, user_id) do nothing;

create or replace function public.admin_account_risks(p_days integer default 30) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_admin uuid := private.require_admin();
  v_since timestamptz := now() - make_interval(days => greatest(1, least(coalesce(p_days, 30), 365)));
begin
  return (
    with dup as (
      select a.user_id, count(*) as n from public.activities a
       where a.created_at >= v_since and a.validation_reason = 'Trùng giờ với bài chạy khác.' group by 1
    ), two as (
      select a.user_id, count(*) as n
        from public.activities a
        join public.activities b on b.user_id = a.user_id and b.id > a.id
             and b.started_at < coalesce(a.ended_at, a.started_at) and coalesce(b.ended_at, b.started_at) > a.started_at
        join public.activity_details da on da.activity_id = a.id
        join public.activity_details db on db.activity_id = b.id
       where a.started_at >= v_since and coalesce(a.status, '') <> 'DELETED' and coalesce(b.status, '') <> 'DELETED'
         and da.start_lat is not null and db.start_lat is not null
         and private.haversine_m(da.start_lat, da.start_lng, db.start_lat, db.start_lng) > 2000
       group by 1
    ), sus as (
      select a.user_id, count(*) as n from public.activities a
       where a.created_at >= v_since and a.validation_status in ('PENDING', 'REJECTED') and coalesce(a.risk_score, 0) >= 50
       group by 1
    ), dev as (
      select l.user_id, count(distinct o.user_id) as n
        from private.device_links l join private.device_links o on o.device = l.device and o.user_id <> l.user_id
       where l.last_seen >= v_since and o.last_seen >= v_since
       group by 1
    ), ref as (
      select p.referred_by as user_id, count(*) as n
        from public.profiles p
       where p.referred_by is not null and p.created_at >= v_since
         and exists (select 1 from public.ledger_transactions t where t.idempotency_key = 'referral_inviter:' || p.id)
         and (select count(*) from public.activities x
               where x.user_id = p.id and x.validation_status = 'APPROVED' and coalesce(x.status, '') <> 'DELETED') <= 1
       group by 1 having count(*) >= 3
    ), ids as (
      select user_id from dup union select user_id from two union select user_id from sus
      union select user_id from dev union select user_id from ref
    ), scored as (
      select i.user_id, coalesce(two.n, 0) as two, coalesce(dev.n, 0) as dev, coalesce(dup.n, 0) as dup,
             coalesce(ref.n, 0) as ref, coalesce(sus.n, 0) as sus,
             least(coalesce(two.n, 0) * 40, 80) + least(coalesce(dev.n, 0) * 25, 50) + least(coalesce(dup.n, 0) * 10, 40)
             + least(coalesce(ref.n, 0) * 10, 50) + least(coalesce(sus.n, 0) * 5, 30) as score
        from ids i
        left join two on two.user_id = i.user_id left join dev on dev.user_id = i.user_id left join dup on dup.user_id = i.user_id
        left join ref on ref.user_id = i.user_id left join sus on sus.user_id = i.user_id
    ), ranked as (
      select s.*, row_number() over (order by s.score desc, s.user_id) as rn from scored s where s.score >= 20
    )
    select coalesce(jsonb_agg(jsonb_build_object(
        'user_id', r.user_id, 'name', pr.display_name, 'avatar_url', pr.avatar_url, 'email', au.email,
        'banned', pr.banned_at is not null, 'score', least(r.score, 100),
        'flags', (select coalesce(jsonb_agg(jsonb_build_object('code', v.code, 'count', v.n) order by v.ord), '[]'::jsonb)
                    from (values (1, 'TWO_PLACES', r.two), (2, 'SHARED_DEVICE', r.dev), (3, 'OVERLAP', r.dup),
                                 (4, 'REFERRAL_FARM', r.ref), (5, 'SUSPICIOUS', r.sus)) v(ord, code, n)
                   where v.n > 0))
        order by r.score desc, r.user_id), '[]'::jsonb)
      from ranked r
      join public.profiles pr on pr.id = r.user_id
      left join auth.users au on au.id = r.user_id
     where r.rn <= 200
  );
end $$;

revoke all on function private.track_device_link() from public, anon, authenticated;
revoke all on function public.admin_account_risks(integer) from public, anon;
grant execute on function public.admin_account_risks(integer) to authenticated;

notify pgrst, 'reload schema';

commit;
