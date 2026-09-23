# ADR-006: Tích hợp thiết bị — Strava webhook trước, bảo mật OAuth

**Bối cảnh.** FR3 ưu tiên đồng hồ Garmin/Coros/Apple Watch, với hai đường: qua Strava hoặc sync trực tiếp. Code hiện tại: `state = user_id` (bị giả mạo được), token lưu ở `profiles`, fallback sang anon key, client ID hard-code, `syncActivities.ts` dùng dữ liệu giả.

**Quyết định.**
1. **GĐ 1–2: Strava là cổng chính** (Garmin, Coros, Apple Watch đều sync sang Strava). Dùng **Strava Webhook Events API** thay cho polling. Khi mới kết nối, backfill 30 ngày.
2. OAuth: route `/api/connect/strava` tạo `nonce` ngẫu nhiên lưu trong `private.oauth_states` (gắn `user_id` của phiên, hết hạn 10 phút). Callback kiểm tra nonce **và** phiên hiện tại. Nonce dùng một lần.
3. Token lưu trong `private.provider_connections`, chỉ service role đọc được. Client chỉ thấy view `my_connections`.
4. Biến môi trường được validate bằng Zod khi khởi động. Thiếu `SUPABASE_SERVICE_ROLE_KEY` hoặc `STRAVA_CLIENT_SECRET` thì **báo lỗi rõ ràng**, không fallback.
5. **GĐ 3:** Garmin Health API và Coros API (cần đăng ký đối tác), cùng HealthKit / Health Connect trên app native. Tất cả chuẩn hóa về cùng một hàm `ingest_activity`.

**Hệ quả.** Lưu ý điều khoản API Strava: không hiển thị dữ liệu của người dùng Strava cho người khác quá mức cho phép, phải có logo "Powered by Strava", và xử lý webhook `deauthorize`. Cần đọc kỹ chính sách hiện hành của Strava trước khi ra mắt công khai.
