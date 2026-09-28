-- RaceHub — PHẦN 13/16 (tạo tự động bằng scripts/db-bundle.mjs — KHÔNG sửa tay).
-- Gồm: 008500, 008600, 008700, 008800, 008900, 009000
-- Supabase → SQL Editor → New query → dán TOÀN BỘ phần này → Run. Lỗi thì không có gì thay đổi; chạy lại vẫn an toàn.
-- Xong thì chạy phần tiếp theo.
begin;
-- ===================================================================
-- 20261001008500_competition_review_plans_menu.sql
-- ===================================================================
-- 008500: Chống gian lận chỉ trong thi đấu + CLB Free tối đa 50 thành viên + bảng so sánh gói + admin sửa mọi trang menu.
-- • Chống gian lận CHỈ áp cho người đang thi đấu: bài có dấu hiệu bất thường chỉ CHỜ DUYỆT khi lúc chạy người đó đang tham gia
--   thử thách, giải chạy ảo hoặc chiến dịch doanh nghiệp. Ngoài thi đấu, bài GPS / Strava được TỰ DUYỆT (vẫn tính Xu, XP, BXH CLB),
--   mức nghi vấn vẫn được lưu và bài đánh dấu review_skipped → KHÔNG tính vào thử thách / giải / chiến dịch nếu sau đó mới tham gia.
--   Bài nhập tay (không có thiết bị ghi) vẫn chờ duyệt như cũ.
--   Các bài đang chờ duyệt của người không thi đấu được tự duyệt ngay khi chạy file này.
-- • CLB miễn phí nhận tối đa 50 thành viên (khoá clubChallenge.freeMaxMembers, 0 = không giới hạn; admin sửa ở Quản trị → Chính sách).
--   Chỉ chặn khi NHẬN THÊM, không đuổi ai; CLB Pro (kể cả được doanh nghiệp tài trợ) không giới hạn; admin hệ thống vẫn thêm được.
-- • public.plan_compare(): bảng so sánh Miễn phí / VIP / CLB Pro cho trang /goi — xem được khi chưa đăng nhập.
-- • Điều khoản và Quyền riêng tư chuyển vào help_pages → admin sửa được như mọi trang menu. Thêm trang "RaceHub cho doanh nghiệp".
--   Nội dung mẫu chỉ thêm khi chưa có; trang admin đã sửa (updated_by khác null) không bị ghi đè.
-- Cần 002400, 002700, 002800, 006600, 007000, 007300, 007700, 008200, 008300, 008400.
-- Chạy được trong SQL Editor: không DO $$, không SELECT INTO, không LIMIT, không RETURNING INTO. Chạy lại an toàn.

-- ---------------------------------------------------------------------
-- 1. Chống gian lận chỉ trong thi đấu
-- ---------------------------------------------------------------------
alter table public.activities add column if not exists review_skipped boolean not null default false;

-- Lúc p_at người này có đang thi đấu không: thử thách đã tham gia, giải chạy ảo đã đăng ký, chiến dịch của tổ chức mình thuộc về
create or replace function private.in_competition(p_user uuid, p_at timestamptz) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.challenge_participants p join public.challenges c on c.id = p.challenge_id
                  where p.profile_id = p_user and p.status in ('JOINED', 'COMPLETED') and c.status = 'ACTIVE'
                    and p_at >= c.start_date and p_at < c.end_date)
      or exists (select 1 from public.race_registrations x join public.virtual_races r on r.id = x.race_id
                  where x.user_id = p_user and x.status <> 'WITHDRAWN' and r.status = 'PUBLISHED'
                    and p_at >= r.start_at and p_at < r.end_at)
      or exists (select 1 from public.org_campaigns c
                  where c.status = 'ACTIVE' and p_at >= c.starts_at and p_at < c.ends_at
                    and (exists (select 1 from public.org_members m
                                  where m.org_id = c.org_id and m.user_id = p_user and m.status = 'APPROVED')
                         or exists (select 1 from public.org_clubs oc
                                      join public.club_members cm on cm.club_id = oc.club_id and cm.status = 'APPROVED'
                                     where oc.org_id = c.org_id and oc.status = 'APPROVED' and cm.user_id = p_user)))
$$;

create or replace function private.review_skipped_reason(p_reason text) returns text
language sql immutable as $$
  select left('Tự duyệt: lúc chạy bạn không tham gia thử thách, giải chạy hay chiến dịch nào. Bài vẫn tính Xu, XP và bảng xếp hạng CLB, '
              || 'nhưng không tính vào thử thách / giải / chiến dịch. Dấu hiệu hệ thống ghi nhận: '
              || coalesce(replace(p_reason, ' Bài được tính sau khi ban quản trị CLB hoặc admin xác minh.', ''), 'không rõ'), 500)
$$;

-- Chạy TRƯỚC khi chèn bài (sau trg_aa_activity_shared): bài nghi vấn của người không thi đấu → tự duyệt
create or replace function private.activity_review_scope() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.validation_status = 'PENDING' and not coalesce(new.is_manual, false) and new.user_id is not null
     and new.started_at is not null and not private.in_competition(new.user_id, new.started_at) then
    new.validation_status := 'APPROVED';
    if new.status = 'PROCESSING' then new.status := 'READY'; end if;
    new.review_skipped := true;
    new.validation_reason := private.review_skipped_reason(new.validation_reason);
  end if;
  return new;
end $$;

drop trigger if exists trg_ab_activity_review_scope on public.activities;
create trigger trg_ab_activity_review_scope before insert on public.activities
  for each row execute function private.activity_review_scope();

-- Bài đang chờ duyệt của người không thi đấu → tự duyệt ngay (trigger thưởng Xu / XP chạy như khi duyệt tay).
-- 009700: chỉ bài nghi vấn mức thấp (điểm rủi ro < 35) — chạy lại file này không được duyệt bài giống đi xe / mất GPS gần hết quãng.
update public.activities a
   set validation_status = 'APPROVED',
       status = case when a.status = 'PROCESSING' then 'READY' else a.status end,
       review_skipped = true,
       validation_reason = private.review_skipped_reason(a.validation_reason)
 where a.validation_status = 'PENDING' and not coalesce(a.is_manual, false) and a.user_id is not null
   and coalesce(a.status, '') <> 'DELETED' and a.started_at is not null and coalesce(a.risk_score, 0) < 35
   and not private.in_competition(a.user_id, a.started_at);

-- Bài GPS trong app: trả về trạng thái sau khi trigger xử lý (bản 006600 + đọc lại trạng thái)
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

-- Thử thách / giải chạy ảo / chiến dịch: không tính bài tự duyệt có dấu hiệu bất thường (bản cũ + điều kiện review_skipped)
create or replace function private.challenge_apply_activity(p_activity_id uuid, p_only_participant uuid default null) returns integer
language plpgsql security definer set search_path = public as $$
declare
  a public.activities := (select x from public.activities x where x.id = p_activity_id);
  r record;
  v_day date;
  v_km numeric;
  v_already numeric;
  v_counted numeric;
  v_boost numeric;
  n integer := 0;
begin
  if a.id is null or a.user_id is null or a.validation_status is distinct from 'APPROVED'
     or not public.activity_is_countable(a.status, a.validation_status) or not a.shared or a.review_skipped then
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
      -- trần mỗi ngày tính trên km thật (chia lại hệ số đã nhân)
      v_already := (select coalesce(sum(e.counted_m / e.boost), 0) from public.challenge_progress_events e
                     where e.participant_id = r.pid and e.day = v_day and e.activity_id <> a.id);
      v_counted := least(v_counted, greatest(r.daily_cap_km * 1000 - v_already, 0));
    end if;
    v_boost := case when r.target_club_id is not null and r.objective = 'DISTANCE' then private.club_boost(r.target_club_id, v_day) else 1 end;

    insert into public.challenge_progress_events (challenge_id, participant_id, activity_id, day, distance_m, counted_m, moving_s, boost)
    values (r.id, r.pid, a.id, v_day, v_km * 1000, v_counted * v_boost, coalesce(a.moving_time_s, 0), v_boost)
    on conflict (participant_id, activity_id) do nothing;
    if found then
      perform private.challenge_recompute_participant(r.pid);
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;

create or replace function private.race_evaluate(p_reg_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  g public.race_registrations := (select x from public.race_registrations x where x.id = p_reg_id);
  r public.virtual_races;
  best record;
  v_target numeric;
  v_was text;
begin
  if g.id is null or g.status = 'WITHDRAWN' then return; end if;
  r := (select x from public.virtual_races x where x.id = g.race_id);
  if r.status = 'CANCELLED' then return; end if;
  v_target := g.distance_km * 1000;
  v_was := g.status;
  for best in
    select a.id, a.distance_m, a.moving_time_s, a.started_at
      from public.activities a
     where a.user_id = g.user_id and a.validation_status = 'APPROVED' and coalesce(a.status, '') <> 'DELETED' and a.shared and not a.review_skipped
       and a.started_at >= r.start_at and a.started_at < r.end_at
       and a.distance_m >= v_target * 0.99 and coalesce(a.moving_time_s, 0) > 0
     order by a.moving_time_s / a.distance_m, a.started_at
  loop
    update public.race_registrations
       set status = 'FINISHED', finish_activity_id = best.id, finish_distance_m = best.distance_m,
           finish_moving_s = best.moving_time_s,
           finish_time_s = round(best.moving_time_s * v_target / best.distance_m),
           finished_at = best.started_at
     where id = g.id;
    if v_was <> 'FINISHED' then
      perform private.notify(g.user_id, r.club_id, 'RACE_FINISHED', 'Hoàn thành ' || r.title,
        'Cự ly ' || g.distance_km || ' km · BIB ' || g.bib || '. Xem thứ hạng và nhận giấy chứng nhận.', '/races/' || r.id, null, true);
    end if;
    return;                                  -- chỉ lấy bài tốt nhất
  end loop;
  update public.race_registrations
     set status = 'REGISTERED', finish_activity_id = null, finish_distance_m = null, finish_moving_s = null,
         finish_time_s = null, finished_at = null
   where id = g.id and status = 'FINISHED';
end $$;

create or replace function private.org_person_stats(p_user uuid, p_from timestamptz, p_to timestamptz, p_min_km numeric)
returns table (km numeric, runs integer, active_days integer)
language sql stable security definer set search_path = public as $$
  select coalesce(round(sum(x.distance_m) / 1000.0, 2), 0), count(*)::int,
         count(distinct (x.started_at at time zone 'Asia/Ho_Chi_Minh')::date)::int
    from public.activities x
   where x.user_id = p_user and x.validation_status = 'APPROVED' and x.shared and not x.review_skipped
     and public.activity_is_countable(x.status, x.validation_status)
     and x.started_at >= p_from and x.started_at < p_to and coalesce(x.distance_m, 0) >= coalesce(p_min_km, 0) * 1000
$$;

create or replace function private.org_day_stats(p_user uuid, p_from timestamptz, p_to timestamptz, p_min_km numeric, p_cap numeric, p_boost jsonb)
returns table (dist_value numeric, runs_value numeric, km numeric, runs integer, active_days integer)
language sql stable security definer set search_path = public as $$
  with d as (
    select (x.started_at at time zone 'Asia/Ho_Chi_Minh')::date as day, sum(x.distance_m) / 1000.0 as km, count(*)::int as runs
      from public.activities x
     where x.user_id = p_user and x.validation_status = 'APPROVED' and x.shared and not x.review_skipped
       and public.activity_is_countable(x.status, x.validation_status)
       and x.started_at >= p_from and x.started_at < p_to and coalesce(x.distance_m, 0) >= coalesce(p_min_km, 0) * 1000
     group by 1
  ), e as (
    select d.day, d.runs, least(d.km, coalesce(p_cap, d.km)) as ckm,
           coalesce((select max(least(greatest((b->>'mult')::numeric, 1), 3)) from jsonb_array_elements(coalesce(p_boost, '[]'::jsonb)) b
                      where (b->>'date') = to_char(d.day, 'YYYY-MM-DD')), 1) as mult
      from d
  )
  select coalesce(round(sum(e.ckm * e.mult), 2), 0), coalesce(sum(e.runs * e.mult), 0), coalesce(round(sum(e.ckm), 2), 0),
         coalesce(sum(e.runs), 0)::int, count(*)::int
    from e
$$;

-- ---------------------------------------------------------------------
-- 2. CLB miễn phí tối đa 50 thành viên (cấu hình được)
-- ---------------------------------------------------------------------
create or replace function private.club_challenge_policy() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('freeMinActiveMembers', 5, 'activeWindowDays', 30, 'freeMaxSlots', 50, 'freeMaxOpen', 2,
                            'proMaxSlots', 1000, 'proMaxOpen', 20, 'freeMaxMembers', 50)
         || coalesce(case when jsonb_typeof(private.economy_config()->'clubChallenge') = 'object'
                          then private.economy_config()->'clubChallenge' end, '{}'::jsonb)
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
$$;

create or replace function private.club_free_member_limit() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_max integer;
begin
  if new.status = 'APPROVED' and (tg_op = 'INSERT' or old.status is distinct from 'APPROVED')
     and not public.is_system_admin() and not private.club_is_pro(new.club_id) then
    v_max := coalesce((private.club_challenge_policy()->>'freeMaxMembers')::int, 50);
    if v_max > 0 and (select count(*) from public.club_members m
                       where m.club_id = new.club_id and m.status = 'APPROVED' and m.user_id <> new.user_id) >= v_max then
      raise exception 'CLUB_FREE_FULL';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_club_free_member_limit on public.club_members;
create trigger trg_club_free_member_limit before insert or update of status on public.club_members
  for each row execute function private.club_free_member_limit();

-- Quyền lợi CLB Pro hiển thị (chỉ sửa khi admin chưa đổi câu chữ của 008200)
update public.plans set perks = '["Không giới hạn thành viên", "Thử thách nội bộ miễn phí: tới 20 thử thách cùng lúc, mỗi thử thách tới 1.000 người", "Không giới hạn quản trị viên", "Tường nhà CLB: ảnh bìa, khẩu hiệu, chủ đề màu", "Link mời riêng + trang công khai /c/tên-clb", "Báo cáo chuyên cần xuất Excel", "Cửa hàng CLB, giao lưu CLB"]'::jsonb
 where code = 'CLUB_PRO'
   and perks = '["Thử thách nội bộ miễn phí: tới 20 thử thách cùng lúc, mỗi thử thách tới 1.000 người", "Không giới hạn quản trị viên", "Tường nhà CLB: ảnh bìa, khẩu hiệu, chủ đề màu", "Link mời riêng + trang công khai /c/tên-clb", "Báo cáo chuyên cần xuất Excel", "Cửa hàng CLB, giao lưu CLB"]'::jsonb;

-- ---------------------------------------------------------------------
-- 3. Bảng so sánh gói (xem được khi chưa đăng nhập; không trả thông tin tài khoản nhận tiền)
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
    'free_captains', 2)
$$;

-- ---------------------------------------------------------------------
-- 4. Trang menu: Điều khoản, Quyền riêng tư, Doanh nghiệp vào help_pages (admin sửa được); cập nhật câu chữ chống gian lận
-- ---------------------------------------------------------------------
insert into public.help_pages (slug, section, title, icon, summary, sort, needs_review, effective_at, body) values

('terms', 'POLICY', 'Điều khoản sử dụng', '📄', 'Quy định khi dùng RaceHub', 1, false, date '2026-10-01', $md$
Khi tạo tài khoản hoặc sử dụng RaceHub, bạn đồng ý với các điều khoản dưới đây và [Chính sách quyền riêng tư](/privacy).

## 1. Tài khoản

- Bạn chịu trách nhiệm bảo mật tài khoản và mọi hoạt động dưới tài khoản của mình.
- Mỗi người một tài khoản. Tạo nhiều tài khoản để nhận thưởng, tặng quà cho chính mình hoặc thao túng bảng xếp hạng bị xem là gian lận.

## 2. Bài chạy và chống gian lận

- Chỉ ghi nhận bài **chạy bộ / đi bộ do chính bạn thực hiện**. Bài đi xe, GPS giả, bài của người khác không được chấp nhận.
- Bài chạy thường ngày được **ghi nhận tự động**. Khi bạn **tham gia thử thách, giải chạy hoặc chiến dịch**, bài có dấu hiệu bất thường sẽ chờ Ban tổ chức / ban quản trị CLB duyệt, có thể bị từ chối và phần thưởng liên quan có thể bị thu hồi.
- Bài có dấu hiệu bất thường được tự duyệt lúc bạn không thi đấu thì không được tính vào thử thách / giải về sau.
- Kết quả thử thách / giải chạy được chốt sau thời gian khiếu nại do hệ thống hoặc Ban tổ chức quy định.

## 3. Xu, quà tặng và gói trả phí

- **Xu** và **Tỏa sáng** là điểm trong ứng dụng, **không có giá trị quy đổi thành tiền**, không chuyển nhượng, không rút ra ngoài.
- RaceHub **không tổ chức cá cược** giữa người dùng. Phần thưởng thử thách là Xu do người tạo / quỹ CLB treo trước.
- Gói VIP / CLB Pro / nạp Xu thanh toán bằng chuyển khoản; được kích hoạt sau khi xác nhận. Khoản đã kích hoạt không hoàn tiền, trừ khi lỗi thuộc về RaceHub.
- Chương trình khuyến mãi có thời hạn và điều kiện riêng; chúng tôi có thể thu hồi phần thưởng nhận được bằng gian lận.

## 4. CLB, giải chạy và nội dung người dùng

- Ban quản trị CLB / Ban tổ chức giải chịu trách nhiệm về nội dung, quỹ CLB, phí tham gia và phần thưởng họ công bố.
- Không đăng nội dung vi phạm pháp luật, xúc phạm, lừa đảo, quảng cáo trái phép hoặc xâm phạm quyền của người khác. Chúng tôi có thể gỡ nội dung và khóa tài khoản vi phạm.
- Bạn giữ quyền với nội dung của mình và cho phép RaceHub hiển thị nội dung đó trong phạm vi dịch vụ.

## 5. Sức khỏe và an toàn

Chạy bộ có rủi ro. Hãy tự đánh giá sức khỏe, tuân thủ luật giao thông và luôn đặt an toàn lên trên thành tích. RaceHub cung cấp công cụ ghi nhận và thi đấu ảo, không phải lời khuyên y tế.

## 6. Dịch vụ bên thứ ba

Kết nối Strava và các dịch vụ khác tuân theo điều khoản của bên đó. RaceHub không chịu trách nhiệm khi dịch vụ bên thứ ba gián đoạn.

## 7. Giới hạn trách nhiệm

Dịch vụ được cung cấp "như hiện có". Trong phạm vi pháp luật cho phép, RaceHub không chịu trách nhiệm cho thiệt hại gián tiếp phát sinh từ việc sử dụng ứng dụng. Chúng tôi có thể thay đổi, tạm dừng tính năng để bảo trì hoặc nâng cấp.

## 8. Luật áp dụng và liên hệ

Điều khoản chịu sự điều chỉnh của pháp luật Việt Nam. Liên hệ: {{support_email}} hoặc [Liên hệ hỗ trợ](/help/lien-he).
$md$),

('privacy', 'POLICY', 'Chính sách quyền riêng tư', '🛡️', 'Dữ liệu nào được thu thập, dùng để làm gì', 2, false, date '2026-10-01', $md$
RaceHub là ứng dụng chạy bộ cộng đồng: ghi nhận bài chạy, thử thách, câu lạc bộ (CLB) và giải chạy ảo. Chính sách này giải thích chúng tôi thu thập dữ liệu gì, dùng để làm gì và quyền của bạn với dữ liệu đó.

## 1. Dữ liệu chúng tôi thu thập

- **Tài khoản:** email, tên hiển thị, ảnh đại diện, khu vực (nếu bạn nhập).
- **Bài chạy:** quãng đường, thời gian, pace, nhịp tim (nếu có), tuyến đường GPS — từ tính năng chạy trong ứng dụng hoặc từ tài khoản Strava bạn chủ động liên kết.
- **Hoạt động trong ứng dụng:** CLB, tổ chức tham gia, thử thách, giải chạy, quà tặng, Xu, nhiệm vụ, bình luận, tin nhắn CLB.
- **Thanh toán:** thông tin đơn hàng (gói, số tiền, mã đơn). Chúng tôi **không lưu** thông tin thẻ hay tài khoản ngân hàng của bạn; chuyển khoản thực hiện qua ứng dụng ngân hàng của bạn.
- **Đọc bài Kiến thức Runner:** bài đã xem / đã lưu / tiến độ đọc và góp ý — để bạn đọc tiếp, nhận huy hiệu; ban biên tập chỉ xem số liệu tổng hợp.
- **Thiết bị:** đăng ký nhận thông báo đẩy (nếu bạn bật), mã lỗi kỹ thuật ẩn danh để sửa lỗi.

## 2. Dữ liệu từ Strava

- Chỉ khi bạn bấm **Kết nối Strava** và đồng ý. Quyền yêu cầu: đọc hồ sơ và bài hoạt động (kể cả bài riêng tư) để tính thử thách, giải chạy và phần thưởng.
- Dữ liệu Strava chỉ dùng để phục vụ chính bạn trong RaceHub. Chúng tôi **không bán**, không chia sẻ cho bên thứ ba vì mục đích quảng cáo, và **không dùng để huấn luyện mô hình AI**.
- Khi bạn kết nối Strava, **quãng đường và thời gian** bài chạy hiện trên bảng tin CLB, bảng xếp hạng, thử thách và giải chạy bạn tham gia. **Bản đồ tuyến, từng km, nhịp tim chỉ bạn xem.** Bạn tắt chia sẻ bất cứ lúc nào ở Cài đặt → Quyền riêng tư; khi tắt, bài vẫn tính Xu, XP, huy hiệu cho riêng bạn.
- Bạn có thể **ngắt kết nối Strava** bất cứ lúc nào trong Cài đặt; khi đó RaceHub thu hồi quyền truy cập và ngừng nhận dữ liệu mới. Nếu bạn xóa bài trên Strava, bài tương ứng trên RaceHub cũng bị gỡ.

## 3. Chúng tôi dùng dữ liệu để

- Tính km, XP, cấp độ, thành tích thử thách / giải chạy, bảng xếp hạng.
- Chống gian lận trong thử thách, giải chạy và chiến dịch (phát hiện bài đi xe, GPS nhảy…) để công bằng cho mọi người.
- Gửi thông báo bạn đã bật (bài chạy đã về, phần thưởng, hoạt động CLB).
- Vận hành CLB, tổ chức, giải chạy, vinh danh theo lựa chọn của Ban tổ chức và của bạn.

## 4. Ai nhìn thấy dữ liệu của bạn

- Thành viên CLB / người tham gia cùng thử thách thấy tên, ảnh đại diện, thành tích trên bảng xếp hạng.
- Tổ chức (doanh nghiệp, liên đoàn) bạn tham gia chỉ thấy tổng km, số buổi, số ngày chạy của bạn — không thấy bản đồ, vị trí hay nhịp tim.
- Ban tổ chức giải chạy thấy danh sách vận động viên và kết quả của giải họ tổ chức.
- Được vinh danh: bạn có thể đổi ảnh hoặc ẩn mình khỏi ảnh vinh danh công khai.
- Nhà cung cấp hạ tầng (máy chủ, cơ sở dữ liệu, gửi thông báo) xử lý dữ liệu thay chúng tôi theo hợp đồng bảo mật.

## 5. Quanh đây (Runner Nearby) — vị trí gần đúng

- Tính năng **tắt theo mặc định**, chỉ bật khi bạn đồng ý rõ ràng; tắt Quanh đây là rút lại đồng ý.
- Chỉ lưu **ô lưới khoảng 1 km** bạn chọn — **không lưu toạ độ chính xác**, không lấy từ GPS bài chạy, không theo dõi liên tục.
- Vị trí **tự hết hạn** (24 giờ, 7 hoặc 30 ngày) và bị xoá ngay khi bạn bấm "Ẩn tôi ngay" hoặc tắt tính năng.
- Người khác chỉ thấy tên gọi, ảnh đại diện, cấp độ, **khoảng cách ước chừng** và các sở thích chạy bạn chọn chia sẻ.
- Bạn chọn ai thấy mình, có thể chặn hoặc báo cáo bất kỳ ai. Phiên bản đầu **không có nhắn tin riêng**.

## 6. Lưu trữ và bảo mật

Dữ liệu được mã hóa khi truyền, phân quyền truy cập chặt chẽ; token Strava lưu ở vùng máy chủ riêng, không lộ ra trình duyệt. Chúng tôi giữ dữ liệu trong thời gian bạn còn dùng tài khoản; sổ giao dịch Xu được lưu vết để đối soát.

## 7. Quyền của bạn

- Xem, sửa hồ sơ và cài đặt quyền riêng tư trong ứng dụng.
- Ngắt kết nối Strava, tắt thông báo, tắt Quanh đây (xoá vị trí ngay) bất cứ lúc nào.
- **Xóa tài khoản và dữ liệu:** tự xoá trong app (Tôi → Cài đặt → Xoá tài khoản) — tuyến GPS, hồ sơ, ảnh, kết nối Strava bị xoá, phần còn lại ẩn danh; hoá đơn được giữ ẩn danh theo quy định kế toán. Hoặc liên hệ {{support_email}}, chúng tôi xử lý trong tối đa 30 ngày.

## 8. Trẻ em

RaceHub dành cho người từ 13 tuổi. Người dưới 18 tuổi nên sử dụng khi có sự đồng ý của cha mẹ / người giám hộ.

## 9. Liên hệ và thay đổi

Mọi câu hỏi về quyền riêng tư: {{support_email}} hoặc [Dữ liệu của tôi](/help/du-lieu-cua-toi). Khi chính sách thay đổi quan trọng, chúng tôi thông báo trong ứng dụng.
$md$),

('doanh-nghiep', 'GUIDE', 'RaceHub cho doanh nghiệp', '🏢', 'Chiến dịch, xếp hạng phòng ban, báo cáo nhân sự', 5, false, date '2026-10-01', $md$
## Dành cho ai?

- **Doanh nghiệp** (phòng nhân sự, công đoàn): phong trào sức khoẻ cho nhân viên, giải chạy nội bộ.
- **Liên đoàn / hệ thống CLB:** quản lý nhiều CLB, tổ chức giải liên CLB.
- **Trường học:** phong trào theo lớp, khoa.

## Tính năng chính

- **Chiến dịch** theo tổng km, số buổi hoặc số ngày chạy; mục tiêu chung và mục tiêu mỗi người; trần km mỗi ngày, ngày hội ×2 / ×3.
- **Bảng xếp hạng đơn vị** (phòng ban, chi nhánh, lớp, CLB) tính cả tổng và bình quân đầu người, kèm tỷ lệ tham gia.
- **Quản lý như phòng nhân sự:** tự duyệt theo email công ty, nhập danh sách từ Excel, đơn vị nhiều cấp, trưởng đơn vị tự quản lý người của mình.
- **Báo cáo** km, số buổi, số ngày chạy của từng người theo mã nhân viên, xuất Excel.
- **Trao giải minh bạch:** chốt kết quả, duyệt top trước khi trao, chứng nhận hoàn thành theo mẫu công ty, quay thưởng có mã kiểm chứng.
- **Thương hiệu riêng:** logo, ảnh bìa, màu chủ đề, bảng tin nội bộ.
- **Quản lý nhiều CLB**, có thể tài trợ CLB Pro cho cả hệ thống.

## Riêng tư và công bằng

Tổ chức chỉ thấy tổng km / số buổi / số ngày của từng người — không thấy bản đồ, vị trí, nhịp tim. Trong chiến dịch, bài có dấu hiệu bất thường được duyệt trước khi tính.

## Bắt đầu thế nào?

1. Gửi yêu cầu báo giá ở trang [RaceHub Doanh nghiệp](/doanh-nghiep#bao-gia).
2. RaceHub gọi lại, chạy thử một chiến dịch, ký hợp đồng (hoá đơn VAT, RaceHub không giữ tiền của thành viên).
3. Người quản trị tổ chức tạo đơn vị, gửi mã mời hoặc nhập danh sách nhân viên, rồi tạo chiến dịch.

Nhân viên đã có mã mời: vào **menu ☰ → Tổ chức của tôi** và nhập mã.
$md$)
on conflict (slug) do nothing;

-- Trang "VIP & CLB Pro" (007300) → "Gói & quyền lợi": mở /goi (bảng so sánh lấy số liệu thật), nội dung dưới đây là phần hỏi đáp
-- bên dưới bảng. Chỉ viết lại khi admin chưa sửa.
update public.help_pages set body = $md$
### Mua gói thế nào?

Vào **Tôi → Gói VIP** (cá nhân) hoặc **Cài đặt CLB → Gói Pro** (CLB), chọn kỳ hạn, chuyển khoản theo mã VietQR. Gói được kích hoạt sau khi RaceHub xác nhận.

### Gia hạn khi còn hạn thì sao?

Thời gian được cộng nối tiếp, không mất ngày nào. Lượt tạo thử thách cấp đầu mỗi tháng, không cộng dồn sang tháng sau.

### CLB miễn phí vượt số thành viên thì sao?

Không ai bị mời ra. CLB chỉ chưa duyệt thêm người mới cho tới khi nâng CLB Pro.

### VIP có giúp xếp hạng cao hơn không?

Không. VIP **không** tăng km, XP hay thứ hạng — mọi runner thi đấu công bằng.

### Doanh nghiệp, liên đoàn, trường học?

Xem [RaceHub Doanh nghiệp](/doanh-nghiep) và gửi yêu cầu báo giá.

Thanh toán & hoàn tiền: xem [Thanh toán & hoàn tiền](/help/thanh-toan-hoan-tien).
$md$, title = 'Gói & quyền lợi', summary = 'So sánh Miễn phí · VIP · CLB Pro · Doanh nghiệp', sort = 6, updated_at = now()
 where slug = 'vip-pro' and updated_by is null;

update public.help_pages set body = $md$
## Nguyên tắc

Bảng xếp hạng, thử thách và phần thưởng chỉ có ý nghĩa khi mọi km là **km chạy / đi bộ thật**.

## Khi nào bài bị kiểm tra?

- **Chạy thường ngày** (không tham gia thử thách, giải hay chiến dịch nào): bài GPS / Strava được **ghi nhận tự động**, tính Xu, XP và bảng xếp hạng CLB.
- **Đang tham gia thử thách, giải chạy ảo hoặc chiến dịch doanh nghiệp:** hệ thống tự kiểm tra từng bài; bài có dấu hiệu bất thường **chờ Ban tổ chức / ban quản trị CLB duyệt** trước khi tính.
- Bài bất thường đã được tự duyệt lúc bạn không thi đấu thì **không tính vào thử thách / giải** về sau.
- Bài **nhập tay** (không có thiết bị ghi) luôn chờ duyệt.

## Hệ thống kiểm tra gì

- Tốc độ và pace ngoài ngưỡng chạy bộ (đi xe, xe máy).
- GPS nhảy, mất tín hiệu dài rồi nối thẳng.
- Bài trùng thời gian, bài nhập tay.

Bài bị từ chối không tính km / Xu / XP.

## Không được

- Nhờ người khác chạy hộ, dùng phương tiện, giả lập GPS.
- Tạo nhiều tài khoản để nhận thưởng.

Vi phạm có thể bị: huỷ kết quả, thu hồi Xu / huy hiệu, loại khỏi thử thách, khoá tài khoản.
$md$, updated_at = now()
 where slug = 'cong-bang-chong-gian-lan' and updated_by is null;

update public.help_pages
   set body = replace(body, 'Bài nghi ngờ sẽ **chờ duyệt**, không bị xoá.',
                      'Chạy thường ngày: bài được ghi nhận tự động. Khi bạn đang tham gia thử thách, giải hoặc chiến dịch, bài nghi ngờ sẽ **chờ duyệt**, không bị xoá.'),
       updated_at = now()
 where slug = 'chay-va-ghi-bai' and position('Bài nghi ngờ sẽ **chờ duyệt**, không bị xoá.' in body) > 0;

update public.help_pages
   set body = replace(body, 'Hệ thống thấy dấu hiệu bất thường (tốc độ, GPS). Admin sẽ xem và duyệt; bạn không cần làm gì.',
                      'Bạn đang tham gia thử thách, giải hoặc chiến dịch và bài có dấu hiệu bất thường (tốc độ, GPS). Ban tổ chức sẽ xem và duyệt; bạn không cần làm gì. Chạy thường ngày thì bài được ghi nhận tự động.'),
       updated_at = now()
 where slug = 'hoi-dap' and position('Admin sẽ xem và duyệt; bạn không cần làm gì.' in body) > 0;

-- ---------------------------------------------------------------------
-- Quyền
-- ---------------------------------------------------------------------
revoke all on function private.in_competition(uuid, timestamptz), private.review_skipped_reason(text), private.activity_review_scope(),
  private.club_free_member_limit() from public, anon, authenticated;
revoke all on function public.plan_compare() from public;
grant execute on function public.plan_compare() to anon, authenticated;

notify pgrst, 'reload schema';

-- ===================================================================
-- 20261001008600_org_demo.sql
-- ===================================================================
-- 008600: Tổ chức DEMO cho admin và khách dùng thử gói Doanh nghiệp.
-- • admin_create_demo_org(p): admin bấm một nút → tạo tổ chức "[DEMO] …" có sẵn dữ liệu mẫu để xem ngay cấu trúc quản lý:
--     đơn vị nhiều cấp (theo loại hình: phòng ban / khối-lớp / khu vực), một chiến dịch đang chạy (mục tiêu chung + mỗi người,
--     trần km/ngày, ngày hội ×2, chứng nhận), bảng tin có thông báo ghim. Admin là chủ tổ chức.
--   Tuỳ chọn guest_email: thêm khách (đã có tài khoản RaceHub) làm QUẢN TRỊ VIÊN để khách tự bấm thử mọi chức năng quản lý.
--   Demo hết hạn sau p.days ngày (mặc định 14, tối đa 60), tối đa 50 chỗ; không tài trợ CLB Pro. Người khác vào bằng mã mời như thật.
-- • admin_delete_demo_org(p_org): xoá hẳn tổ chức demo (chỉ tổ chức tên bắt đầu "[DEMO]"), ghi nhật ký.
-- Cần 008300, 008400. Chạy được trong SQL Editor: không DO $$, không SELECT INTO, không LIMIT, không RETURNING INTO. Chạy lại an toàn.

create or replace function public.admin_create_demo_org(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_admin uuid := private.require_admin();
  v_kind text := case when p->>'kind' in ('COMPANY', 'FEDERATION', 'SCHOOL') then p->>'kind' else 'COMPANY' end;
  v_name text := left(coalesce(nullif(trim(coalesce(p->>'name', '')), ''),
                               case v_kind when 'FEDERATION' then 'Liên đoàn Chạy bộ Mẫu' when 'SCHOOL' then 'Trường THPT Mẫu' else 'Công ty Mẫu' end), 100);
  v_guest_email text := nullif(lower(trim(coalesce(p->>'guest_email', ''))), '');
  v_guest uuid := (select u.id from auth.users u where lower(u.email) = v_guest_email);
  v_days integer := least(greatest(coalesce(nullif(p->>'days', '')::int, 14), 1), 60);
  v_id uuid := gen_random_uuid();
  v_code text := private.org_new_code();
  v_a uuid := gen_random_uuid();
  v_a1 uuid := gen_random_uuid();
  v_a2 uuid := gen_random_uuid();
  v_b uuid := gen_random_uuid();
  v_c uuid := gen_random_uuid();
  v_camp uuid := gen_random_uuid();
  v_boost text := to_char((now() at time zone 'Asia/Ho_Chi_Minh')::date + 7, 'YYYY-MM-DD');
begin
  if v_guest_email is not null and v_guest is null then raise exception 'OWNER_NOT_FOUND'; end if;

  insert into public.organizations (id, name, kind, description, tagline, theme, invite_code, join_policy, unit_label,
                                    seat_limit, club_limit, include_club_pro, active_until, contact_email, created_by)
  values (v_id, '[DEMO] ' || v_name, v_kind,
          'Tổ chức dùng thử gói RaceHub Doanh nghiệp. Dữ liệu mẫu — có thể xoá bất cứ lúc nào.',
          'Chạy vì sức khoẻ, về đích cùng nhau', 'OCEAN', v_code, 'OPEN',
          case v_kind when 'SCHOOL' then 'Lớp' when 'FEDERATION' then 'Khu vực' else 'Phòng ban' end,
          50, case when v_kind = 'FEDERATION' then 5 else 0 end, false, now() + make_interval(days => v_days), v_guest_email, v_admin);

  -- Đơn vị nhiều cấp theo loại hình
  insert into public.org_units (id, org_id, name, sort, parent_id) values
    (v_a, v_id, case v_kind when 'SCHOOL' then 'Khối 10' when 'FEDERATION' then 'Miền Bắc' else 'Phòng Kinh doanh' end, 1, null),
    (v_a1, v_id, case v_kind when 'SCHOOL' then '10A1' when 'FEDERATION' then 'Hà Nội' else 'Kinh doanh Miền Bắc' end, 1, v_a),
    (v_a2, v_id, case v_kind when 'SCHOOL' then '10A2' when 'FEDERATION' then 'Hải Phòng' else 'Kinh doanh Miền Nam' end, 2, v_a),
    (v_b, v_id, case v_kind when 'SCHOOL' then 'Khối 11' when 'FEDERATION' then 'Miền Trung' else 'Phòng Kỹ thuật' end, 2, null),
    (v_c, v_id, case v_kind when 'SCHOOL' then 'Giáo viên' when 'FEDERATION' then 'Miền Nam' else 'Hành chính – Nhân sự' end, 3, null);

  insert into public.org_members (org_id, user_id, role, status, unit_id) values (v_id, v_admin, 'OWNER', 'APPROVED', v_c);
  if v_guest is not null and v_guest <> v_admin then
    insert into public.org_members (org_id, user_id, role, status, unit_id) values (v_id, v_guest, 'ADMIN', 'APPROVED', v_a1)
    on conflict (org_id, user_id) do nothing;
  end if;

  insert into public.org_campaigns (id, org_id, title, description, metric, starts_at, ends_at, goal_total, goal_per_person, min_run_km,
                                    daily_cap_km, boost_days, cert_enabled, created_by)
  values (v_camp, v_id, '30 ngày – cùng nhau 1.000 km',
          'Chiến dịch mẫu: mỗi người 30 km trong 30 ngày, cả tổ chức cùng chinh phục 1.000 km. Bài từ 1 km, tối đa 21 km mỗi ngày. '
          || 'Ngày hội ' || v_boost || ' tính ×2. Đạt mục tiêu nhận chứng nhận hoàn thành.',
          'DISTANCE', now() - interval '3 days', now() + interval '27 days', 1000, 30, 1, 21,
          jsonb_build_array(jsonb_build_object('date', v_boost, 'mult', 2)), true, v_admin);

  insert into public.org_posts (org_id, author_id, kind, body, is_pinned, meta) values
    (v_id, v_admin, 'ANNOUNCEMENT',
     'Chào mừng đến với tổ chức dùng thử! Mời đồng nghiệp bằng mã ' || v_code || ', xem bảng xếp hạng theo '
     || case v_kind when 'SCHOOL' then 'lớp' when 'FEDERATION' then 'khu vực' else 'phòng ban' end
     || ', thử nhập danh sách từ Excel và xuất báo cáo ở tab Báo cáo.', true, '{}'::jsonb),
    (v_id, v_admin, 'CAMPAIGN', 'Chiến dịch "30 ngày – cùng nhau 1.000 km" đã bắt đầu. Chạy bài đầu tiên để lên bảng!', false,
     jsonb_build_object('campaign_id', v_camp));

  insert into public.admin_audit_log (actor_id, action, target, new_value)
  values (v_admin, 'ORG_DEMO_CREATE', 'org:' || v_id, jsonb_build_object('kind', v_kind, 'days', v_days, 'guest_id', v_guest));
  if v_guest is not null and v_guest <> v_admin then
    perform private.notify(v_guest, null, 'ORG_CREATED', 'Mời bạn dùng thử RaceHub Doanh nghiệp',
      'Bạn là quản trị viên của tổ chức dùng thử "' || v_name || '" trong ' || v_days || ' ngày.', '/orgs/' || v_id, v_admin, true);
  end if;
  return jsonb_build_object('id', v_id, 'invite_code', v_code, 'campaign_id', v_camp);
end $$;

create or replace function public.admin_delete_demo_org(p_org uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_admin uuid := private.require_admin();
  v_old public.organizations := (select o from public.organizations o where o.id = p_org);
begin
  if v_old.id is null then raise exception 'ORG_NOT_FOUND'; end if;
  if v_old.name not like '[DEMO]%' then raise exception 'NOT_DEMO'; end if;
  delete from public.organizations where id = p_org;
  insert into public.admin_audit_log (actor_id, action, target, old_value)
  values (v_admin, 'ORG_DEMO_DELETE', 'org:' || p_org, jsonb_build_object('name', v_old.name));
end $$;

revoke all on function public.admin_create_demo_org(jsonb), public.admin_delete_demo_org(uuid) from public, anon;
grant execute on function public.admin_create_demo_org(jsonb), public.admin_delete_demo_org(uuid) to authenticated;

notify pgrst, 'reload schema';

-- ===================================================================
-- 20261001008700_org_overview.sql
-- ===================================================================
-- 008700: Tổng quan tổ chức — màn đầu tiên khi vào tổ chức (chuẩn như bảng điều khiển phong trào của doanh nghiệp).
-- org_overview(org, từ, đến) trong khoảng ngày bất kỳ (≤ 400 ngày):
--   • kpi: số người, số người đã chạy, tỷ lệ tham gia, tổng km, số buổi, km bình quân / người;
--   • units: từng đơn vị (có parent_id để app cộng dồn lên cấp trên): thành viên, đã chạy, km — BXH phòng ban theo tổng và bình quân;
--   • clubs: CLB thuộc tổ chức (liên đoàn): thành viên, đã chạy, km;
--   • top: 10 người chạy nhiều km nhất (chế độ riêng tư: thành viên thường không thấy danh sách, chỉ thấy thứ hạng của mình);
--   • me: km / buổi / hạng của chính mình; days: km theo ngày (giờ Việt Nam) để vẽ biểu đồ.
-- Chỉ tính bài hợp lệ, đang chia sẻ, không bị tự duyệt vì nghi vấn (cùng luật chiến dịch — private.org_person_stats).
-- Ai xem được: thành viên tổ chức (trực tiếp hoặc qua CLB thuộc tổ chức), admin hệ thống.
-- Cần 008300, 008400, 008500. Chạy được trong SQL Editor: không DO $$, không SELECT INTO, không LIMIT, không RETURNING INTO. Chạy lại an toàn.

create or replace function public.org_overview(p_org uuid, p_from timestamptz, p_to timestamptz) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  o public.organizations := (select x from public.organizations x where x.id = p_org);
  v_uid uuid := auth.uid();
  v_admin boolean := public.org_is_admin(p_org) or public.is_system_admin();
  v_hide boolean;
begin
  if o.id is null then raise exception 'ORG_NOT_FOUND'; end if;
  if not (v_admin or public.org_is_member(p_org) or exists (select 1 from private.org_people(p_org) pp where pp.user_id = v_uid)) then
    raise exception 'NOT_A_MEMBER';
  end if;
  if p_from is null or p_to is null or p_to <= p_from or p_to - p_from > interval '400 days' then raise exception 'INVALID_TIME_RANGE'; end if;
  v_hide := o.privacy_mode and not v_admin;

  return (
    with st as (
      select pp.user_id, pp.unit_id, pp.direct, s.km, s.runs, s.active_days
        from private.org_people(p_org) pp
        cross join lateral private.org_person_stats(pp.user_id, p_from, p_to, 0) s
    ), ranked as (
      select st.*, (rank() over (order by st.km desc))::int as rnk from st
    )
    select jsonb_build_object(
      'kpi', (select jsonb_build_object('people', count(*)::int, 'active', count(*) filter (where runs > 0)::int,
                                        'km', coalesce(round(sum(km), 1), 0), 'runs', coalesce(sum(runs), 0)::int,
                                        'avg_km', case when count(*) > 0 then round(coalesce(sum(km), 0) / count(*), 2) else 0 end)
                from st),
      'units', coalesce((select jsonb_agg(jsonb_build_object('id', u.id, 'name', u.name, 'parent_id', u.parent_id,
                                          'members', coalesce(x.members, 0), 'active', coalesce(x.active, 0), 'km', coalesce(x.km, 0))
                                          order by u.sort, u.name)
                           from public.org_units u
                           left join (select st.unit_id, count(*)::int as members, count(*) filter (where st.runs > 0)::int as active,
                                             round(sum(st.km), 1) as km
                                        from st where st.unit_id is not null group by st.unit_id) x on x.unit_id = u.id
                          where u.org_id = p_org), '[]'::jsonb),
      'clubs', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'avatar_url', c.avatar_url,
                                          'members', y.members, 'active', y.active, 'km', y.km) order by y.km desc)
                           from (select oc.club_id, count(distinct st.user_id)::int as members,
                                        count(distinct st.user_id) filter (where st.runs > 0)::int as active, round(coalesce(sum(st.km), 0), 1) as km
                                   from public.org_clubs oc
                                   join public.club_members cm on cm.club_id = oc.club_id and cm.status = 'APPROVED'
                                   join st on st.user_id = cm.user_id
                                  where oc.org_id = p_org and oc.status = 'APPROVED'
                                  group by oc.club_id) y
                           join public.clubs c on c.id = y.club_id), '[]'::jsonb),
      'top', case when v_hide then '[]'::jsonb else coalesce((
               select jsonb_agg(jsonb_build_object('rank', r.rnk, 'user_id', r.user_id, 'name', private.display_name(r.user_id),
                                                   'avatar_url', pr.avatar_url, 'unit_name', u.name, 'km', r.km, 'runs', r.runs)
                                order by r.rnk, private.display_name(r.user_id))
                 from ranked r
                 join public.profiles pr on pr.id = r.user_id
                 left join public.org_units u on u.id = r.unit_id
                where r.rnk <= 10 and r.km > 0), '[]'::jsonb) end,
      'me', (select jsonb_build_object('rank', r.rnk, 'km', r.km, 'runs', r.runs, 'active_days', r.active_days)
               from ranked r where r.user_id = v_uid),
      'days', coalesce((select jsonb_agg(jsonb_build_object('day', d.day, 'km', d.km) order by d.day)
                          from (select (a.started_at at time zone 'Asia/Ho_Chi_Minh')::date as day, round(sum(a.distance_m) / 1000.0, 1) as km
                                  from public.activities a
                                  join st on st.user_id = a.user_id
                                 where a.validation_status = 'APPROVED' and a.shared and not a.review_skipped
                                   and public.activity_is_countable(a.status, a.validation_status)
                                   and a.started_at >= p_from and a.started_at < p_to
                                 group by 1) d), '[]'::jsonb),
      'privacy_mode', o.privacy_mode, 'hidden', v_hide, 'is_admin', v_admin, 'unit_label', o.unit_label)
  );
end $$;

revoke all on function public.org_overview(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.org_overview(uuid, timestamptz, timestamptz) to authenticated;

notify pgrst, 'reload schema';

-- ===================================================================
-- 20261001008800_gps_quality.sql
-- ===================================================================
-- 008800: Chất lượng GPS của bài chạy ghi bằng app + kiểm thử thực địa.
-- • public.activity_gps_quality: MỘT dòng tóm tắt nhỏ (≤ 8 KB) cho mỗi bài DIRECT_GPS — số điểm nhận / bị loại theo lý do,
--   sai số trung bình, số lần + tổng giây mất tín hiệu, số lần ẩn app / tắt màn hình, tạm dừng, đứng nghỉ lâu, phần đứng yên
--   cuối bài bị cắt, nhật ký sự kiện, thiết bị (web / ios / android) và phần kiểm thử (kịch bản, quãng đường chuẩn, ghi chú).
--   KHÔNG lưu từng điểm bị loại (dữ liệu gấp 3–5 lần). Bảng riêng, không ai đọc trực tiếp: chủ bài + admin xem qua RPC.
-- • activity_attach_gps_quality(started_at, q): app gửi sau khi lưu bài (cả bài gửi lại từ hàng chờ) — tìm bài theo giờ bắt đầu.
-- • activity_gps_quality(activity): chủ bài / admin xem.
-- • admin_gps_qa_list(days): admin — các bài kiểm thử thực địa + thống kê chất lượng mọi bài ghi bằng app.
-- Không đổi submit_and_process_activity. Chạy được trong SQL Editor: không DO $$, không SELECT INTO, không LIMIT, không RETURNING INTO. Chạy lại an toàn.

create table if not exists public.activity_gps_quality (
  activity_id uuid primary key references public.activities(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  data jsonb not null,
  is_qa boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists activity_gps_quality_qa_idx on public.activity_gps_quality (created_at desc) where is_qa;
create index if not exists activity_gps_quality_created_idx on public.activity_gps_quality (created_at desc);
alter table public.activity_gps_quality enable row level security;
revoke all on public.activity_gps_quality from public, anon, authenticated;

create or replace function public.activity_attach_gps_quality(p_started_at timestamptz, p_quality jsonb) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  v_act uuid := (select (array_agg(a.id order by a.created_at desc))[1] from public.activities a
                  where a.user_id = v_uid and a.source = 'DIRECT_GPS' and a.started_at = p_started_at);
begin
  if p_quality is null or jsonb_typeof(p_quality) <> 'object' then raise exception 'INVALID_INPUT'; end if;
  if octet_length(p_quality::text) > 8192 then raise exception 'PAYLOAD_TOO_LARGE'; end if;
  if v_act is null then return false; end if;
  insert into public.activity_gps_quality (activity_id, user_id, data, is_qa)
  values (v_act, v_uid, p_quality, jsonb_typeof(p_quality->'qa') = 'object')
  on conflict (activity_id) do nothing;
  return true;
end $$;

create or replace function public.activity_gps_quality(p_activity_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  q public.activity_gps_quality := (select x from public.activity_gps_quality x where x.activity_id = p_activity_id);
begin
  if q.activity_id is null then return null; end if;
  if q.user_id is distinct from v_uid and not public.is_system_admin() then raise exception 'FORBIDDEN'; end if;
  return q.data;
end $$;

create or replace function public.admin_gps_qa_list(p_days integer default 60) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_admin uuid := private.require_admin();
  v_from timestamptz := now() - make_interval(days => least(greatest(coalesce(p_days, 60), 1), 365));
begin
  return jsonb_build_object(
    'runs', coalesce((
      select jsonb_agg(jsonb_build_object(
               'activity_id', r.activity_id, 'user_id', r.user_id, 'name', private.display_name(r.user_id),
               'started_at', a.started_at, 'distance_m', a.distance_m, 'moving_s', a.moving_time_s, 'elapsed_s', a.elapsed_time_s,
               'validation_status', a.validation_status, 'data', r.data) order by r.created_at desc)
        from (select x.*, row_number() over (order by x.created_at desc) as rn
                from public.activity_gps_quality x where x.is_qa and x.created_at >= v_from) r
        join public.activities a on a.id = r.activity_id
       where r.rn <= 300), '[]'::jsonb),
    'all', (select jsonb_build_object(
              'runs', count(*)::int,
              'fixes', coalesce(sum((x.data->>'fixes')::numeric), 0),
              'accepted', coalesce(sum((x.data->>'accepted')::numeric), 0),
              'with_gaps', count(*) filter (where coalesce((x.data->>'gaps')::int, 0) > 0)::int,
              'gap_s', coalesce(sum((x.data->>'gap_s')::numeric), 0),
              'trimmed', count(*) filter (where coalesce((x.data->>'trimmed_s')::int, 0) > 0)::int,
              'auto_stopped', count(*) filter (where coalesce((x.data->>'auto_stopped')::int, 0) > 0)::int,
              'acc_avg', round(avg((x.data->>'acc_avg')::numeric), 1),
              'by_platform', coalesce((select jsonb_object_agg(pl, n) from (
                  select coalesce(y.data->>'platform', 'web') as pl, count(*)::int as n
                    from public.activity_gps_quality y where y.created_at >= v_from group by 1) z), '{}'::jsonb))
              from public.activity_gps_quality x where x.created_at >= v_from),
    'days', least(greatest(coalesce(p_days, 60), 1), 365));
end $$;

revoke all on function public.activity_attach_gps_quality(timestamptz, jsonb), public.activity_gps_quality(uuid),
  public.admin_gps_qa_list(integer) from public, anon;
grant execute on function public.activity_attach_gps_quality(timestamptz, jsonb), public.activity_gps_quality(uuid),
  public.admin_gps_qa_list(integer) to authenticated;

notify pgrst, 'reload schema';

-- ===================================================================
-- 20261001008900_club_rpc_auth_fix.sql
-- ===================================================================
-- 008900: VÁ BẢO MẬT + nguyên tắc "chỉ chủ nhiệm và người được phân quyền mới sửa CLB" — các hàm quản lý CLB đời đầu (có sẵn trên production trước khi dùng migration) kiểm tra quyền kiểu
--   if public.club_role(club) not in ('OWNER','CAPTAIN') then raise ...
-- club_role() trả về NULL khi người gọi KHÔNG thuộc CLB (hoặc chưa đăng nhập) → "NULL not in (...)" = NULL → KHÔNG báo lỗi →
-- bất kỳ ai (kể cả chưa đăng nhập) đổi được tên / mô tả / ảnh / thông báo / chính sách tham gia của mọi CLB, đổi mã mời,
-- đổi vai trò / duyệt / cấm thành viên, chuyển quyền chủ CLB (tự tham gia CLB mở rồi chuyển chủ cho mình).
-- Sửa: so sánh với coalesce(club_role(...), '') (không phải thành viên = không có quyền); giữ nguyên chữ ký + kiểu trả về
-- + hành vi với chủ / đội trưởng / admin hệ thống. Thu hồi quyền gọi của khách chưa đăng nhập (anon) với các hàm ghi.
-- Không đổi club_role (chính sách club_treasury_select dùng "is not null"). Chạy được trong SQL Editor: không DO $$,
-- không SELECT INTO, không LIMIT, không RETURNING INTO. Chạy lại an toàn.

create or replace function public.rotate_invite_code(p_club_id uuid) returns text
language plpgsql security definer set search_path = public as $$
declare v_code text;
begin
  if coalesce(public.club_role(p_club_id), '') not in ('OWNER', 'CAPTAIN') then raise exception 'FORBIDDEN'; end if;
  loop
    v_code := encode(extensions.gen_random_bytes(6), 'hex');
    exit when not exists (select 1 from public.clubs where invite_code = v_code);
  end loop;
  update public.clubs set invite_code = v_code where id = p_club_id;
  return v_code;
end $$;

create or replace function public.set_club_announcement(p_club_id uuid, p_text text) returns public.clubs
language plpgsql security definer set search_path = public as $$
declare v_text text := nullif(trim(coalesce(p_text, '')), '');
begin
  if coalesce(public.club_role(p_club_id), '') not in ('OWNER', 'CAPTAIN') then raise exception 'FORBIDDEN'; end if;
  if char_length(coalesce(p_text, '')) > 500 then raise exception 'ANNOUNCEMENT_TOO_LONG'; end if;
  update public.clubs
     set announcement = v_text,
         announced_at = case when v_text is null then null else now() end,
         announced_by = case when v_text is null then null else auth.uid() end
   where id = p_club_id;
  return (select c from public.clubs c where c.id = p_club_id);
end $$;

create or replace function public.update_club(p_club_id uuid, p_name text default null, p_description text default null,
                                              p_avatar_url text default null, p_avatar_path text default null) returns public.clubs
language plpgsql security definer set search_path = public as $$
declare
  v_old_path text;
  v_club public.clubs;
begin
  if coalesce(public.club_role(p_club_id), '') not in ('OWNER', 'CAPTAIN') then raise exception 'FORBIDDEN'; end if;
  v_old_path := (select c.avatar_path from public.clubs c where c.id = p_club_id);
  if p_name is not null then
    if trim(p_name) = '' then raise exception 'NAME_REQUIRED'; end if;
    if char_length(trim(p_name)) > 60 then raise exception 'NAME_TOO_LONG'; end if;
  end if;
  if p_description is not null and char_length(p_description) > 300 then raise exception 'DESC_TOO_LONG'; end if;
  begin
    update public.clubs
       set name        = coalesce(nullif(trim(coalesce(p_name, '')), ''), name),
           description = case when p_description is null then description else nullif(trim(p_description), '') end,
           avatar_url  = case when p_avatar_url is null then avatar_url else nullif(trim(p_avatar_url), '') end,
           avatar_path = case when p_avatar_url is null then avatar_path else nullif(trim(coalesce(p_avatar_path, '')), '') end
     where id = p_club_id;
  exception when unique_violation then
    raise exception 'NAME_TAKEN';
  end;
  v_club := (select c from public.clubs c where c.id = p_club_id);
  if v_club.id is null then raise exception 'CLUB_NOT_FOUND'; end if;
  -- Dọn file ảnh cũ để storage không phình
  if p_avatar_url is not null and v_old_path is not null and v_old_path is distinct from v_club.avatar_path then
    delete from storage.objects where bucket_id = 'club-avatars' and name = v_old_path;
  end if;
  return v_club;
end $$;

create or replace function public.update_club_policy(p_club_id uuid, p_join_policy text default null, p_member_limit integer default null)
returns public.clubs
language plpgsql security definer set search_path = public as $$
declare v_club public.clubs;
begin
  if coalesce(public.club_role(p_club_id), '') <> 'OWNER' then raise exception 'FORBIDDEN'; end if;
  if p_join_policy is not null and p_join_policy not in ('OPEN', 'APPROVAL', 'INVITE_ONLY') then raise exception 'INVALID_POLICY'; end if;
  if p_member_limit is not null then
    if p_member_limit < 2 or p_member_limit > 1000 then raise exception 'INVALID_LIMIT'; end if;
    if p_member_limit < (select c.member_count from public.clubs c where c.id = p_club_id) then raise exception 'LIMIT_BELOW_CURRENT'; end if;
  end if;
  update public.clubs
     set join_policy = coalesce(p_join_policy, join_policy), member_limit = coalesce(p_member_limit, member_limit)
   where id = p_club_id;
  v_club := (select c from public.clubs c where c.id = p_club_id);
  -- Chuyển sang OPEN thì duyệt luôn hàng chờ, trong giới hạn còn trống
  if p_join_policy = 'OPEN' then
    update public.club_members m set status = 'APPROVED', joined_at = now()
     where m.id in (select x.id from (
             select pm.id, row_number() over (order by pm.joined_at) as rn
               from public.club_members pm where pm.club_id = p_club_id and pm.status = 'PENDING') x
             where x.rn <= greatest(v_club.member_limit - v_club.member_count, 0));
    v_club := (select c from public.clubs c where c.id = p_club_id);
  end if;
  return v_club;
end $$;

create or replace function public.set_member_role(p_member_id uuid, p_role text) returns public.club_members
language plpgsql security definer set search_path = public as $$
declare v_row public.club_members := (select m from public.club_members m where m.id = p_member_id);
begin
  if p_role not in ('CAPTAIN', 'MEMBER') then raise exception 'INVALID_ROLE'; end if;
  if v_row.id is null then raise exception 'MEMBER_NOT_FOUND'; end if;
  if coalesce(public.club_role(v_row.club_id), '') <> 'OWNER' then raise exception 'FORBIDDEN'; end if;
  if v_row.role = 'OWNER' then raise exception 'FORBIDDEN'; end if;
  if v_row.status <> 'APPROVED' then raise exception 'TARGET_NOT_APPROVED'; end if;
  update public.club_members set role = p_role where id = p_member_id;
  return (select m from public.club_members m where m.id = p_member_id);
end $$;

create or replace function public.set_member_status(p_member_id uuid, p_status text) returns public.club_members
language plpgsql security definer set search_path = public as $$
declare
  v_row public.club_members := (select m from public.club_members m where m.id = p_member_id);
  v_me text;
  v_club public.clubs;
begin
  if p_status not in ('APPROVED', 'REJECTED', 'BANNED') then raise exception 'INVALID_STATUS'; end if;
  if v_row.id is null then raise exception 'MEMBER_NOT_FOUND'; end if;
  v_me := coalesce(public.club_role(v_row.club_id), '');
  if v_me not in ('OWNER', 'CAPTAIN') then raise exception 'FORBIDDEN'; end if;
  if v_row.role = 'OWNER' then raise exception 'FORBIDDEN'; end if;
  if public.club_rank(v_me) <= public.club_rank(v_row.role) then raise exception 'FORBIDDEN'; end if;
  if p_status = 'APPROVED' then
    v_club := (select c from public.clubs c where c.id = v_row.club_id);
    if v_club.member_count >= v_club.member_limit then raise exception 'CLUB_FULL'; end if;
  end if;
  update public.club_members
     set status = p_status, joined_at = case when p_status = 'APPROVED' then now() else joined_at end
   where id = p_member_id;
  return (select m from public.club_members m where m.id = p_member_id);
end $$;

create or replace function public.transfer_ownership(p_club_id uuid, p_to_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_target public.club_members := (select m from public.club_members m
                                          where m.club_id = p_club_id and m.user_id = p_to_user and m.status = 'APPROVED');
begin
  if coalesce(public.club_role(p_club_id), '') <> 'OWNER' then raise exception 'FORBIDDEN'; end if;
  if v_target.id is null then raise exception 'TARGET_NOT_APPROVED'; end if;
  update public.club_members set role = 'CAPTAIN' where club_id = p_club_id and user_id = auth.uid();
  update public.club_members set role = 'OWNER' where id = v_target.id;
  update public.clubs set owner_id = p_to_user where id = p_club_id;
end $$;

create or replace function public.remove_member(p_member_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_row public.club_members := (select m from public.club_members m where m.id = p_member_id);
  v_me text;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if v_row.id is null then return; end if;
  v_me := public.club_role(v_row.club_id);
  if v_row.user_id = auth.uid() then
    if v_row.role = 'OWNER' then raise exception 'OWNER_CANNOT_LEAVE'; end if;
  elsif v_me is null or public.club_rank(v_me) <= public.club_rank(v_row.role) then
    raise exception 'FORBIDDEN';
  end if;
  delete from public.club_members where id = p_member_id;
end $$;

-- Nguyên tắc: trong một CLB chỉ CHỦ NHIỆM (OWNER) và người được chủ nhiệm PHÂN QUYỀN (Ban quản trị — CAPTAIN) được tạo /
-- sửa / xoá nội dung và cài đặt của CLB (admin hệ thống vẫn toàn quyền — 007100). Thành viên chỉ tham gia: bình chọn,
-- đăng ký sự kiện, bình luận, thả tim, nhắn tin, đặt hàng, báo đã nộp phí.
-- Bình chọn: trước đây thành viên nào cũng tạo được → chỉ Ban quản trị.
create or replace function public.create_club_poll(p_club_id uuid, p_question text, p_options text[], p_multi boolean,
                                                   p_closes_at timestamptz, p_hide_results boolean) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := private.require_staff(p_club_id); v_id uuid := gen_random_uuid(); v_opts jsonb; m record;
begin
  if char_length(trim(coalesce(p_question, ''))) not between 3 and 200 then raise exception 'INVALID_QUESTION'; end if;
  v_opts := (select coalesce(jsonb_agg(trim(o) order by i), '[]'::jsonb)
               from unnest(p_options) with ordinality as t(o, i) where char_length(trim(coalesce(o, ''))) between 1 and 80);
  if jsonb_array_length(v_opts) not between 2 and 10 or jsonb_array_length(v_opts) <> cardinality(p_options) then
    raise exception 'INVALID_OPTIONS';
  end if;
  if p_closes_at is not null and p_closes_at <= now() then raise exception 'INVALID_TIME'; end if;
  if (select count(*) from public.club_polls where created_by = v_uid and created_at > now() - interval '1 hour') >= 5 then
    raise exception 'RATE_LIMITED';
  end if;
  insert into public.club_polls (id, club_id, created_by, question, options, multi, hide_results, closes_at)
  values (v_id, p_club_id, v_uid, trim(p_question), v_opts, coalesce(p_multi, false), coalesce(p_hide_results, false), p_closes_at);
  for m in select user_id from public.club_members where club_id = p_club_id and status = 'APPROVED' and user_id <> v_uid loop
    perform private.notify(m.user_id, p_club_id, 'CLUB_POLL', private.display_name(v_uid) || ' tạo bình chọn', trim(p_question),
      '/clubs/' || p_club_id || '/events', v_uid, false);
  end loop;
  return v_id;
end $$;

-- Ảnh đại diện CLB (bucket club-avatars, thư mục <club_id>/…): chỉ Ban quản trị CLB được tải lên / thay / xoá.
-- Chính sách HẠN CHẾ (restrictive): cộng thêm điều kiện lên mọi chính sách sẵn có của bucket trên production.
drop policy if exists club_avatars_staff_insert on storage.objects;
create policy club_avatars_staff_insert on storage.objects as restrictive for insert to authenticated
  with check (bucket_id <> 'club-avatars' or public.club_is_staff(public.safe_uuid((storage.foldername(name))[1])));
drop policy if exists club_avatars_staff_update on storage.objects;
create policy club_avatars_staff_update on storage.objects as restrictive for update to authenticated
  using (bucket_id <> 'club-avatars' or public.club_is_staff(public.safe_uuid((storage.foldername(name))[1])));
drop policy if exists club_avatars_staff_delete on storage.objects;
create policy club_avatars_staff_delete on storage.objects as restrictive for delete to authenticated
  using (bucket_id <> 'club-avatars' or public.club_is_staff(public.safe_uuid((storage.foldername(name))[1])));

-- Khách chưa đăng nhập không có lý do gọi các hàm ghi / tra quyền này
revoke execute on function public.rotate_invite_code(uuid), public.set_club_announcement(uuid, text),
  public.update_club(uuid, text, text, text, text), public.update_club_policy(uuid, text, integer),
  public.set_member_role(uuid, text), public.set_member_status(uuid, text), public.transfer_ownership(uuid, uuid),
  public.remove_member(uuid), public.join_club(uuid), public.delete_club(uuid), public.delete_club(uuid, text),
  public.admin_help_delete(text), public.admin_help_list(), public.admin_help_save(jsonb),
  public.admin_site_info_save(jsonb), public.get_challenge_fee(integer), public.validate_fee_tiers(jsonb)
  from public, anon;
grant execute on function public.rotate_invite_code(uuid), public.set_club_announcement(uuid, text),
  public.update_club(uuid, text, text, text, text), public.update_club_policy(uuid, text, integer),
  public.set_member_role(uuid, text), public.set_member_status(uuid, text), public.transfer_ownership(uuid, uuid),
  public.remove_member(uuid), public.join_club(uuid), public.delete_club(uuid), public.delete_club(uuid, text),
  public.admin_help_delete(text), public.admin_help_list(), public.admin_help_save(jsonb),
  public.admin_site_info_save(jsonb), public.get_challenge_fee(integer), public.validate_fee_tiers(jsonb)
  to authenticated;
-- Hàm trigger: không ai gọi trực tiếp qua API
revoke execute on function public.handle_new_user(), public.sync_club_member_count(), public.trigger_auto_reward_on_activity()
  from public, anon, authenticated;

notify pgrst, 'reload schema';

-- ===================================================================
-- 20261001009000_client_error_resolve.sql
-- ===================================================================
-- 009000: "Lỗi người dùng gặp" — admin đánh dấu ĐÃ XỬ LÝ (sau khi đã sửa nguyên nhân, vd. chạy migration còn thiếu):
-- xoá khỏi nhật ký lỗi → số đỏ ở Quản trị → Hệ thống và mục Kiểm tra hệ thống sạch ngay, không phải đợi 24 giờ.
-- Nếu lỗi còn xảy ra, lần tiếp theo người dùng gặp sẽ được ghi lại như mới. Mỗi lần xoá ghi nhật ký quản trị (số lần đã gặp).
-- Chạy được trong SQL Editor: không DO $$, không SELECT INTO, không LIMIT, không RETURNING INTO. Chạy lại an toàn.

create or replace function public.admin_resolve_client_error(p_code text default null) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_admin uuid := private.require_admin();
  v_code text := nullif(trim(coalesce(p_code, '')), '');
  v_hits integer := (select coalesce(sum(e.hits), 0)::integer from private.client_errors e where v_code is null or e.code = v_code);
begin
  delete from private.client_error_users where v_code is null or code = v_code;
  delete from private.client_errors where v_code is null or code = v_code;
  insert into public.admin_audit_log (actor_id, action, target, old_value)
  values (v_admin, 'CLIENT_ERROR_RESOLVE', 'error:' || coalesce(v_code, 'ALL'), jsonb_build_object('hits', v_hits));
  return v_hits;
end $$;

revoke all on function public.admin_resolve_client_error(text) from public, anon;
grant execute on function public.admin_resolve_client_error(text) to authenticated;

notify pgrst, 'reload schema';

commit;
