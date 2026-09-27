-- RaceHub — PHẦN 14/15 (tạo tự động bằng scripts/db-bundle.mjs — KHÔNG sửa tay).
-- Gồm: 009100, 009200
-- Supabase → SQL Editor → New query → dán TOÀN BỘ phần này → Run. Lỗi thì không có gì thay đổi; chạy lại vẫn an toàn.
-- Xong thì chạy phần tiếp theo.
begin;
-- ===================================================================
-- 20261001009100_ops_policy.sql
-- ===================================================================
-- 009100: CHÍNH SÁCH VẬN HÀNH — admin tự đặt lại quy tắc khi hệ thống đã chạy, không phải sửa code / chờ dựng lại app.
-- Cùng cơ chế với chính sách kinh tế (system_config_versions): mỗi lần lưu là một PHIÊN BẢN mới, có kiểm tra giới hạn hợp lệ,
-- ghi nhật ký quản trị (ai đổi, lúc nào, trước / sau), xem lịch sử và KHÔI PHỤC phiên bản cũ bằng một nút.
-- Khoá cấu hình 'ops_policy' gồm:
--   • features  — bật / tắt tính năng cho người dùng: Quanh đây, Chợ Runner, Chợ BIB, Kiến thức, Giải chạy ảo, Thách đấu CLB, Tổ chức;
--   • tracking  — ghi bài chạy: tự tạm dừng sau bao nhiêu giây đứng yên, hỏi Kết thúc sau bao nhiêu phút, tự tạm dừng hẳn, cắt đuôi đứng yên;
--   • antiCheat — ngưỡng chống gian lận (chỉ áp khi đang thi đấu — 008500): tốc độ đi xe, giữ tốc độ cao, nhảy điểm, pace nhanh nhất,
--                 số bài tối đa / ngày. KHÔNG trả về cho người dùng thường (tránh "căn" sát ngưỡng) — chỉ admin + máy chủ;
--   • content   — nội dung trang Doanh nghiệp (tiêu đề, mô tả, các thẻ tính năng).
-- submit_and_process_activity đọc ngưỡng antiCheat thay cho số viết cứng (giá trị mặc định = như cũ, không đổi hành vi).
-- Kèm: admin_config_history / admin_rollback_config cho cả chính sách kinh tế lẫn vận hành.
-- Chạy được trong SQL Editor: không DO $$, không SELECT INTO, không LIMIT, không RETURNING INTO. Chạy lại an toàn.

create or replace function private.ops_defaults() returns jsonb
language sql immutable set search_path = public as $$
  select jsonb_build_object(
    'features', jsonb_build_object('nearby', true, 'market', true, 'bibMarket', true, 'knowledge', true, 'races', true, 'cups', true, 'orgs', true),
    'tracking', jsonb_build_object('autoPauseAfterS', 10, 'longStopAskMin', 10, 'longStopAutoStopMin', 30, 'trimTailMin', 2),
    'antiCheat', jsonb_build_object('dailyRunLimit', 20, 'minPaceMin', 3, 'vehicleKmh', 25, 'vehicleS', 30, 'severeKmh', 20, 'severeS', 120,
                                    'highKmh', 17, 'highS', 180, 'spikeKmh', 43, 'spikeMax', 3),
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
        jsonb_build_object('title', 'Chống gian lận, tôn trọng riêng tư', 'text', 'Chỉ tính bài chạy hợp lệ (GPS, pace, duyệt); người chạy tắt chia sẻ bài nào thì bài đó không vào bảng.')))))
$$;

/** Bản đã xuất bản mới nhất (thiếu khoá nào thì lấy mặc định) */
create or replace function private.ops_config() returns jsonb
language sql stable security definer set search_path = public as $$
  select x.d || jsonb_build_object(
      'features', (x.d->'features') || coalesce(x.c->'features', '{}'::jsonb),
      'tracking', (x.d->'tracking') || coalesce(x.c->'tracking', '{}'::jsonb),
      'antiCheat', (x.d->'antiCheat') || coalesce(x.c->'antiCheat', '{}'::jsonb),
      'content', (x.d->'content') || coalesce(x.c->'content', '{}'::jsonb),
      'version', coalesce(x.v, 0))
  from (select private.ops_defaults() as d,
               (select v.config_value from (select s.config_value, row_number() over (order by s.version desc) as rn
                                              from public.system_config_versions s
                                             where s.config_key = 'ops_policy' and s.status = 'PUBLISHED') v where v.rn = 1) as c,
               (select max(s.version) from public.system_config_versions s where s.config_key = 'ops_policy' and s.status = 'PUBLISHED') as v) x
$$;

create or replace function private.ops_num_ok(c jsonb, sec text, k text, lo numeric, hi numeric) returns boolean
language sql immutable as $$
  select jsonb_typeof(c->sec->k) = 'number' and (c->sec->>k)::numeric between lo and hi
$$;

/** Kiểm tra giới hạn hợp lệ — chặn giá trị làm hỏng hệ thống (vd. tự tạm dừng sau 0 giây, ngưỡng đi xe thấp hơn chạy bộ) */
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
$$;

/** Đọc chính sách vận hành: mọi người (kể cả chưa đăng nhập) nhận features / tracking / content; antiCheat chỉ admin + máy chủ */
create or replace function public.ops_policy() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  c jsonb := private.ops_config();
  v_role text := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'role', '');
begin
  if v_role = 'service_role' or public.is_system_admin() then return c; end if;
  return c - 'antiCheat';
end $$;

create or replace function public.admin_publish_ops_policy(p jsonb, p_note text default null) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_admin uuid := private.require_admin();
  d jsonb := private.ops_defaults();
  v_old jsonb := private.ops_config();
  v_new jsonb;
  v_next integer;
begin
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'INVALID_CONFIG'; end if;
  -- Chỉ nhận các nhóm / khoá đã biết (khoá lạ bị bỏ): gộp lên bản mặc định
  v_new := jsonb_build_object(
    'features', (select coalesce(jsonb_object_agg(k.key, coalesce(p->'features'->k.key, v_old->'features'->k.key)), '{}'::jsonb) from jsonb_each(d->'features') k),
    'tracking', (select coalesce(jsonb_object_agg(k.key, coalesce(p->'tracking'->k.key, v_old->'tracking'->k.key)), '{}'::jsonb) from jsonb_each(d->'tracking') k),
    'antiCheat', (select coalesce(jsonb_object_agg(k.key, coalesce(p->'antiCheat'->k.key, v_old->'antiCheat'->k.key)), '{}'::jsonb) from jsonb_each(d->'antiCheat') k),
    'content', jsonb_build_object('enterprise', coalesce(p->'content'->'enterprise', v_old->'content'->'enterprise')));
  if not private.valid_ops(v_new) then raise exception 'INVALID_CONFIG'; end if;
  perform pg_advisory_xact_lock(hashtext('config:ops_policy'));
  v_next := coalesce((select max(x.version) from public.system_config_versions x where x.config_key = 'ops_policy'), 0) + 1;
  update public.system_config_versions set status = 'ARCHIVED' where config_key = 'ops_policy' and status = 'PUBLISHED';
  insert into public.system_config_versions (config_key, version, status, config_value, created_by)
  values ('ops_policy', v_next, 'PUBLISHED', v_new, v_admin);
  insert into public.admin_audit_log (actor_id, action, target, old_value, new_value)
  values (v_admin, 'PUBLISH_CONFIG', 'ops_policy v' || v_next || coalesce(': ' || left(nullif(trim(p_note), ''), 160), ''), v_old - 'version', v_new);
  return v_next;
end $$;

/** Lịch sử phiên bản của một chính sách (kinh tế / vận hành): 30 bản gần nhất */
create or replace function public.admin_config_history(p_key text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_admin uuid := private.require_admin();
begin
  if p_key not in ('economy_global_config', 'ops_policy') then raise exception 'UNSUPPORTED_CONFIG_KEY'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('version', h.version, 'status', h.status, 'created_at', h.created_at,
                                        'by', case when h.created_by is null then 'Hệ thống' else private.display_name(h.created_by) end,
                                        'value', h.config_value) order by h.version desc)
      from (select s.*, row_number() over (order by s.version desc) as rn from public.system_config_versions s where s.config_key = p_key) h
     where h.rn <= 30), '[]'::jsonb);
end $$;

/** Khôi phục một phiên bản cũ = xuất bản lại nội dung đó thành phiên bản mới (qua đúng bước kiểm tra + ghi nhật ký) */
create or replace function public.admin_rollback_config(p_key text, p_version integer) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_admin uuid := private.require_admin();
  v_val jsonb := (select s.config_value from public.system_config_versions s where s.config_key = p_key and s.version = p_version);
begin
  if v_val is null then raise exception 'VERSION_NOT_FOUND'; end if;
  if p_key = 'ops_policy' then return public.admin_publish_ops_policy(v_val, 'Khôi phục bản v' || p_version); end if;
  if p_key = 'economy_global_config' then return public.admin_publish_config(p_key, v_val); end if;
  raise exception 'UNSUPPORTED_CONFIG_KEY';
end $$;

-- submit_and_process_activity: như 008500, ngưỡng chống gian lận lấy từ private.ops_config()->'antiCheat'
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

  -- Chống gửi trùng / chồng thời gian với bài chạy khác
  if exists (select 1 from public.activities
              where user_id = v_uid and started_at < p_ended_at and ended_at > p_started_at) then
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

revoke all on function private.ops_defaults(), private.ops_config(), private.ops_num_ok(jsonb, text, text, numeric, numeric), private.valid_ops(jsonb)
  from public, anon, authenticated;
revoke all on function public.ops_policy(), public.admin_publish_ops_policy(jsonb, text), public.admin_config_history(text),
  public.admin_rollback_config(text, integer) from public, anon;
grant execute on function public.ops_policy() to anon, authenticated;
grant execute on function public.admin_publish_ops_policy(jsonb, text), public.admin_config_history(text), public.admin_rollback_config(text, integer)
  to authenticated;

notify pgrst, 'reload schema';

-- ===================================================================
-- 20261001009200_plan_content.sql
-- ===================================================================
-- 009200: NỘI DUNG GÓI MIỄN PHÍ do admin soạn + số quản trị viên CLB miễn phí do admin đặt.
-- Trước đây trang /goi đọc giá, quyền lợi, lượt tạo của VIP / CLB Pro từ Quản trị → Gói & giá, nhưng thẻ "Miễn phí",
-- "CLB Miễn phí" và "RaceHub Doanh nghiệp" viết cứng trong code, số quản trị viên CLB miễn phí (2) viết cứng trong SQL.
--   • ops_policy.content.plans = { free, clubFree, org }: mỗi thẻ có tiêu đề, mô tả, các dòng quyền lợi, ghi chú.
--     Dòng quyền lợi dùng được biến {freeSlots}, {clubMaxMembers}, {clubMaxOpen}, {clubMaxSlots}, {clubMinActive}, {activeDays},
--     {clubCaptains}, {proMaxOpen}, {proMaxSlots} — app thay bằng số đang áp dụng, nên đổi hạn mức ở Kinh tế là thẻ tự đổi theo.
--     Lưu = một phiên bản của chính sách vận hành (lịch sử, khôi phục, nhật ký quản trị như 009100).
--   • economy clubChallenge.freeMaxCaptains (mặc định 2): trigger giới hạn quản trị viên, club_plan() và plan_compare() đọc số này.
--   • plan_compare() trả thêm 'content' (nội dung các thẻ gói) để trang /goi đọc một lần.
-- Cần 008500, 009100. Chạy được trong SQL Editor: không DO $$, không SELECT INTO, không LIMIT, không RETURNING INTO. Chạy lại an toàn.

-- ---------------------------------------------------------------------
-- 1. Số quản trị viên CLB miễn phí: vào chính sách kinh tế
-- ---------------------------------------------------------------------
create or replace function private.club_challenge_policy() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('freeMinActiveMembers', 5, 'activeWindowDays', 30, 'freeMaxSlots', 50, 'freeMaxOpen', 2,
                            'proMaxSlots', 1000, 'proMaxOpen', 20, 'freeMaxMembers', 50, 'freeMaxCaptains', 2)
         || coalesce(case when jsonb_typeof(private.economy_config()->'clubChallenge') = 'object'
                          then private.economy_config()->'clubChallenge' end, '{}'::jsonb)
$$;

create or replace function private.club_free_captains() returns integer
language sql stable security definer set search_path = public as $$
  select coalesce((private.club_challenge_policy()->>'freeMaxCaptains')::int, 2)
$$;

create or replace function private.valid_economy_v2(c jsonb) returns boolean
language sql immutable as $$
  select jsonb_typeof(c) = 'object'
     and coalesce((c->>'xuVnd')::numeric, 100) between 1 and 1000000
     and coalesce((c->>'xpPerKm')::numeric, 10) between 0 and 1000
     and coalesce((c->'run'->>'freeKm')::numeric, 2) between 0 and 100
     and coalesce((c->'run'->>'dailyCap')::numeric, 20) between 0 and 100000
     and not exists (select 1 from jsonb_array_elements(coalesce(c->'run'->'tiers', '[]'::jsonb)) e
                      where (e->>'upToKm')::numeric not between 0 and 1000 or (e->>'rate')::numeric not between 0 and 1000)
     and coalesce((c->>'checkinXu')::numeric, 1) between 0 and 10000
     and coalesce((c->>'giftDailyCapXu')::numeric, 20000) between 0 and 100000000
     and not exists (select 1 from jsonb_array_elements(coalesce(c->'capacityTiers', '[]'::jsonb)) e
                      where (e->>'max')::int not between 1 and 1000000 or (e->>'xu')::numeric not between 0 and 10000000)
     and not exists (select 1 from jsonb_array_elements(coalesce(c->'streakRewards', '[]'::jsonb)) e
                      where (e->>'weeks')::int not between 1 and 520 or (e->>'xu')::numeric not between 0 and 100000)
     and coalesce((c->'referral'->>'inviterXu')::numeric, 0) between 0 and 100000
     and coalesce((c->'referral'->>'refereeXu')::numeric, 0) between 0 and 100000
     and coalesce((c->'referral'->>'monthlyCap')::numeric, 10) between 0 and 1000
     and coalesce((c->'comeback'->>'xu')::numeric, 10) between 0 and 10000
     and coalesce((c->'comeback'->>'minRestDays')::numeric, 28) between 7 and 365
     and coalesce((c->'comeback'->>'cooldownDays')::numeric, 90) between 0 and 3650
     and coalesce((c->'game'->>'shieldPrice')::numeric, 200) between 0 and 100000
     and coalesce((c->'clubChallenge'->>'freeMinActiveMembers')::numeric, 5) between 0 and 10000
     and coalesce((c->'clubChallenge'->>'activeWindowDays')::numeric, 30) between 1 and 365
     and coalesce((c->'clubChallenge'->>'freeMaxSlots')::numeric, 50) between 0 and 10000
     and coalesce((c->'clubChallenge'->>'freeMaxOpen')::numeric, 2) between 0 and 10000
     and coalesce((c->'clubChallenge'->>'proMaxSlots')::numeric, 1000) between 0 and 10000
     and coalesce((c->'clubChallenge'->>'proMaxOpen')::numeric, 20) between 0 and 10000
     and coalesce((c->'clubChallenge'->>'freeMaxMembers')::numeric, 50) between 0 and 1000000
     and coalesce((c->'clubChallenge'->>'freeMaxCaptains')::numeric, 2) between 0 and 100
$$;

-- Như 002800, số 2 thay bằng số admin đặt. Chỉ chặn khi THÊM mới, không hạ cấp người đang giữ.
create or replace function private.club_captain_limit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.role = 'CAPTAIN' and new.status = 'APPROVED'
     and (tg_op = 'INSERT' or (old.role is distinct from 'CAPTAIN' and old.role is distinct from 'OWNER') or old.status is distinct from 'APPROVED')   -- chủ nhiệm cũ khi trao quyền: không tính
     and not private.club_is_pro(new.club_id)
     and (select count(*) from public.club_members m
           where m.club_id = new.club_id and m.role = 'CAPTAIN' and m.status = 'APPROVED' and m.user_id <> new.user_id) >= private.club_free_captains() then
    raise exception 'CAPTAIN_LIMIT';
  end if;
  return new;
end $$;

create or replace function public.club_plan(p_club_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare c public.clubs := (select x from public.clubs x where x.id = p_club_id);
begin
  if c.id is null or not public.club_is_member(c.id) then raise exception 'NOT_A_MEMBER'; end if;
  return jsonb_build_object(
    'plan', c.plan, 'active', private.club_is_pro(c.id), 'pro_until', c.pro_until,
    'slug', case when public.club_is_staff(c.id) or private.club_is_pro(c.id) then c.slug end,
    'captains', (select count(*) from public.club_members m where m.club_id = c.id and m.role = 'CAPTAIN' and m.status = 'APPROVED'),
    'captain_limit', case when private.club_is_pro(c.id) then null else private.club_free_captains() end);
end $$;

-- ---------------------------------------------------------------------
-- 2. Nội dung các thẻ gói trong chính sách vận hành
-- ---------------------------------------------------------------------
create or replace function private.plan_content_defaults() returns jsonb
language sql immutable as $$
  select jsonb_build_object(
    'free', jsonb_build_object('title', 'Miễn phí', 'subtitle', '',
      'perks', jsonb_build_array(
        'Ghi bài bằng GPS trong app hoặc tự động từ Strava',
        'Xu, XP, cấp độ, huy hiệu, nhiệm vụ, nhân vật',
        'Tham gia thử thách, CLB, giải chạy ảo, tổ chức không giới hạn',
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

/** Một thẻ gói hợp lệ: tiêu đề 2–60, mô tả ≤ 200, ghi chú ≤ 300, 1–15 dòng quyền lợi mỗi dòng 2–200 ký tự */
create or replace function private.valid_plan_card(c jsonb) returns boolean
language sql immutable as $$
  select case when jsonb_typeof(c) = 'object' and jsonb_typeof(c->'title') = 'string' and jsonb_typeof(c->'perks') = 'array'
              then char_length(c->>'title') between 2 and 60
               and char_length(coalesce(c->>'subtitle', '')) <= 200
               and char_length(coalesce(c->>'note', '')) <= 300
               and jsonb_array_length(c->'perks') between 1 and 15
               and not exists (select 1 from jsonb_array_elements(c->'perks') e
                                where jsonb_typeof(e) <> 'string' or char_length(e #>> '{}') not between 2 and 200)
              else false end
$$;

create or replace function private.valid_plan_content(p jsonb) returns boolean
language sql immutable as $$
  select case when jsonb_typeof(p) = 'object'
              then private.valid_plan_card(p->'free') and private.valid_plan_card(p->'clubFree') and private.valid_plan_card(p->'org')
              else false end
$$;

/** Chỉ giữ các khoá đã biết của một thẻ */
create or replace function private.clean_plan_card(c jsonb) returns jsonb
language sql immutable as $$
  select jsonb_build_object('title', c->'title', 'subtitle', coalesce(c->'subtitle', '""'::jsonb),
                            'perks', c->'perks', 'note', coalesce(c->'note', '""'::jsonb))
$$;

create or replace function private.ops_defaults() returns jsonb
language sql immutable set search_path = public as $$
  select jsonb_build_object(
    'features', jsonb_build_object('nearby', true, 'market', true, 'bibMarket', true, 'knowledge', true, 'races', true, 'cups', true, 'orgs', true),
    'tracking', jsonb_build_object('autoPauseAfterS', 10, 'longStopAskMin', 10, 'longStopAutoStopMin', 30, 'trimTailMin', 2),
    'antiCheat', jsonb_build_object('dailyRunLimit', 20, 'minPaceMin', 3, 'vehicleKmh', 25, 'vehicleS', 30, 'severeKmh', 20, 'severeS', 120,
                                    'highKmh', 17, 'highS', 180, 'spikeKmh', 43, 'spikeMax', 3),
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

-- Như 009100, thêm content.plans: gửi một phần (vd. chỉ thẻ "Miễn phí") thì các thẻ còn lại giữ nguyên bản đang dùng
create or replace function public.admin_publish_ops_policy(p jsonb, p_note text default null) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_admin uuid := private.require_admin();
  d jsonb := private.ops_defaults();
  v_old jsonb := private.ops_config();
  v_plans jsonb;
  v_new jsonb;
  v_next integer;
begin
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'INVALID_CONFIG'; end if;
  v_plans := coalesce(v_old->'content'->'plans', '{}'::jsonb)
             || case when jsonb_typeof(p->'content'->'plans') = 'object' then p->'content'->'plans' else '{}'::jsonb end;
  -- Chỉ nhận các nhóm / khoá đã biết (khoá lạ bị bỏ): gộp lên bản mặc định
  v_new := jsonb_build_object(
    'features', (select coalesce(jsonb_object_agg(k.key, coalesce(p->'features'->k.key, v_old->'features'->k.key)), '{}'::jsonb) from jsonb_each(d->'features') k),
    'tracking', (select coalesce(jsonb_object_agg(k.key, coalesce(p->'tracking'->k.key, v_old->'tracking'->k.key)), '{}'::jsonb) from jsonb_each(d->'tracking') k),
    'antiCheat', (select coalesce(jsonb_object_agg(k.key, coalesce(p->'antiCheat'->k.key, v_old->'antiCheat'->k.key)), '{}'::jsonb) from jsonb_each(d->'antiCheat') k),
    'content', jsonb_build_object(
      'enterprise', coalesce(p->'content'->'enterprise', v_old->'content'->'enterprise'),
      'plans', jsonb_build_object('free', private.clean_plan_card(v_plans->'free'), 'clubFree', private.clean_plan_card(v_plans->'clubFree'),
                                  'org', private.clean_plan_card(v_plans->'org'))));
  if not private.valid_ops(v_new) then raise exception 'INVALID_CONFIG'; end if;
  perform pg_advisory_xact_lock(hashtext('config:ops_policy'));
  v_next := coalesce((select max(x.version) from public.system_config_versions x where x.config_key = 'ops_policy'), 0) + 1;
  update public.system_config_versions set status = 'ARCHIVED' where config_key = 'ops_policy' and status = 'PUBLISHED';
  insert into public.system_config_versions (config_key, version, status, config_value, created_by)
  values ('ops_policy', v_next, 'PUBLISHED', v_new, v_admin);
  insert into public.admin_audit_log (actor_id, action, target, old_value, new_value)
  values (v_admin, 'PUBLISH_CONFIG', 'ops_policy v' || v_next || coalesce(': ' || left(nullif(trim(p_note), ''), 160), ''), v_old - 'version', v_new);
  return v_next;
end $$;

-- ---------------------------------------------------------------------
-- 3. Bảng so sánh gói: số quản trị viên theo chính sách + nội dung thẻ gói
-- ---------------------------------------------------------------------
create or replace function public.plan_compare() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'plans', (select coalesce(jsonb_agg(jsonb_build_object(
                'code', p.code, 'name', p.name, 'owner_type', p.owner_type, 'tier', p.tier, 'description', p.description, 'perks', p.perks,
                'prices', (select coalesce(jsonb_agg(jsonb_build_object('months', pp.months, 'price_vnd', pp.price_vnd) order by pp.months), '[]'::jsonb)
                             from public.plan_prices pp where pp.plan_code = p.code and pp.active),
                'credits', (select coalesce(jsonb_agg(jsonb_build_object('capacity', pc.capacity, 'per_month', pc.per_month) order by pc.capacity), '[]'::jsonb)
                              from public.plan_credits pc where pc.plan_code = p.code))
              order by p.sort), '[]'::jsonb) from public.plans p where p.active),
    'club', private.club_challenge_policy(),
    'free_captains', private.club_free_captains(),
    'content', private.ops_config()->'content'->'plans')
$$;

revoke all on function private.club_free_captains(), private.plan_content_defaults(), private.valid_plan_card(jsonb),
  private.valid_plan_content(jsonb), private.clean_plan_card(jsonb) from public, anon, authenticated;
revoke all on function private.ops_defaults(), private.valid_ops(jsonb), private.valid_economy_v2(jsonb), private.club_challenge_policy(),
  private.club_captain_limit() from public, anon, authenticated;
revoke all on function public.admin_publish_ops_policy(jsonb, text), public.club_plan(uuid), public.plan_compare() from public, anon;
grant execute on function public.admin_publish_ops_policy(jsonb, text), public.club_plan(uuid) to authenticated;
grant execute on function public.plan_compare() to anon, authenticated;

commit;
