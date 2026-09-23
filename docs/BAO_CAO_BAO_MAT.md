# Báo cáo bảo mật database RaceHub

*Ngày kiểm tra: 23/09/2026 · Nguồn: `supabase/remote_schema.sql` (dump từ production) · Kiểm chứng: `tests/db/security.test.ts`*

Mọi lỗ hổng dưới đây đã được **tái hiện bằng test tự động trên đúng schema production**. Tất cả đều bị chặn sau khi chạy migration `20261001000100` đến `20261001000300`.

## Mức NGHIÊM TRỌNG: mất kiểm soát tiền ảo và quyền quản trị

| # | Lỗ hổng | Cách khai thác | Hệ quả |
|---|---|---|---|
| 1 | `user_topup_xu` không kiểm tra quyền, được cấp cho `anon` | Gọi `/rpc/user_topup_xu` với số Xu tùy ý, **không cần đăng nhập** | Tạo Xu vô hạn cho bất kỳ tài khoản nào |
| 2 | `execute_ledger_transaction` được cấp cho `anon` | Tự ghi bút toán chuyển Xu từ tài khoản hệ thống về ví mình | Tạo Xu vô hạn |
| 3 | `admin_adjust_user_xu`, `admin_topup_club_fund` kiểm tra quyền bằng tham số `p_admin_id` do client gửi | Truyền UUID của admin (đọc công khai được từ bảng `profiles`) | Tự cộng Xu cho mình / cho CLB |
| 4 | Policy *"Users can update own profile"* cho sửa mọi cột | `update profiles set role='SYSTEM_ADMIN', is_admin=true, xu=…` | Tự phong admin, tự đặt số Xu |
| 5 | `create_challenge_with_fee` nhận `p_fee` và `p_user_id` từ client | `p_fee = -100000` | **Được cộng** Xu khi tạo thử thách; hoặc trừ Xu của người khác |
| 6 | `submit_and_process_activity`, `create_challenge_with_ledger` nhận `p_user_id` | Truyền id người khác | Ghi bài chạy / trừ phí trên tài khoản người khác |
| 7 | Policy SELECT công khai trên `profiles` gồm cả `strava_access_token`, `strava_refresh_token` | `select strava_access_token from profiles` (không cần đăng nhập) | Chiếm quyền truy cập Strava của mọi người dùng đã kết nối |

## Mức CAO: gian lận phần thưởng

| # | Lỗ hổng | Hệ quả |
|---|---|---|
| 8 | Policy INSERT/UPDATE `activities` cho chính chủ + trigger `trg_auto_reward` cộng Xu khi `validation_status IS NULL` | Tự chèn bài chạy 10.000 km → được cộng Xu; tự đổi trạng thái bài bị từ chối thành APPROVED |
| 9 | Policy *"User manage own inventory / equipment / badges / titles"* cho mọi thao tác | Tự thêm vật phẩm hiếm, huy hiệu |
| 10 | `clubs` INSERT `with check (true)` (kể cả `anon`); `clubs_update_staff` cho sửa mọi cột | Tạo CLB với quỹ tùy ý; chủ nhiệm tự đổi `treasury_balance` |
| 11 | `challenges` INSERT cho mọi user | Tạo thử thách không mất phí |
| 12 | `user_avatar` UPDATE mọi cột | Tự sửa `coins`, `level`, `xp` |

## Lỗi chức năng phát hiện kèm theo (đã sửa)

| Hàm | Lỗi | Hệ quả trước khi sửa |
|---|---|---|
| `submit_and_process_activity` | Tham chiếu `challenges.start_at`, nhưng cột thật tên là `start_date` | **Mọi bài chạy GPS hợp lệ đều lỗi khi lưu** |
| `review_activity` | Đọc `profiles.club_id`, nhưng cột này không tồn tại | Admin không duyệt được bài nào |
| `apply_referral` | Ghi vào bảng `activity_history`, nhưng bảng này không tồn tại | Link giới thiệu luôn lỗi |
| Trang Admin → lưu cấu hình | `upsert` theo `config_key`, trong khi khóa duy nhất là `(config_key, version)` | Không lưu được cấu hình kinh tế |
| Số dư Xu | Thưởng chạy chỉ cộng vào `profiles.xu`, còn phí thử thách kiểm tra theo sổ cái | Người kiếm Xu bằng cách chạy không trả được phí tạo thử thách |
| Cấp độ | `level = XP/500 + 1`, không giới hạn | Sai với tài liệu (5 cấp) |

## Khuyến nghị sau khi vá

1. **Rà soát sổ cái:** kiểm tra các giao dịch `IAP_TOPUP_VND`, `ADMIN_ADJUST`, `CLUB_FUND_TOPUP` trong `ledger_transactions` xem có giao dịch lạ không. Nếu có, admin dùng `admin_adjust_user_xu` với số âm để thu hồi.
   ```sql
   select t.created_at, t.type, t.created_by, e.account_id, e.amount
     from ledger_transactions t join ledger_entries e on e.transaction_id = t.id
    where t.type in ('IAP_TOPUP_VND','ADMIN_ADJUST','CLUB_FUND_TOPUP')
    order by t.created_at desc;
   ```
2. **Kiểm tra ai đang là admin:** `select id, display_name from profiles where role = 'SYSTEM_ADMIN' or is_admin;`
3. **Thu hồi token Strava đã bị lộ:** vào strava.com/settings/api → *Revoke access* rồi tạo lại Client Secret. Người dùng kết nối lại Strava một lần.
4. **Không sửa policy/hàm trực tiếp trên Dashboard nữa.** Mọi thay đổi viết thành migration, kèm test trong `tests/db/`.
