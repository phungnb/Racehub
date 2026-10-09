-- RaceHub — PHẦN 26/26 (tạo tự động bằng scripts/db-bundle.mjs — KHÔNG sửa tay).
-- Gồm: 003500
-- Supabase → SQL Editor → New query → dán TOÀN BỘ phần này → Run. Lỗi thì không có gì thay đổi; chạy lại vẫn an toàn.
-- PHẦN CUỐI: luôn chạy phần này sau cùng (cập nhật trang Quản trị → Kiểm tra hệ thống).
begin;
-- ===================================================================
-- 20261001003500_system_check.sql
-- ===================================================================
-- 003500: Trang "Kiểm tra hệ thống" cho admin.
-- admin_system_check() dò từng migration đã chạy chưa (qua một đối tượng đặc trưng của file đó),
-- kho ảnh, pg_net / cấu hình push, và dữ liệu bất thường (thử thách / trận CLB quá hạn chưa tất toán,
-- hàng đợi push bị kẹt, bài chờ duyệt). Chỉ đọc, không đổi gì. Chạy lại nhiều lần vẫn an toàn.

create or replace function private.sc_fn(p_schema text, p_name text) returns boolean
language sql stable as $$
  select exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = p_schema and p.proname = p_name)
$$;

create or replace function private.sc_col(p_table text, p_col text) returns boolean
language sql stable as $$
  select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = p_table and column_name = p_col)
$$;

create or replace function public.admin_system_check() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_mig jsonb;
  v_buckets jsonb;
  v_stats jsonb := '{}'::jsonb;
begin
  if not public.is_system_admin() then raise exception 'FORBIDDEN'; end if;

  v_mig := jsonb_build_array(
    jsonb_build_object('file', '20261001000100', 'label', 'Khóa khẩn cấp quyền ghi', 'ok', not has_table_privilege('authenticated', 'public.clubs', 'INSERT')),
    jsonb_build_object('file', '20261001000200', 'label', 'Sổ cái Xu', 'ok', private.sc_fn('private', 'ledger_post')),
    jsonb_build_object('file', '20261001000300', 'label', 'RPC an toàn', 'ok', private.sc_fn('private', 'require_admin')),
    jsonb_build_object('file', '20261001000400', 'label', 'Nhận bài chạy từ Strava', 'ok', private.sc_fn('public', 'ingest_provider_activity')),
    jsonb_build_object('file', '20261001000500', 'label', 'CLB: bảng tin, chat, thông báo', 'ok', private.sc_fn('private', 'notify')),
    jsonb_build_object('file', '20261001000600', 'label', 'Thử thách', 'ok', private.sc_fn('private', 'challenge_apply_activity')),
    jsonb_build_object('file', '20261001000700', 'label', 'Kinh tế Xu + admin', 'ok', private.sc_fn('public', 'economy_policy')),
    jsonb_build_object('file', '20261001000800', 'label', 'Lớp game', 'ok', private.sc_fn('private', 'game_config')),
    jsonb_build_object('file', '20261001000900', 'label', 'Cửa hàng nhân vật', 'ok', private.sc_fn('private', 'character_look')),
    jsonb_build_object('file', '20261001001000', 'label', 'Nhân vật 2D', 'ok', private.sc_col('avatar_items', 'render_kind')),
    jsonb_build_object('file', '20261001001100', 'label', 'Bỏ cột 3D', 'ok', not private.sc_col('avatar_items', 'model_key')),
    jsonb_build_object('file', '20261001001200', 'label', 'Admin vật phẩm', 'ok', private.sc_fn('public', 'admin_save_avatar_item')),
    jsonb_build_object('file', '20261001001300', 'label', 'Bộ mũ / băng đô', 'ok', exists (select 1 from public.avatar_items where code = 'hat_cap_tempo_black')),
    jsonb_build_object('file', '20261001001400', 'label', 'Hồ sơ chi tiết', 'ok', to_regclass('public.profile_details') is not null),
    jsonb_build_object('file', '20261001001500', 'label', 'Sự kiện + quỹ CLB', 'ok', private.sc_fn('private', 'event_json')),
    jsonb_build_object('file', '20261001001600', 'label', 'QR ngân hàng CLB', 'ok', private.sc_col('clubs', 'bank_qr_url')),
    jsonb_build_object('file', '20261001001700', 'label', 'Thông báo đẩy', 'ok', private.sc_fn('private', 'push_kick')),
    jsonb_build_object('file', '20261001001800', 'label', 'Onboarding', 'ok', private.sc_col('profiles', 'onboarded_at')),
    jsonb_build_object('file', '20261001001900', 'label', 'Chi tiết bài chạy', 'ok', to_regclass('public.activity_details') is not null),
    jsonb_build_object('file', '20261001002000', 'label', 'Mục tiêu tự đăng ký', 'ok', private.sc_fn('public', 'set_my_pledge')),
    jsonb_build_object('file', '20261001002100', 'label', 'CLB không giới hạn thành viên', 'ok',
      (select column_default from information_schema.columns where table_schema = 'public' and table_name = 'clubs' and column_name = 'member_limit') = '1000000'),
    jsonb_build_object('file', '20261001002200', 'label', 'Tự chia đội', 'ok', private.sc_col('challenges', 'pledge_team_size')),
    jsonb_build_object('file', '20261001002300', 'label', 'Chống gian lận', 'ok', private.sc_col('activities', 'risk_score')),
    jsonb_build_object('file', '20261001002400', 'label', 'Duyệt bài nghi vấn', 'ok', private.sc_fn('private', 'can_review_activity')),
    jsonb_build_object('file', '20261001002500', 'label', 'Bộ đồ NBNR', 'ok', exists (select 1 from public.avatar_items where code = 'bottom_nbnr_club')),
    jsonb_build_object('file', '20261001002600', 'label', 'CLB đấu CLB', 'ok', private.sc_fn('public', 'create_club_battle')),
    jsonb_build_object('file', '20261001002700', 'label', 'Giải chạy ảo', 'ok', to_regclass('public.virtual_races') is not null),
    jsonb_build_object('file', '20261001002800', 'label', 'CLB Pro', 'ok', private.sc_col('clubs', 'plan')),
    jsonb_build_object('file', '20261001002900', 'label', 'e-BIB + kho ảnh race-media', 'ok', private.sc_col('virtual_races', 'bib_design')),
    jsonb_build_object('file', '20261001003000', 'label', 'BIB: ảnh có sẵn', 'ok', private.sc_fn('private', 'bib_num')),
    jsonb_build_object('file', '20261001003100', 'label', 'Tìm kiếm không dấu', 'ok', private.sc_fn('private', 'search_key')),
    jsonb_build_object('file', '20261001003200', 'label', 'BIB: 3 khung chữ', 'ok', private.sc_fn('private', 'bib_box')),
    jsonb_build_object('file', '20261001003300', 'label', 'Gợi ý tìm kiếm + sửa kho ảnh', 'ok', private.sc_fn('public', 'can_upload_race_media')),
    jsonb_build_object('file', '20261001003400', 'label', 'Chặn lộ mã mời CLB', 'ok', not has_column_privilege('authenticated', 'public.clubs', 'invite_code', 'SELECT')),
    jsonb_build_object('file', '20261001003500', 'label', 'Kiểm tra hệ thống', 'ok', true),
    jsonb_build_object('file', '20261001003600', 'label', 'Thách đấu nhiều CLB', 'ok', to_regclass('public.club_cups') is not null),
    jsonb_build_object('file', '20261001003700', 'label', 'Kinh tế v2 (1 Xu = 100đ)', 'ok', private.sc_fn('private', 'run_xu_for_km')),
    jsonb_build_object('file', '20261001003800', 'label', 'Gói VIP / Pro, đơn hàng', 'ok', to_regclass('public.orders') is not null),
    jsonb_build_object('file', '20261001003900', 'label', 'Quà tặng', 'ok', to_regclass('public.gift_catalog') is not null),
    jsonb_build_object('file', '20261001004000', 'label', 'Phân tích VIP + chỉ số kinh tế', 'ok', to_regprocedure('public.admin_economy_metrics(integer)') is not null),
    jsonb_build_object('file', '20261001004100', 'label', 'Bảo mật + nhật ký không xóa được', 'ok', private.sc_fn('private', 'append_only')),
    jsonb_build_object('file', '20261001004200', 'label', 'Phong độ + chào mừng trở lại', 'ok', to_regprocedure('public.runner_form(uuid)') is not null),
    jsonb_build_object('file', '20261001004300', 'label', 'Nhiệm vụ do admin tạo + khuyến mãi', 'ok', to_regclass('public.promotions') is not null),
    jsonb_build_object('file', '20261001004400', 'label', 'Thông báo hệ thống + nhật ký lỗi', 'ok', to_regprocedure('public.system_notice()') is not null),
    jsonb_build_object('file', '20261001004500', 'label', 'Báo "Bài chạy đã về"', 'ok', private.sc_fn('private', 'run_synced_notify')),
    jsonb_build_object('file', '20261001004600', 'label', 'Nhiệm vụ v2 (bậc, cộng đồng, gợi ý)', 'ok', private.sc_fn('private', 'quest_finish')),
    jsonb_build_object('file', '20261001004700', 'label', 'Ví Tỏa sáng (đổi quà, bậc tỏa sáng)', 'ok', to_regclass('public.shine_shop') is not null),
    jsonb_build_object('file', '20261001004800', 'label', 'Thiết kế BIB theo lớp + giấy chứng nhận', 'ok', private.sc_col('virtual_races', 'cert_design')),
    jsonb_build_object('file', '20261001004900', 'label', 'Vinh danh thử thách (CLB Pro / VIP)', 'ok', to_regclass('public.challenge_honors') is not null),
    jsonb_build_object('file', '20261001005000', 'label', 'Sửa trao quyền Chủ nhiệm CLB', 'ok',
      exists (select 1 from pg_proc where proname = 'transfer_club_ownership' and prosrc like '%CAPTAIN%')),
    jsonb_build_object('file', '20261001005100', 'label', 'Khuyến mãi vật phẩm (Xu)', 'ok', to_regclass('public.item_promotions') is not null),
    jsonb_build_object('file', '20261001005200', 'label', 'Voucher tài trợ (thử thách / nhiệm vụ)', 'ok', to_regclass('public.voucher_campaigns') is not null),
    jsonb_build_object('file', '20261001005300', 'label', 'Chợ Runner (hồ sơ HLV / Shop / Dịch vụ đã xác minh)', 'ok', to_regclass('public.partners') is not null),
    jsonb_build_object('file', '20261001005400', 'label', 'Thể lệ thử thách + danh sách bỏ thử thách đã hủy', 'ok', to_regprocedure('public.set_challenge_rules(uuid, jsonb)') is not null),
    jsonb_build_object('file', '20261001005500', 'label', 'Đăng nhập Google / Apple + mã giới thiệu + xem trước lời mời', 'ok', to_regprocedure('public.my_referral()') is not null),
    jsonb_build_object('file', '20261001005600', 'label', 'Quản trị: việc cần xử lý, người dùng, thử thách, nhật ký', 'ok', to_regprocedure('public.admin_inbox()') is not null),
    jsonb_build_object('file', '20261001005700', 'label', 'Gỡ ràng buộc vai trò CLB cũ (sửa lỗi trao quyền Chủ nhiệm)',
      'ok', not exists (select 1 from pg_constraint where conname = 'club_members_role_check' and conrelid = 'public.club_members'::regclass)),
    jsonb_build_object('file', '20261001005800', 'label', 'Trang phục: bộ sưu tập, vòng đời, điều kiện mở khóa, vùng in, đồng phục CLB',
      'ok', to_regprocedure('public.request_club_uniform(uuid, jsonb)') is not null),
    jsonb_build_object('file', '20261001005900', 'label', 'Bộ đồng phục: áo + quần + tất + giày, họa tiết, mặc cả bộ',
      'ok', to_regprocedure('private.clean_design(jsonb, text)') is not null),
    jsonb_build_object('file', '20261001006000', 'label', 'Bộ sưu tập nhân vật (dáng) + thiết kế in kéo thả, độ đậm màu, ảnh vải',
      'ok', to_regprocedure('private.character_bodies()') is not null))
  -- PostgreSQL giới hạn 100 tham số mỗi hàm → danh sách chia thành nhiều mảng rồi nối lại
  || jsonb_build_array(
    jsonb_build_object('file', '20261001006100', 'label', 'Quanh đây: runner gần bạn (ô ~1 km), kết nối, rủ chạy, buổi chạy công khai, chặn / báo cáo',
      'ok', to_regprocedure('public.nearby_runners(jsonb)') is not null),
    jsonb_build_object('file', '20261001006200', 'label', 'RaceHub Knowledge: kiến thức & tin tức, CMS có duyệt chuyên môn, tiến độ đọc, chuỗi bài → huy hiệu',
      'ok', to_regprocedure('public.knowledge_home()') is not null),
    jsonb_build_object('file', '20261001006300', 'label', 'Quản lý CLB: Tin CLB của ban chủ nhiệm + kho link ảnh CLB (album sự kiện, giải chạy)',
      'ok', to_regprocedure('public.club_albums(uuid, jsonb)') is not null),
    jsonb_build_object('file', '20261001006400', 'label', 'Chợ BIB: nhượng / tìm mua BIB (không cao hơn giá gốc, liên hệ ẩn, báo cáo, admin ẩn tin)',
      'ok', to_regprocedure('public.bib_listings(jsonb)') is not null),
    jsonb_build_object('file', '20261001006500', 'label', 'Chấm bài GPS: phát hiện mất tín hiệu (tắt màn hình) — tuyến nối thẳng phải xác minh',
      'ok', exists (select 1 from pg_proc where proname = 'submit_and_process_activity' and prosrc like '%GPS_GAP%')),
    jsonb_build_object('file', '20261001006600', 'label', 'Quãng đường bài GPS = số app đo (kẹp theo tuyến) + từng km trên máy chủ',
      'ok', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'activity_track_points' and column_name = 'distance_m')),
    jsonb_build_object('file', '20261001006700', 'label', 'Quy định API Strava: bài Strava của người khác chỉ hiện số tổng (ẩn bản đồ, từng km, nhịp tim)',
      'ok', exists (select 1 from pg_proc where proname = 'activity_detail' and prosrc like '%strava_limited%')),
    jsonb_build_object('file', '20261001006800', 'label', 'Xoá tài khoản trong app (Apple 5.1.1(v), Luật BVDLCN 2025): xoá dữ liệu cá nhân + ẩn danh',
      'ok', to_regprocedure('public.delete_my_account(text)') is not null),
    jsonb_build_object('file', '20261001006900', 'label', 'Thông báo / push lỗi không làm hỏng thao tác chính (gán Pro, nhập bài Strava…) + nhật ký lỗi',
      'ok', to_regprocedure('public.admin_notify_errors()') is not null),
    jsonb_build_object('file', '20261001007000', 'label', 'Bài Strava chỉ hiện cho người khác khi runner đồng ý (hướng B+) + công tắc chính sách của admin',
      'ok', to_regprocedure('public.set_strava_sharing(boolean)') is not null),
    jsonb_build_object('file', '20261001007100', 'label', 'Admin hệ thống toàn quyền trong mọi CLB (duyệt, sửa, đăng tin, trao quyền, giải tán)',
      'ok', exists (select 1 from pg_proc where proname = 'club_is_staff' and prosrc like '%is_system_admin%')),
    jsonb_build_object('file', '20261001007200', 'label', 'Hàm gán gói CLB Pro đúng bản chuẩn (sửa lỗi "chỉ quản trị viên…" khi gán Pro)',
      'ok', exists (select 1 from pg_proc where proname = 'admin_set_club_plan' and prosrc like '%log_notify_error(''club_plan''%')),
    jsonb_build_object('file', '20261001007300', 'label', 'Menu Hướng dẫn & Chính sách (trang admin soạn được, đọc khi chưa đăng nhập) + thông tin pháp nhân',
      'ok', to_regprocedure('public.help_menu()') is not null),
    jsonb_build_object('file', '20261001007400', 'label', 'Kết nối Strava = đồng ý hiện bài cho CLB & BXH (bỏ bước hỏi; runner tắt được trong Cài đặt)',
      'ok', exists (select 1 from pg_proc where proname = 'activity_shared' and prosrc like '%strava_share from public.profile_settings s where s.user_id = p_user), true)%')),
    jsonb_build_object('file', '20261001007500', 'label', 'Sửa lỗi "Không tính được phí" khi tạo thử thách / giải cho CLB Pro + báo giá biết gói VIP / Pro',
      'ok', exists (select 1 from pg_proc where proname = 'issue_credits' and prosrc like '%r_credit%')),
    jsonb_build_object('file', '20261001007600', 'label', 'Thử thách tự lặp lại hằng tuần / tháng / quý / năm (tạo kỳ mới như tạo tay: quyền, phí, lượt)',
      'ok', to_regprocedure('public.spawn_recurring_challenges()') is not null),
    jsonb_build_object('file', '20261001007700', 'label', 'Ngày vàng ×1,5 / ×2 / ×3 của CLB (nhân km thử thách CLB + BXH CLB, không nhân XP / Xu)',
      'ok', to_regprocedure('public.club_leaderboard_v2(uuid, text)') is not null),
    jsonb_build_object('file', '20261001007800', 'label', 'Đại sảnh danh vọng CLB + cột mốc km / Half / Full Marathon tự đăng bảng tin',
      'ok', to_regprocedure('public.club_hall_of_fame(uuid)') is not null),
    jsonb_build_object('file', '20261001007900', 'label', 'Cửa hàng CLB: đặt áo / BIB, VietQR vào tài khoản CLB (RaceHub không giữ tiền)',
      'ok', to_regprocedure('public.place_club_order(uuid, jsonb, text)') is not null),
    jsonb_build_object('file', '20261001008000', 'label', 'Trang công khai của CLB Pro (/c/<link-riêng>)',
      'ok', to_regprocedure('public.club_public_page(text)') is not null),
    jsonb_build_object('file', '20261001008100', 'label', 'Tường nhà CLB Pro (ảnh bìa, khẩu hiệu, chủ đề) + thư mời giao lưu CLB',
      'ok', to_regprocedure('public.send_club_exchange(uuid, uuid, jsonb)') is not null and private.sc_col('clubs', 'cover_url')),
    jsonb_build_object('file', '20261001008200', 'label', 'Hạn mức thử thách CLB theo gói (Free / Pro), chặn CLB một người',
      'ok', to_regprocedure('public.club_challenge_quota(uuid, integer)') is not null),
    jsonb_build_object('file', '20261001008300', 'label', 'RaceHub Doanh nghiệp / Liên CLB (tổ chức, chiến dịch, báo cáo, báo giá)',
      'ok', to_regprocedure('public.org_campaign_board(uuid)') is not null),
    jsonb_build_object('file', '20261001008400', 'label', 'Quản lý doanh nghiệp (email công ty, nhập danh sách, đơn vị nhiều cấp, chốt kết quả, chứng nhận, bảng tin) + quay thưởng',
      'ok', to_regprocedure('public.run_lucky_draw(uuid)') is not null and to_regprocedure('public.org_import_members(uuid, jsonb, jsonb)') is not null),
    jsonb_build_object('file', '20261001008500', 'label', 'Chống gian lận chỉ khi thi đấu, CLB miễn phí tối đa 50 thành viên, bảng so sánh gói, Điều khoản / Quyền riêng tư sửa được',
      'ok', to_regprocedure('public.plan_compare()') is not null and private.sc_col('activities', 'review_skipped')),
    jsonb_build_object('file', '20261001008600', 'label', 'Tổ chức demo cho admin / khách dùng thử gói Doanh nghiệp',
      'ok', to_regprocedure('public.admin_create_demo_org(jsonb)') is not null),
    jsonb_build_object('file', '20261001008700', 'label', 'Tổng quan tổ chức: chỉ số, BXH phòng ban / CLB / cá nhân, km theo ngày',
      'ok', to_regprocedure('public.org_overview(uuid, timestamp with time zone, timestamp with time zone)') is not null),
    jsonb_build_object('file', '20261001008800', 'label', 'Chất lượng GPS của bài chạy ghi bằng app + kiểm thử GPS thực địa',
      'ok', to_regprocedure('public.admin_gps_qa_list(integer)') is not null and to_regclass('public.activity_gps_quality') is not null),
    jsonb_build_object('file', '20261001008900', 'label', 'VÁ BẢO MẬT: chặn người ngoài CLB / khách sửa CLB, đổi mã mời, chuyển quyền chủ',
      'ok', not has_function_privilege('anon', 'public.update_club(uuid, text, text, text, text)', 'execute')
            and position('coalesce' in (select p.prosrc from pg_proc p where p.oid = 'public.transfer_ownership(uuid, uuid)'::regprocedure)) > 0),
    jsonb_build_object('file', '20261001009000', 'label', 'Lỗi người dùng gặp: admin đánh dấu đã xử lý',
      'ok', to_regprocedure('public.admin_resolve_client_error(text)') is not null),
    jsonb_build_object('file', '20261001009100', 'label', 'Chính sách vận hành: bật / tắt tính năng, ghi bài chạy, ngưỡng chống gian lận, trang Doanh nghiệp + lịch sử / khôi phục',
      'ok', to_regprocedure('public.admin_publish_ops_policy(jsonb, text)') is not null and to_regprocedure('public.admin_rollback_config(text, integer)') is not null),
    jsonb_build_object('file', '20261001009200', 'label', 'Thẻ gói Miễn phí / CLB Miễn phí / Doanh nghiệp do admin soạn + số quản trị viên CLB miễn phí do admin đặt',
      'ok', to_regprocedure('private.valid_plan_content(jsonb)') is not null and to_regprocedure('private.club_free_captains()') is not null),
    jsonb_build_object('file', '20261001009300', 'label', 'Quay thưởng trên sân khấu: BTC chọn danh sách / loại trừ, quay từng giải, vắng mặt quay lại, mã cam kết',
      'ok', to_regprocedure('public.draw_next(uuid, integer)') is not null and private.sc_col('lucky_draws', 'seed_hash')),
    jsonb_build_object('file', '20261001009400', 'label', 'Điểm CLB: ban quản trị tự đặt luật tính điểm (phiên bản, lịch sử), BXH điểm, điểm từng bài',
      'ok', to_regprocedure('public.save_club_point_rules(uuid, jsonb, text)') is not null and to_regclass('public.club_point_rules') is not null),
    jsonb_build_object('file', '20261001009500', 'label', 'Quay thưởng: người điểm danh tại buổi, danh sách dán, nhà tài trợ',
      'ok', to_regprocedure('public.draw_absent_key(uuid, text)') is not null and private.sc_col('lucky_draws', 'manual_names')),
    jsonb_build_object('file', '20261001009600', 'label', 'Bảng điều khiển ban quản trị CLB + tổng kết tuần / tháng tự động',
      'ok', to_regprocedure('public.club_admin_dashboard(uuid)') is not null and to_regprocedure('public.post_monthly_club_recaps()') is not null),
    jsonb_build_object('file', '20261001009700', 'label', 'VÁ CHỐNG GIAN LẬN: không tự duyệt bài nghi vấn từ mức Trung bình, "chỉ tính phần có GPS", lời báo thân thiện',
      'ok', to_regprocedure('public.accept_verified_distance(uuid)') is not null and private.sc_col('activities', 'review_detail')),
    jsonb_build_object('file', '20261001009800', 'label', 'Chống gian lận cho MỌI bài chạy (không còn tự duyệt khi không thi đấu), lời báo ngắn',
      'ok', coalesce((private.ops_defaults()->'antiCheat'->>'autoApproveMaxScore')::int, -1) = 0),
    jsonb_build_object('file', '20261001009900', 'label', 'Bài chạy trùng giờ (nhiều thiết bị): mỗi thời điểm chỉ tính một bài, bài dài nhất; thu hồi thưởng bài bị thay',
      'ok', to_regprocedure('private.activity_overlap_guard()') is not null
            and exists (select 1 from pg_trigger t where t.tgname = 'trg_ac_activity_overlap' and t.tgrelid = 'public.activities'::regclass)),
    jsonb_build_object('file', '20261001010000', 'label', 'Chống gian lận GPS V1: mất GPS một đoạn vẫn tính đủ km, điểm nhảy không cộng km, chỉ giữ bài có dấu hiệu rõ',
      'ok', (private.ops_defaults()->'antiCheat') ? 'gapReviewPct'),
    jsonb_build_object('file', '20261001010100', 'label', 'Vá sau nghiệm thu: thu hồi quyền ghi thừa trên 9 bảng, chống spam yêu cầu báo giá',
      'ok', not has_table_privilege('anon', 'public.partners', 'insert') and to_regclass('public.org_leads_user_idx') is not null),
    jsonb_build_object('file', '20261001010200', 'label', 'Đổi tên "Giải chạy ảo" thành "Giải chạy" (trang hướng dẫn, bài Kiến thức, thông báo, thẻ gói)',
      'ok', not exists (select 1 from public.help_pages h where h.body ilike '%giải chạy ảo%')),
    jsonb_build_object('file', '20261001010300', 'label', 'Tài khoản bất thường cho admin: hai nơi cùng lúc, chung thiết bị, bài trùng giờ, nuôi lời mời',
      'ok', to_regprocedure('public.admin_account_risks(integer)') is not null and to_regclass('private.device_links') is not null),
    jsonb_build_object('file', '20261001010400', 'label', 'Bình luận có Thích và Trả lời (bảng tin CLB + Doanh nghiệp), thông báo khi được trả lời / thích',
      'ok', to_regprocedure('public.toggle_post_comment_like(uuid)') is not null and to_regprocedure('public.toggle_org_comment_like(uuid)') is not null),
    jsonb_build_object('file', '20261001010500', 'label', 'Thích + quà tặng minh bạch (ai thích, ai tặng), bảng tin cộng đồng, xóa thông báo',
      'ok', to_regprocedure('public.post_engagement(uuid)') is not null and to_regprocedure('public.community_feed(timestamp with time zone,integer)') is not null
            and private.sc_col('club_posts', 'gift_count')),
    jsonb_build_object('file', '20261001010600', 'label', 'Sự kiện chạy nhóm nhiều cự ly, báo cả CLB khi đổi lịch',
      'ok', private.sc_col('club_events', 'routes') and private.sc_fn('private', 'event_routes')),
    jsonb_build_object('file', '20261001010700', 'label', 'Thử thách chinh phục thời gian / pace nhiều hạng mục, hạn đăng ký, BXH theo ngày, ngày vàng riêng',
      'ok', to_regclass('public.challenge_categories') is not null and to_regprocedure('public.challenge_member_days(uuid,uuid)') is not null
            and to_regclass('public.challenge_boost_days') is not null),
    jsonb_build_object('file', '20261001010800', 'label', 'Khóa chống trừ Xu hai lần, ví không bao giờ âm, quản trị viên không nhận Xu, sửa BXH đấu CLB',
      'ok', to_regclass('public.ledger_transactions_idempotency_uidx') is not null and private.sc_fn('private', 'is_admin_account')
            and exists (select 1 from pg_trigger where tgname = 'trg_ledger_no_negative')),
    jsonb_build_object('file', '20261001010900', 'label', 'BXH giải chạy theo cự ly (ai hoàn thành, ai chưa), đổi "mốc" thành "mục tiêu"',
      'ok', to_regprocedure('public.race_results_v2(uuid,numeric)') is not null),
    jsonb_build_object('file', '20261001011000', 'label', 'Kho quà v2: quà tĩnh / quà hiệu ứng động, quà theo mốc (5K…Ultra, PR), 45 quà mới, ảnh riêng',
      'ok', private.sc_col('gift_catalog', 'kind') and to_regprocedure('public.gift_catalog_for(uuid,uuid)') is not null),
    jsonb_build_object('file', '20261001011100', 'label', 'App cửa hàng: ẩn mua bán trong app iOS/Android (công tắc "Cho phép mua trong app"), Zalo / Telegram hỗ trợ',
      'ok', private.ops_defaults()->'features' ? 'nativePurchases' and 'support_zalo' = any (private.site_info_keys())),
    jsonb_build_object('file', '20261001011200', 'label', 'Thử thách bị hủy tự ẩn khỏi bảng tin CLB và trang chủ',
      'ok', exists (select 1 from pg_trigger where tgname = 'trg_hide_cancelled_challenge_posts')),
    jsonb_build_object('file', '20261001011300', 'label', 'Admin cũng là VĐV: nhận Xu chạy bộ / nạp tiền, chặn Xu tự cấp (khuyến mãi, cộng tay, giới thiệu, nhiệm vụ)',
      'ok', private.sc_fn('private', 'admin_credit_allowed')),
    jsonb_build_object('file', '20261001011400', 'label', 'Danh sách quản trị viên hệ thống trong Quản trị → Người dùng',
      'ok', to_regprocedure('public.admin_list_admins()') is not null),
    jsonb_build_object('file', '20261001011500', 'label', 'Theo dõi runner, bảng tin Đang theo dõi, tin nhắn 1-1, sửa bình luận, thông báo hoạt động mới',
      'ok', to_regclass('public.direct_messages') is not null and to_regprocedure('public.following_feed(timestamptz,integer)') is not null
            and to_regprocedure('public.edit_post_comment(uuid,text)') is not null),
    jsonb_build_object('file', '20261001011600', 'label', 'Victory Studio: ảnh vinh danh (thử thách, bài chạy, cột mốc km, Level, huy hiệu), mã xác thực /v/…, BTC vinh danh thành viên',
      'ok', to_regclass('public.victory_certificates') is not null and to_regprocedure('public.issue_victory(text,text,uuid,text,jsonb)') is not null),
    jsonb_build_object('file', '20261001011700', 'label', 'Chỉnh sửa lần 3: thành viên tự đăng ký thách đấu CLB + BXH từng CLB, cảm xúc tin nhắn, runner soạn bài / ebook (duyệt + thưởng Xu), thêm admin theo email',
      'ok', to_regclass('public.club_cup_members') is not null and to_regclass('public.direct_message_reactions') is not null
        and to_regprocedure('public.knowledge_submit(jsonb)') is not null and to_regprocedure('public.admin_find_user_by_email(text)') is not null),
    jsonb_build_object('file', '20261001011800', 'label', 'Chỉnh sửa lần 4: Victory lấy đúng mục tiêu đăng ký, Victory Studio theo gói (VIP / CLB Pro / doanh nghiệp), Quản trị chính + phân quyền admin theo nhóm',
      'ok', to_regclass('public.admin_permissions') is not null and to_regprocedure('public.admin_set_permissions(uuid,text[],timestamptz,text)') is not null
        and to_regprocedure('public.victory_access(text)') is not null and to_regprocedure('private.admin_set_owner(text,boolean)') is not null),
    jsonb_build_object('file', '20261001011900', 'label', 'Vá lộ dữ liệu: khách không đọc được hồ sơ; người khác chỉ thấy tên / ảnh / level; hồ sơ đầy đủ qua my_account()',
      'ok', to_regprocedure('public.my_account()') is not null
        and not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'profiles'
                         and policyname in ('Allow public select profile', 'Public profiles are viewable by everyone'))
        and not has_table_privilege('anon', 'public.profiles', 'SELECT')
        and not has_column_privilege('authenticated', 'public.profiles', 'xu', 'SELECT')),
    jsonb_build_object('file', '20261001012000', 'label', 'Thử thách theo mục tiêu: tham gia bắt buộc kèm mục tiêu (một bước)',
      'ok', to_regprocedure('public.join_challenge_pledge(uuid,numeric,text)') is not null),
    jsonb_build_object('file', '20261001012100', 'label', 'Tăng tốc tab CLB: đếm tin chưa đọc tối đa 100',
      'ok', to_regprocedure('public.my_clubs_inbox()') is not null
        and pg_get_functiondef('public.my_clubs_inbox()'::regprocedure) ~ 'limit 100'),
    jsonb_build_object('file', '20261001012200', 'label', 'Tăng tốc Trang chủ: kiểm tra bù huy hiệu tối đa 1 lần / 10 phút',
      'ok', to_regclass('private.achievement_catchup') is not null and to_regprocedure('private.catch_up_achievements(uuid)') is not null),
    jsonb_build_object('file', '20261001012300', 'label', 'Tăng tốc phân quyền: kiểm tra thành viên CLB trước, quyền admin tính 1 lần / truy vấn',
      'ok', pg_get_functiondef('public.club_is_member(uuid)'::regprocedure) ~* 'case\s+when exists'
        and not exists (select 1 from pg_policies where schemaname = 'public'
                         and (coalesce(qual, '') || ' ' || coalesce(with_check, '')) ~ '(?<!SELECT )(public\.)?is_system_admin\(\)')),
    jsonb_build_object('file', '20261001012400', 'label', 'Chống gian lận Strava: một điểm GPS nhảy không còn làm bài bị chặn',
      'ok', pg_get_functiondef('public.ingest_provider_activity(uuid,text,text,jsonb)'::regprocedure) ~ 'v_risk is null and (not v_no_gps and )?v_max_speed'),
    jsonb_build_object('file', '20261001012500', 'label', 'Chống gian lận: lưu phân tích + lịch sử quyết định, khôi phục bài loại nhầm',
      'ok', to_regclass('public.activity_analyses') is not null and to_regclass('public.activity_decisions') is not null
        and to_regprocedure('public.restore_activity(uuid,text)') is not null and to_regprocedure('public.fraud_review_stats(integer)') is not null),
    jsonb_build_object('file', '20261001012600', 'label', 'Giữ nguyên km của đối tác (Strava…); GPS nhảy chỉ dùng để phân loại',
      'ok', pg_get_functiondef('public.ingest_provider_activity(uuid,text,text,jsonb)'::regprocedure) !~ 'v_clean'),
    jsonb_build_object('file', '20261001012700', 'label', 'Thi đấu CLB v2: luật thi đấu, đăng ký + chốt danh sách, kết quả tạm → chính thức, huy hiệu, điểm uy tín',
      'ok', to_regprocedure('public.create_club_duel(jsonb)') is not null and to_regprocedure('public.club_match_summary(uuid)') is not null
        and to_regclass('public.club_match_ratings') is not null and private.sc_col('club_cups', 'roster_close_at')),
    jsonb_build_object('file', '20261001012800', 'label', 'Quanh đây v2 (khu hay chạy tự động, bảng tin quanh đây) + Hội quán runner + link nhóm Facebook',
      'ok', to_regclass('public.runner_home_area') is not null and to_regclass('public.hub_posts') is not null
        and to_regprocedure('public.hub_runners(jsonb)') is not null and to_regprocedure('public.nearby_feed(jsonb)') is not null
        and 'support_facebook' = any (private.site_info_keys())),
    jsonb_build_object('file', '20261001012900', 'label', 'Trình soạn nội dung (CMS) đăng được Ebook PDF',
      'ok', pg_get_functiondef('public.cms_save(jsonb)'::regprocedure) ~ 'EBOOK_PDF_REQUIRED'),
    jsonb_build_object('file', '20261001013000', 'label', 'Trợ lý vận hành: schema ops (view tổng hợp) + role ops_reader chỉ đọc',
      'ok', to_regclass('ops.tester_activity') is not null and to_regclass('ops.weekly_metrics') is not null
        and to_regclass('ops.attention') is not null and exists (select 1 from pg_roles where rolname = 'ops_reader')),
    jsonb_build_object('file', '20261001013100', 'label', 'Chỉnh sửa lần 6: tương tác ở bảng tin Đang theo dõi, báo bài chờ duyệt + giải trình, vinh danh theo cự ly, sửa thử thách trước khi bắt đầu',
      'ok', to_regprocedure('private.can_engage_post(public.club_posts)') is not null and private.sc_col('activities', 'owner_note')
        and to_regprocedure('public.explain_pending_run(uuid,text)') is not null and to_regprocedure('public.update_challenge(uuid,jsonb)') is not null),
    jsonb_build_object('file', '20261001013200', 'label', 'Sửa đổi ảnh đại diện CLB',
      'ok', pg_get_functiondef('public.update_club(uuid,text,text,text,text)'::regprocedure) !~ 'storage\.objects'),
    jsonb_build_object('file', '20261001013300', 'label', 'Chỉnh sửa lần 7: thử thách sửa toàn bộ trước giờ bắt đầu, tên tuần khi lặp, vinh danh theo mục tiêu, khoá đăng ký chinh phục đã có kết quả',
      'ok', to_regprocedure('private.recur_title(text,text,integer,timestamptz)') is not null
        and pg_get_functiondef('public.set_my_conquest'::regproc) ~ 'CONQUEST_RESULT_LOCKED'),
    jsonb_build_object('file', '20261001013400', 'label', 'Chỉnh sửa lần 7: luật Strava mới (GPS nhảy vẫn ghi nhận, nhập tay không ghi nhận, chạy máy cảnh báo) + danh sách bài có cảnh báo',
      'ok', to_regprocedure('public.warned_activities(uuid,integer)') is not null),
    jsonb_build_object('file', '20261001013500', 'label', 'Chỉnh sửa lần 7: Ban tổ chức chấp nhận / huỷ kết quả quay thưởng',
      'ok', to_regclass('public.lucky_draw_rejections') is not null and to_regprocedure('public.confirm_lucky_draw(uuid)') is not null
        and to_regprocedure('public.reject_lucky_draw(uuid,text)') is not null),
    jsonb_build_object('file', '20261001013600', 'label', 'Nhắc runner 3 ngày chưa chạy',
      'ok', to_regprocedure('public.send_run_reminders()') is not null),
    jsonb_build_object('file', '20261001013700', 'label', 'Bài trùng giờ dài hơn nghi vấn: chờ duyệt, duyệt xong loại bài trùng',
      'ok', pg_get_functiondef('public.review_activity(uuid,text)'::regprocedure) ~ 'rejected_overlaps'),
    jsonb_build_object('file', '20261001013800', 'label', 'Chinh phục cự ly: chạy một bài đủ cự ly là đạt, không cần thời gian / pace',
      'ok', pg_get_constraintdef((select oid from pg_constraint where conname = 'challenges_conquest_mode_chk')) like '%ANY%'),
    jsonb_build_object('file', '20261001013900', 'label', 'Báo giá thử thách chinh phục nhiều người tính theo số chỗ thật (khớp hạn mức gói CLB)',
      'ok', pg_get_functiondef('public.quote_challenge(integer,text,uuid)'::regprocedure) !~ 'SOLO_GOAL'),
    jsonb_build_object('file', '20261001014000', 'label', 'Sửa lỗi lưu gói ở trang admin (UNK-FSZ)',
      'ok', pg_get_functiondef('public.admin_save_plan(jsonb)'::regprocedure) !~ 'jsonb_array_elements\(p->''credits''\) e'),
    jsonb_build_object('file', '20261001014100', 'label', 'Thử thách Công khai do CLB tổ chức (quỹ / lượt gói CLB trả phí)',
      'ok', to_regprocedure('public.quote_challenge(integer,text,uuid,text)') is not null
            and pg_get_functiondef('public.create_challenge_v2(jsonb,text)'::regprocedure) ~ 'v_audience = ''PUBLIC'' and v_club is not null'),
    jsonb_build_object('file', '20261001014200', 'label', 'Sai số cự ly chinh phục do người tạo đặt',
      'ok', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'challenges' and column_name = 'conquest_tolerance_pct')
            and pg_get_functiondef('private.conquest_has_result(uuid,uuid)'::regprocedure) ~ 'conquest_tolerance_pct'),
    jsonb_build_object('file', '20261001014300', 'label', 'Lịch sự kiện CLB tự đăng bài lên bảng tin',
      'ok', to_regprocedure('private.club_event_to_post()') is not null),
    jsonb_build_object('file', '20261001014400', 'label', 'Admin nhắc người mua thanh toán đơn chờ',
      'ok', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'orders' and column_name = 'reminded_at')),
    jsonb_build_object('file', '20261001014500', 'label', 'Admin xóa hàng loạt bài chạy bị loại',
      'ok', to_regprocedure('public.admin_delete_rejected_activities(uuid[])') is not null),
    jsonb_build_object('file', '20261001014600', 'label', 'Admin xem danh sách tài khoản đang khóa',
      'ok', to_regprocedure('public.admin_banned_users()') is not null),
    jsonb_build_object('file', '20261001014700', 'label', 'Xóa tin nhắn kiểu Zalo (thu hồi, xóa phía tôi, xóa cuộc trò chuyện)',
      'ok', to_regprocedure('public.hide_direct_message(uuid)') is not null and to_regprocedure('public.clear_direct_thread(uuid)') is not null),
    jsonb_build_object('file', '20261001014800', 'label', 'Điểm danh sự kiện chỉ trong khung giờ + điểm danh GPS',
      'ok', to_regprocedure('public.gps_checkin_club_event(uuid,double precision,double precision,double precision)') is not null),
    jsonb_build_object('file', '20261001014900', 'label', 'Chinh phục: tham gia bắt buộc có hạng mục (một bước)',
      'ok', to_regprocedure('public.join_challenge_conquest(uuid,jsonb,text)') is not null),
    jsonb_build_object('file', '20261001015000', 'label', 'Admin tự nhập nội dung nhắc thanh toán',
      'ok', to_regprocedure('public.admin_remind_order(uuid,text)') is not null));

  v_buckets := (select coalesce(jsonb_agg(jsonb_build_object('id', b.id, 'ok', s.id is not null,
                   'limit_mb', round(coalesce(s.file_size_limit, 0) / 1048576.0, 1)) order by b.id), '[]'::jsonb)
                  from unnest(array['avatars', 'character-layers', 'club-media', 'race-media', 'uniform-media', 'content-media']) b(id)
                  left join storage.buckets s on s.id = b.id);

  v_stats := jsonb_build_object(
    'pg_net', exists (select 1 from pg_extension where extname = 'pg_net'),
    'push_url', case when to_regclass('private.app_settings') is not null
                     then (select value from private.app_settings where key = 'push_dispatch_url') end,
    'admins', (select count(*) from public.profiles where role = 'SYSTEM_ADMIN'),
    'users', (select count(*) from public.profiles),
    'clubs', (select count(*) from public.clubs));
  if to_regclass('private.push_queue') is not null then
    v_stats := v_stats || jsonb_build_object('push_stuck', (select count(*) from private.push_queue where claimed_at is null and created_at < now() - interval '15 minutes'));
  end if;
  if private.sc_col('challenges', 'end_date') then
    v_stats := v_stats || jsonb_build_object('challenges_overdue', (select count(*) from public.challenges where status = 'ACTIVE' and end_date < now() - interval '1 day'));
  end if;
  if to_regclass('public.club_battles') is not null then
    v_stats := v_stats || jsonb_build_object('battles_overdue', (select count(*) from public.club_battles where status = 'ACCEPTED' and end_at < now() - interval '1 day'));
  end if;
  if to_regclass('public.orders') is not null then
    v_stats := v_stats || jsonb_build_object('orders_pending', (select count(*) from public.orders where status = 'PENDING' and expires_at > now()),
                                             'payment_account', exists (select 1 from private.app_settings where key = 'pay_account_no'));
  end if;
  if to_regclass('public.club_cups') is not null then
    v_stats := v_stats || jsonb_build_object('cups_overdue', (select count(*) from public.club_cups where status = 'OPEN' and end_at < now() - interval '1 day'),
                                             'cups_pending', (select count(*) from public.club_cups where status = 'PENDING_REVIEW'));
  end if;
  if to_regclass('private.client_errors') is not null then
    v_stats := v_stats || jsonb_build_object('client_errors_24h', (select coalesce(sum(hits), 0) from private.client_errors where last_at > now() - interval '24 hours'),
                                             'not_deployed_24h', (select coalesce(sum(hits), 0) from private.client_errors where kind = 'NOT_DEPLOYED' and last_at > now() - interval '24 hours'));
  end if;
  if private.sc_col('activities', 'validation_status') then
    v_stats := v_stats || jsonb_build_object('pending_reviews', (select count(*) from public.activities where validation_status = 'PENDING'));
  end if;

  return jsonb_build_object('migrations', v_mig, 'buckets', v_buckets, 'stats', v_stats, 'checked_at', now());
end $$;

revoke all on function private.sc_fn(text, text), private.sc_col(text, text) from public, anon, authenticated;
revoke all on function public.admin_system_check() from public, anon;
grant execute on function public.admin_system_check() to authenticated;

notify pgrst, 'reload schema';

commit;
