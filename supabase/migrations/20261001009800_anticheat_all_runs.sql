-- 009800: CHỐNG GIAN LẬN CHO MỌI BÀI CHẠY — bỏ hẳn ngoại lệ "không thi đấu thì tự duyệt" (008500 / 009700).
-- Bài chạy nào cũng được cộng Xu / XP, nên bài nào cũng phải qua cùng một bộ kiểm tra, có thi đấu hay không:
--   • Bài có dấu hiệu nghi vấn → chờ xác minh, chưa cộng Xu / XP / BXH / điểm CLB, cho tới khi được duyệt.
--   • antiCheat.autoApproveMaxScore mặc định 0 (không tự duyệt bài nghi vấn nào). Admin có thể nâng nếu muốn nới —
--     áp như nhau cho mọi người, không còn phụ thuộc có tham gia thử thách hay không.
--   • Lời báo cho người chạy rút còn một câu ngắn, trung tính.
-- Cần 009700. Chạy được trong SQL Editor: không DO $$, không SELECT INTO, không LIMIT, không RETURNING INTO. Chạy lại an toàn.

create or replace function private.ops_defaults() returns jsonb
language sql immutable set search_path = public as $$
  select jsonb_build_object(
    'features', jsonb_build_object('nearby', true, 'market', true, 'bibMarket', true, 'knowledge', true, 'races', true, 'cups', true, 'orgs', true),
    'tracking', jsonb_build_object('autoPauseAfterS', 10, 'longStopAskMin', 10, 'longStopAutoStopMin', 30, 'trimTailMin', 2),
    'antiCheat', jsonb_build_object('dailyRunLimit', 20, 'minPaceMin', 3, 'vehicleKmh', 25, 'vehicleS', 30, 'severeKmh', 20, 'severeS', 120,
                                    'highKmh', 17, 'highS', 180, 'spikeKmh', 43, 'spikeMax', 3, 'autoApproveMaxScore', 0),
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


create or replace function private.activity_review_scope() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.validation_status = 'PENDING' and not coalesce(new.is_manual, false) and new.user_id is not null and new.started_at is not null then
    new.review_detail := coalesce(new.review_detail, new.validation_reason);
    if coalesce(new.risk_score, 0) <= coalesce((private.ops_config()->'antiCheat'->>'autoApproveMaxScore')::numeric, 0) and coalesce(new.risk_score, 0) > 0 then
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

-- Lời báo ngắn cho người chạy
create or replace function private.friendly_review(p_flags jsonb, p_reason text) returns text
language sql immutable as $$
  select case
    when exists (select 1 from jsonb_array_elements(case when jsonb_typeof(p_flags) = 'array' then p_flags else '[]'::jsonb end) f
                  where f->>'code' in ('VEHICLE_BURST', 'SUSTAINED_SPEED', 'STRIDE', 'HR_PACE', 'GPS_TELEPORT'))
         or coalesce(p_reason, '') ~ '(Pace trung bình nhanh|giống đi xe|Giữ tốc độ|nhảy xa)'
      then 'Tốc độ có đoạn bất thường.'
    when exists (select 1 from jsonb_array_elements(case when jsonb_typeof(p_flags) = 'array' then p_flags else '[]'::jsonb end) f where f->>'code' = 'GPS_GAP')
         or coalesce(p_reason, '') ~ 'Mất tín hiệu GPS'
      then 'Mất tín hiệu GPS một đoạn.'
    when coalesce(p_reason, '') ~ 'không có dữ liệu GPS' then 'Thiếu dữ liệu GPS.'
    when coalesce(p_reason, '') ~ 'lệch nhiều' then 'Quãng đường chưa khớp tuyến GPS.'
    else null end
$$;

-- Điều khoản / trang menu: câu chữ theo chính sách mới (chỉ khi admin chưa tự sửa trang)
update public.help_pages
   set body = replace(replace(replace(body,
         '- Bài chạy thường ngày được **ghi nhận tự động**. Khi bạn **tham gia thử thách, giải chạy hoặc chiến dịch**, bài có dấu hiệu bất thường sẽ chờ Ban tổ chức / ban quản trị CLB duyệt, có thể bị từ chối và phần thưởng liên quan có thể bị thu hồi.',
         '- Mọi bài chạy đều được hệ thống kiểm tra. Bài có dấu hiệu bất thường sẽ chờ xác minh trước khi cộng Xu, XP và thành tích, có thể bị từ chối và phần thưởng liên quan có thể bị thu hồi.'),
         E'- Bài có dấu hiệu bất thường được tự duyệt lúc bạn không thi đấu thì không được tính vào thử thách / giải về sau.\n', ''),
         'Chống gian lận trong thử thách, giải chạy và chiến dịch', 'Chống gian lận cho mọi bài chạy')
 where updated_by is null and (body like '%ghi nhận tự động%' or body like '%Chống gian lận trong thử thách%');

revoke all on function private.ops_defaults(), private.activity_review_scope(), private.friendly_review(jsonb, text) from public, anon, authenticated;

notify pgrst, 'reload schema';
