# ADR-009: PWA trước, Expo native cho GPS nền

**Bối cảnh.** Tài liệu nhắm iOS/Android. Code hiện là web Next.js, tracking GPS bằng `navigator.geolocation`. Trình duyệt **dừng GPS khi tắt màn hình hoặc chuyển app**, nên không tin cậy được cho một buổi chạy 1–3 giờ. Trên iOS, Web Push chỉ chạy khi PWA đã được cài lên màn hình chính.

**Quyết định.**
- **GĐ 1–2:** PWA (Next.js) cho toàn bộ tính năng. Nguồn bài chạy chính là **Strava/đồng hồ**, còn GPS trong app chỉ là tính năng phụ (giữ màn hình sáng bằng Wake Lock).
- **GĐ 3:** app **Expo (React Native)**. Làm trước màn hình Run/Live (GPS nền, voice coach, nhận cheer, relay handover), HealthKit/Health Connect và push native. Các màn hình còn lại có thể dùng lại qua WebView hoặc viết lại dần.
- Dùng chung: type DB sinh tự động, Zod schema, hàm format, lớp `features/*/api` (đặt trong package `packages/core` khi chuyển sang monorepo Turborepo).

**Hệ quả.** Ra mắt nhanh với PWA mà vẫn có lộ trình tới trải nghiệm chạy chuẩn. API phải có phiên bản (`_v2`) vì app native cập nhật chậm.
