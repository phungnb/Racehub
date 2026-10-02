# Quanh đây v2 + Hội quán runner (migration 012800)

## 1. Vì sao làm lại "Quanh đây"

Runner không cầm điện thoại cả ngày như khi dùng mạng xã hội. Bản 006100 bắt người dùng **tự chọn vị trí, và vị trí tự hết hạn**. Hệ quả: ai không mở app vài ngày thì biến mất khỏi danh sách, và chính họ cũng không thấy ai.

Bản 012800 giữ nguyên các lớp bảo vệ quyền riêng tư cũ và thêm 3 điểm:

| Thay đổi | Cách làm | Bảo vệ riêng tư |
|---|---|---|
| **Khu hay chạy tự động** (tự bật, có đồng ý riêng) | Lấy ô ~2 km (làm tròn 0,02°) có nhiều điểm xuất phát nhất trong các bài hợp lệ 60 ngày. Cần ≥ 2 bài cùng ô. Tự cập nhật khi có bài mới hoặc bài được duyệt. | Chỉ lưu ô, không lưu điểm hay tuyến. Khoảng cách vẫn làm tròn và có nhiễu theo từng cặp người. Tắt là xoá ngay. |
| **Vị trí tạm** (như cũ) | Dùng khi đi công tác hoặc du lịch. Vị trí tạm được ưu tiên hơn khu hay chạy; hết hạn thì tự quay về khu hay chạy. | Đổi tối đa 3 lần / 24 giờ; tìm tối đa 60 lần / giờ. |
| **Bảng tin quanh đây** | Bài chạy đã chia sẻ trong 7 ngày của runner quanh mình (mỗi người tối đa 2 bài) + bài rủ chạy "gần tôi" ở Hội quán. Có nút Kết nối / Nhắn tin. | Chỉ hiện ngày, km, pace và khoảng cách ước chừng. Không hiện giờ, tuyến hay điểm xuất phát. Bài Strava đã tắt "Hiện bài Strava" không xuất hiện. |
| **Bài rủ chạy báo người gần** | Bài "Tìm bạn chạy" / "Pacer" có gắn "gần tôi" báo cho tối đa 30 runner trong 10 km đang bật Quanh đây. | Mỗi người nhận tối đa 3 thông báo loại này / ngày. Phải cho thấy nhau theo cả hai chiều. Người bị chặn không nhận. |

## 2. Hội quán runner (toàn quốc)

Đây là nơi runner mọi miền khoe thành tích, tìm người hợp để chạy cùng, rủ nhau đi giải, tìm pacer và hỏi đáp.

- **Tham gia**: tự bật, đồng ý riêng, cần ≥ 3 bài chạy hợp lệ. Hồ sơ gồm:
  - tỉnh / thành (34 tỉnh sau sáp nhập) và một dòng giới thiệu;
  - mục tiêu, khung giờ, điều đang tìm;
  - pace điển hình (có thể tắt).
- **Thành tích ước tính 12 tháng (5K / 10K / Half / Full)**:
  - lấy các bài dài **≥ cự ly** và quy pace trung bình của bài về đúng cự ly, nên kết quả luôn **chậm hơn hoặc bằng** thực tế;
  - chỉ tính bài hợp lệ **đã chia sẻ**, và bỏ pace nhanh hơn 2:30/km.
- **Số liệu**: km và số buổi trong 30 ngày, km trong năm, bài dài nhất, lần chạy gần nhất.
- **Danh bạ runner**:
  - lọc theo tỉnh, mục tiêu, pace và tên;
  - sắp xếp theo *Hợp với tôi*, *Mới chạy* hoặc *Mới tham gia*;
  - điểm hợp nhau (0–100): pace 30 · cùng tỉnh 15 · mục tiêu 15 · khung giờ 15 · mục đích 10 · chạy đều 10 · ngẫu nhiên theo ngày ≤ 5.
- **Bảng tin**:
  - 5 loại bài: 🏃 Tìm bạn chạy · 🏅 Đi giải cùng (bắt buộc ghi tên giải) · ⏱️ Pacer · 🔥 Khoe thành tích · 💬 Hỏi đáp;
  - lọc theo loại, tỉnh và "gần tôi";
  - bài tự hết hạn sau 14 ngày, hoặc 1 ngày sau ngày hẹn.
- **Quan tâm** một bài: người đăng được báo, và **hai bên nhắn tin được cho nhau** (mở rộng `private.can_dm`). Ngoài ra vẫn có Kết nối và Theo dõi như trước.
- **Chống spam / lừa đảo**:
  - tối đa 5 bài / ngày, 30 lượt quan tâm / ngày;
  - không cho ghi số điện thoại, link, Zalo, Telegram hay Facebook;
  - 3 người báo cáo thì bài tự ẩn. Admin hiện lại bài bằng `admin_set_hub_post`. Báo cáo vào hàng chờ `user_reports` với ngữ cảnh `HUB`.
- **Rời Hội quán**: hồ sơ ẩn ngay và các bài đang mở bị đóng.

## 3. RPC

| RPC | Việc |
|---|---|
| `my_discovery` / `set_discovery` | Thêm các trường `auto_area` (+ `auto_consent`), `hub_listed` (+ `hub_consent`), `province`, `headline`; trả thêm `home` và `located` |
| `nearby_runners` | Dùng vị trí tạm **hoặc** khu hay chạy (của cả hai phía); trả thêm `where` (LIVE / HOME), `last_run_days`, lý do `ACTIVE` |
| `nearby_feed(p)` | Bảng tin quanh đây |
| `nearby_events` / `nearby_clubs` | Dùng được với khu hay chạy |
| `hub_runners(p)` · `my_hub()` | Danh bạ · hồ sơ của tôi |
| `hub_feed(p)` · `create_hub_post(p)` · `close_hub_post(id)` | Bảng tin Hội quán (`p.id` mở thẳng một bài từ thông báo) |
| `toggle_hub_interest(id)` · `hub_interested(id)` | Quan tâm · người đăng xem ai quan tâm |
| `report_hub_post(id, reason)` · `admin_set_hub_post(id, hidden)` | Báo cáo · admin ẩn / hiện |
| `send_connection` | Người đã vào Hội quán kết nối được với nhau mà không cần bật Quanh đây |

Thông báo mới:
- `HUB_NEARBY` — có người rủ chạy gần bạn;
- `HUB_INTEREST` — có người quan tâm bài của bạn.

Cả hai mở `/hub?post=<id>`.

## 4. Giới hạn hiện tại

- Danh bạ Hội quán tính điểm cho mọi hồ sơ rồi mới phân trang. Cách này ổn tới vài nghìn hồ sơ; lớn hơn thì nên lưu sẵn chỉ số (pace, km 30 ngày) theo lịch.
- Khu hay chạy cần bài có toạ độ xuất phát: bài GPS trong app, hoặc bài Strava đã lấy được chi tiết. Bài nhập tay không có toạ độ.
- Bản web **không ghi GPS khi tắt màn hình hoặc chuyển app** (giới hạn của trình duyệt iOS / Android). Màn chạy:
  - hướng dẫn dùng "Khóa màn hình" (màn đen, GPS vẫn chạy);
  - khi quay lại sau ≥ 20 giây, báo rõ đã mất bao lâu.

  App cài từ CH Play / App Store ghi được GPS khi tắt màn hình.
