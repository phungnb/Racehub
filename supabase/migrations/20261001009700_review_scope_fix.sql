-- 009700: CHỐNG GIAN LẬN NGOÀI THỬ THÁCH — sửa lỗ hổng "tự duyệt mọi bài nghi vấn" (008500).
-- Trước: người không thi đấu → MỌI bài nghi vấn (kể cả giống đi xe, mất GPS gần hết quãng) được tự duyệt, vẫn cộng Xu, XP, BXH CLB.
--   Ví dụ thật: 3,01 km trong đó 2,99 km là đoạn mất tín hiệu được nối thẳng (đi xe máy lúc tắt màn hình) → vẫn được +2 Xu, +30 XP.
-- Sau:
--   • Chỉ tự duyệt bài nghi vấn MỨC THẤP (điểm rủi ro ≤ antiCheat.autoApproveMaxScore, mặc định 34 — admin chỉnh ở Chính sách vận hành).
--     Từ mức Trung bình trở lên: chờ xác minh, chưa cộng Xu / XP / BXH / điểm CLB — dù có thi đấu hay không.
--   • Bài mất tín hiệu GPS: người chạy tự chọn "Chỉ tính phần có GPS" → bỏ quãng nối thẳng, được duyệt ngay với phần đã kiểm chứng.
--   • Lời báo cho người chạy viết lại gọn, không lộ ngưỡng phát hiện; chi tiết kỹ thuật giữ ở review_detail cho người duyệt.
-- Cần 008500, 009100, 009200. Chạy được trong SQL Editor: không DO $$, không SELECT INTO, không LIMIT, không RETURNING INTO. Chạy lại an toàn.

alter table public.activities add column if not exists review_detail text;

-- ---------------------------------------------------------------------
-- 1. Ngưỡng tự duyệt do admin đặt (thêm vào nhóm antiCheat của chính sách vận hành)
-- ---------------------------------------------------------------------
create or replace function private.ops_defaults() returns jsonb
language sql immutable set search_path = public as $$
  select jsonb_build_object(
    'features', jsonb_build_object('nearby', true, 'market', true, 'bibMarket', true, 'knowledge', true, 'races', true, 'cups', true, 'orgs', true),
    'tracking', jsonb_build_object('autoPauseAfterS', 10, 'longStopAskMin', 10, 'longStopAutoStopMin', 30, 'trimTailMin', 2),
    'antiCheat', jsonb_build_object('dailyRunLimit', 20, 'minPaceMin', 3, 'vehicleKmh', 25, 'vehicleS', 30, 'severeKmh', 20, 'severeS', 120,
                                    'highKmh', 17, 'highS', 180, 'spikeKmh', 43, 'spikeMax', 3, 'autoApproveMaxScore', 34),
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


-- ---------------------------------------------------------------------
-- 2. Lời báo cho người chạy (không lộ ngưỡng) theo dấu hiệu
-- ---------------------------------------------------------------------
create or replace function private.friendly_review(p_flags jsonb, p_reason text) returns text
language sql immutable as $$
  select case
    when exists (select 1 from jsonb_array_elements(case when jsonb_typeof(p_flags) = 'array' then p_flags else '[]'::jsonb end) f
                  where f->>'code' in ('VEHICLE_BURST', 'SUSTAINED_SPEED', 'STRIDE', 'HR_PACE', 'GPS_TELEPORT'))
         or coalesce(p_reason, '') ~ '(Pace trung bình nhanh|giống đi xe|Giữ tốc độ|nhảy xa)'
      then 'Một số đoạn trong bài có tốc độ khác với chạy bộ nên cần được xác minh trước khi cộng thành tích.'
    when exists (select 1 from jsonb_array_elements(case when jsonb_typeof(p_flags) = 'array' then p_flags else '[]'::jsonb end) f where f->>'code' = 'GPS_GAP')
         or coalesce(p_reason, '') ~ 'Mất tín hiệu GPS'
      then 'Một đoạn dài bị mất tín hiệu GPS nên chưa xác nhận được quãng đường. Bạn có thể chọn chỉ tính phần có GPS, hoặc chờ xác minh.'
    when coalesce(p_reason, '') ~ 'không có dữ liệu GPS'
      then 'Bài chạy không có dữ liệu vị trí nên cần được xác minh.'
    when coalesce(p_reason, '') ~ 'lệch nhiều'
      then 'Quãng đường chưa khớp với tuyến GPS nên cần được xác minh.'
    else 'Bài chạy cần được xác minh trước khi cộng thành tích.' end
$$;

-- ---------------------------------------------------------------------
-- 3. Trigger trước khi lưu bài: chỉ tự duyệt mức thấp khi không thi đấu; viết lại lời báo
-- ---------------------------------------------------------------------
create or replace function private.activity_review_scope() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.validation_status = 'PENDING' and not coalesce(new.is_manual, false) and new.user_id is not null and new.started_at is not null then
    new.review_detail := coalesce(new.review_detail, new.validation_reason);
    if coalesce(new.risk_score, 0) <= coalesce((private.ops_config()->'antiCheat'->>'autoApproveMaxScore')::numeric, 34)
       and not private.in_competition(new.user_id, new.started_at) then
      new.validation_status := 'APPROVED';
      if new.status = 'PROCESSING' then new.status := 'READY'; end if;
      new.review_skipped := true;
      new.validation_reason := null;
    else
      new.validation_reason := private.friendly_review(new.risk_flags, new.validation_reason);
    end if;
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------
-- 4. Người chạy: xem lựa chọn + "Chỉ tính phần có GPS"
-- ---------------------------------------------------------------------
create or replace function private.gap_meters(p_flags jsonb) returns numeric
language sql immutable as $$
  select coalesce(sum((f->>'meters')::numeric), 0) from jsonb_array_elements(case when jsonb_typeof(p_flags) = 'array' then p_flags else '[]'::jsonb end) f
   where f->>'code' = 'GPS_GAP'
$$;
create or replace function private.gap_seconds(p_flags jsonb) returns numeric
language sql immutable as $$
  select coalesce(sum((f->>'durationS')::numeric), 0) from jsonb_array_elements(case when jsonb_typeof(p_flags) = 'array' then p_flags else '[]'::jsonb end) f
   where f->>'code' = 'GPS_GAP'
$$;

/** Chỉ được "tính phần có GPS" khi lý do duy nhất là mất tín hiệu (không có dấu hiệu tốc độ bất thường) */
create or replace function private.can_accept_verified(a public.activities) returns boolean
language sql stable security definer set search_path = public as $$
  select a.validation_status = 'PENDING' and coalesce(a.status, '') <> 'DELETED'
     and private.gap_meters(a.risk_flags) > 0 and coalesce(a.risk_score, 0) < 65
     and not exists (select 1 from jsonb_array_elements(case when jsonb_typeof(a.risk_flags) = 'array' then a.risk_flags else '[]'::jsonb end) f
                      where f->>'code' <> 'GPS_GAP' and f->>'severity' in ('HIGH', 'SEVERE'))
$$;

create or replace function public.activity_review_info(p_activity uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare a public.activities := (select x from public.activities x where x.id = p_activity);
begin
  if a.id is null or a.user_id is distinct from auth.uid() then raise exception 'FORBIDDEN'; end if;
  return jsonb_build_object('status', a.validation_status, 'reason', a.validation_reason,
    'can_accept_verified', private.can_accept_verified(a),
    'gap_distance_m', round(private.gap_meters(a.risk_flags)),
    'verified_distance_m', greatest(round(coalesce(a.distance_m, 0) - private.gap_meters(a.risk_flags)), 0));
end $$;

create or replace function public.accept_verified_distance(p_activity uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  a public.activities := (select x from public.activities x where x.id = p_activity for update);
  v_gap numeric;
  v_dist numeric;
  v_moving integer;
begin
  if a.id is null or a.user_id <> v_uid then raise exception 'FORBIDDEN'; end if;
  if not private.can_accept_verified(a) then raise exception 'NOT_ELIGIBLE'; end if;
  v_gap := private.gap_meters(a.risk_flags);
  v_dist := greatest(round(coalesce(a.distance_m, 0) - v_gap), 0);
  v_moving := greatest(coalesce(a.moving_time_s, 0) - round(private.gap_seconds(a.risk_flags))::int, 0);
  if v_dist < 200 then
    update public.activities set validation_status = 'REJECTED', status = 'REJECTED', updated_at = now(),
           review_detail = coalesce(review_detail, validation_reason),
           validation_reason = 'Quãng đường có GPS dưới 200 m.'
     where id = a.id;
  else
    update public.activities set distance_m = v_dist, moving_distance_m = v_dist, moving_time_s = v_moving,
           avg_pace_s = case when v_moving > 0 then round(v_moving / (v_dist / 1000.0)) else avg_pace_s end,
           review_detail = coalesce(review_detail, validation_reason),
           validation_reason = 'Chỉ tính phần có GPS.',
           validation_status = 'APPROVED', status = 'READY', updated_at = now()
     where id = a.id;                                   -- APPROVED → trigger thưởng Xu / XP như khi duyệt
  end if;
  return (select jsonb_build_object('status', x.validation_status, 'reason', x.validation_reason, 'distance_m', x.distance_m,
                                    'earned_xu', coalesce(x.earned_xu, 0), 'earned_xp', coalesce(x.earned_xp, 0))
            from public.activities x where x.id = a.id);
end $$;

-- ---------------------------------------------------------------------
-- 5. Người duyệt thấy chi tiết kỹ thuật
-- ---------------------------------------------------------------------
create or replace function public.club_pending_activities(p_club_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.club_is_staff(p_club_id) and not public.is_system_admin() then raise exception 'FORBIDDEN'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object(
      'id', a.id, 'title', a.title, 'distance_m', a.distance_m, 'moving_time_s', a.moving_time_s,
      'started_at', a.started_at, 'created_at', a.created_at, 'source', a.source,
      'validation_reason', coalesce(a.review_detail, a.validation_reason), 'risk_score', a.risk_score, 'risk_level', a.risk_level, 'risk_flags', a.risk_flags,
      'user_id', a.user_id, 'can_review', a.user_id <> auth.uid(),
      'profiles', jsonb_build_object('display_name', pr.display_name, 'avatar_url', pr.avatar_url))
      order by a.created_at desc), '[]'::jsonb)
    from public.activities a
    join public.club_members m on m.user_id = a.user_id and m.club_id = p_club_id and m.status = 'APPROVED'
    join public.profiles pr on pr.id = a.user_id
   where a.validation_status = 'PENDING' and coalesce(a.status, '') <> 'DELETED'
     and (a.shared or public.is_system_admin()));
end $$;

revoke all on function private.friendly_review(jsonb, text), private.gap_meters(jsonb), private.gap_seconds(jsonb),
  private.can_accept_verified(public.activities), private.activity_review_scope() from public, anon, authenticated;
revoke all on function public.activity_review_info(uuid), public.accept_verified_distance(uuid), public.club_pending_activities(uuid) from public, anon;
grant execute on function public.activity_review_info(uuid), public.accept_verified_distance(uuid), public.club_pending_activities(uuid) to authenticated;

notify pgrst, 'reload schema';
