-- RaceHub — PHẦN 14/14 (tạo tự động bằng scripts/db-bundle.mjs — KHÔNG sửa tay).
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
      'ok', to_regprocedure('private.character_bodies()') is not null),
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
      'ok', to_regprocedure('public.plan_compare()') is not null and private.sc_col('activities', 'review_skipped')));

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
