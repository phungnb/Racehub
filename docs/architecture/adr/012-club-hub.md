# ADR-012: CLB là một không gian riêng ("app trong app")

**Trạng thái.** Đề xuất. Bổ sung cho ADR-008 (feed) và ADR-010 (realtime).

**Bối cảnh.** Các CLB chạy bộ Việt Nam hiện quản lý bằng nhiều công cụ rời rạc. Họ nói chuyện trong nhóm Zalo, ghi km trong Google Sheet hoặc ảnh chụp Strava, điểm danh bằng cách "thả tim", thu quỹ bằng chuyển khoản rồi ghi sổ tay. RaceHub muốn thay toàn bộ các công cụ này ([Định hướng §5](../../DINH_HUONG_SAN_PHAM.md)). Hiện hệ thống mới có `clubs`, `club_members`, vai trò và quyền, `club_announcements` và quỹ theo sổ cái.

**Quyết định.**

1. **Mọi nội dung CLB nằm trong bảng có `club_id`**, và RLS dùng chung một hàm `private.is_club_member(club_id)` (thành viên `status = 'ACTIVE'`). Hành động quản trị kiểm tra `has_permission(club_id, code)`. Không có bảng "nội dung chung" nào trộn nhiều CLB.
2. **Chat lưu trong Postgres** (`club_messages`) và phát qua **postgres_changes** có filter `club_id=eq.<id>`, bật Realtime Authorization. Không dùng dịch vụ chat bên ngoài ở giai đoạn này. Lý do: chat phải gắn với dữ liệu chạy (chia sẻ bài chạy, chúc mừng tự động), cùng một cơ chế RLS, và quy mô CLB (≤ 500 người) nằm trong khả năng của Supabase.
   - Đã đọc được theo dõi bằng `club_message_reads(club_id, user_id, last_read_at)`, không đánh dấu từng tin.
   - Tải tin theo trang bằng con trỏ `(created_at, id)` và index `(club_id, created_at desc)`.
   - Xóa là xóa mềm (`deleted_at`). Quản trị ẩn tin và ghi vào `admin_audit_log`.
   - Trạng thái "đang gõ" và người đang online dùng **Broadcast / Presence**, không ghi DB.
3. **Bảng tin CLB** (`club_posts`) có hai nguồn. Thành viên tự đăng, và **hệ thống tự sinh** từ domain event: bài chạy được duyệt, PB, lên cấp, hoàn thành thử thách. Bài tự sinh do trigger hoặc worker tạo (ADR-005, ADR-008), không do client. Thông báo ghim là `club_posts.kind = 'ANNOUNCEMENT'`. Dữ liệu cũ của `club_announcements` được chuyển sang bảng này.
4. **Sự kiện chạy nhóm** (`club_events`, `club_event_rsvps`). Có hai cách điểm danh: quét QR do điều phối viên mở (mã có hạn 15 phút, ký HMAC), hoặc **tự nhận** khi bài chạy của thành viên bắt đầu trong khoảng ±30 phút quanh giờ hẹn và điểm xuất phát cách điểm hẹn ≤ 500 m.
5. **Quỹ CLB tách hai loại tiền.**
   - **Xu** đi qua sổ cái (tài khoản CLB, ADR-002).
   - **Tiền thật** (phí tháng, khoản chi) chỉ được **ghi nhận**, không đi qua RaceHub: `club_dues` (kỳ thu), `club_due_payments` (trạng thái từng người, người xác nhận, ảnh chứng từ) và `club_expenses`. Có thể gợi ý VietQR bằng số tài khoản của CLB. Việc này tránh nghĩa vụ trung gian thanh toán (ADR-011).
6. **Thông báo** dùng một bảng chung `notifications(user_id, club_id, kind, payload, read_at)` kèm `notification_settings(user_id, club_id, level)` với 3 mức: ALL, MENTIONS_AND_ANNOUNCEMENTS, NONE. Chuông trong app dùng postgres_changes. Web Push (Sprint 5) đọc cùng bảng này.
7. **Mọi thao tác ghi đi qua RPC** (ADR-003): `post_club_message`, `create_club_post`, `react_club_post`, `create_club_event`, `rsvp_club_event`, `check_in_club_event`, `record_due_payment`… Client chỉ `select` qua RLS. Riêng tin nhắn chat có thể cho `insert` trực tiếp với policy `author_id = auth.uid()`, kèm giới hạn tốc độ bằng trigger (≤ 20 tin / phút / người), để giảm độ trễ.

**Hệ quả.**
- Có một mô hình quyền thống nhất cho mọi tab CLB và dễ viết test RLS trong `tests/db/`.
- Chi phí Realtime tăng theo số CLB đang mở. Client chỉ subscribe CLB đang xem và hủy subscribe khi rời màn hình.
- Bảng `club_messages` sẽ lớn nhanh nhất. Cần partition theo tháng khi vượt khoảng 10 triệu dòng. Media lưu ở Storage bucket `club-media`, với policy theo thành viên.
- `clubs.announcement` và `club_announcements` bị thay thế dần. Trong thời gian chuyển đổi, giữ view tương thích.
