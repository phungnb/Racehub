# ADR-018: Trợ lý vận hành cho chủ dự án (ngoài app)

**Trạng thái.** Đề xuất, chờ Phụng duyệt. Chưa có code.

**Bối cảnh.**
- RaceHub chưa phát hành. Tài khoản Google Play cá nhân bắt buộc kiểm thử kín ≥ 12 tester trong 14 ngày trước khi lên Production ([APP_MOBILE.md](../../APP_MOBILE.md)). Tester bỏ giữa chừng thì phải chạy lại, làm lùi ngày lên store.
- Quỹ thời gian là 4 giờ/tuần trước phát hành. Việc theo dõi tester, đọc số liệu và soạn bài đăng hiện làm tay.
- App đã tự động hóa phần lớn việc nhắc trong CLB: tổng kết tuần/tháng, thử thách lặp, chốt kết quả, nhắc đóng phí (`vercel.json`, `app/api/cron/*`). Việc còn làm tay là việc của **chủ dự án**, không phải của admin CLB.
- Đưa AI tạo nội dung vào app sẽ chịu chính sách "AI-Generated Content" của Google Play (phải có chức năng báo cáo nội dung AI), nên thêm một hạng mục bị soát lúc nộp duyệt.

**Các phương án đã xét.**
1. Thêm cron nhắc việc theo luật trong app, không dùng AI. Xếp vào backlog sau phát hành.
2. Trong app, AI soạn nháp và admin duyệt trước khi đăng. Xếp vào backlog sau phát hành, ước tính 20–30 giờ.
3. Trợ lý vận hành chạy ngoài app, chỉ đọc dữ liệu và chỉ soạn nháp. **Đây là phương án được chọn.**

**Quyết định.**

1. **Hình thức:** dùng một Routine Claude Code (tác vụ hẹn giờ trên claude.ai). Mỗi lần chạy mở một phiên mới. Không thêm code chạy trong app và không thêm API key AI vào Vercel.
2. **Lịch chạy:**
   - Trong đợt kiểm thử kín: 07:45 giờ VN mỗi ngày.
   - Sau đợt đó: 07:45 sáng thứ Hai hằng tuần.
3. **Nguồn dữ liệu chỉ-đọc:**
   - Tạo role Postgres `ops_reader` chỉ có quyền `SELECT` trên schema `ops`. Role này không đọc được `public`, `private` hay `auth`.
   - Schema `ops` chỉ gồm view tổng hợp:
     - `ops.tester_activity`: mỗi tester gồm email, ngày tham gia, lần mở app gần nhất, bài chạy gần nhất.
     - `ops.weekly_metrics`: số người dùng mới, số người hoạt động, bài chạy, thử thách, CLB.
     - `ops.attention`: thử thách sắp hết hạn chưa có người, CLB không hoạt động ≥ 14 ngày, báo cáo vi phạm chưa xử lý.
   - Danh sách tester nằm ở bảng `ops.testers`. Phụng tự nhập email tester (trùng với danh sách trong Play Console).
   - Chuỗi kết nối được lưu làm biến môi trường `RACEHUB_OPS_DB_URL` trong cài đặt môi trường của project. Không đưa vào repo, không dán vào chat.
4. **Đầu ra (chỉ soạn nháp, không tự gửi):**
   - Báo cáo ngắn: tester nào đã ≥ 2 ngày không mở app, số liệu tuần, các mục cần xử lý.
   - Tin nhắc tester soạn sẵn theo từng người, để Phụng tự gửi qua Zalo/Messenger.
   - Một bài đăng fanpage/nhóm chạy bộ dựa trên số liệu thật trong tuần.
   - Báo cáo được gửi về điện thoại/email của Phụng qua thông báo của Routine, và lưu lại lịch sử để so sánh giữa các tuần.
5. **Ranh giới cứng:**
   - Trợ lý không ghi vào DB, không gửi tin cho người dùng, không đăng bài.
   - Mọi số liệu trong bài đăng phải lấy từ view, không được ước đoán.

**Hệ quả.**
- Chi phí AI nằm trong gói Claude hiện có, không phát sinh hóa đơn API riêng. Đây là giả định, cần kiểm lại theo gói đang dùng.
- Công sức ước tính khoảng 2,5 giờ: migration cho schema `ops` và role (1 giờ), prompt Routine (0,5 giờ), chạy thử và chỉnh (1 giờ).
- Rủi ro lớn nhất là lộ chuỗi kết nối DB. Cách giảm thiểu:
  - Role chỉ đọc view tổng hợp.
  - Mật khẩu riêng, đổi được ngay mà không ảnh hưởng app.
  - Có thể giới hạn IP nếu Supabase hỗ trợ trên gói hiện tại (cần kiểm tra).
- Sau phát hành, nếu admin CLB cần trợ lý trong app thì viết ADR mới cho phương án 1 hoặc 2. Phần view `ops` có thể dùng lại.
