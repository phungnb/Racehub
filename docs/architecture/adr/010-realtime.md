# ADR-010: Realtime — Broadcast cho dữ liệu tạm, postgres_changes cho dữ liệu lưu

**Bối cảnh.** Có nhiều nhu cầu realtime: vị trí người đang chạy (5–10 giây/lần), hiệu ứng cheer, bàn giao tiếp sức, con mồi trong cuộc săn, BXH thử thách, chat, chuông thông báo.

**Quyết định.**
- **Broadcast** (không ghi DB) cho dữ liệu tần suất cao và tạm thời: vị trí GPS live, hiệu ứng cheer, "đến lượt bạn". DB chỉ lưu thưa (60 giây) để hậu kiểm.
- **postgres_changes** cho dữ liệu đã lưu và thay đổi chậm: `challenge_participants` (BXH), `messages`, `notifications`.
- **Presence** để hiển thị số người đang xem hoặc cổ vũ.
- Mọi channel riêng tư bật **Realtime Authorization** (policy trên `realtime.messages`).
- Client hủy subscribe khi rời màn hình. Không subscribe cả bảng mà không có filter.

**Hệ quả.** Giảm tải ghi DB và giữ chi phí Realtime trong hạn mức. BXH toàn cầu **không** realtime (refresh 5 phút) để tránh bão sự kiện.
