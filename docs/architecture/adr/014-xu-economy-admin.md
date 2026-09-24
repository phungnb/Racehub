# ADR-014: Kinh tế Xu và điều phối của admin

**Trạng thái.** Đã chấp nhận (migration `20261001000700_economy_admin.sql`). Bổ sung ADR-002 (sổ cái) và ADR-011 (tiền ảo).

**Bối cảnh.** Trước đây thử thách CLB được tạo miễn phí, còn phí thử thách công khai tính theo bậc cố định. Thưởng chạy là 1 Xu/km với trần 50 Xu/ngày, quá hào phóng so với giá trị định bán. Admin cũng chưa có công cụ để cộng Xu cho CLB, tặng lượt tạo thử thách, hay xem dòng Xu.

**Quyết định.**

1. **Giá trị tham chiếu:** 1 Xu ≈ 1.000đ (`xuVnd`). Con số này chỉ dùng để hiển thị và để định giá gói Xu hay tài trợ. Xu **không** đổi ngược ra tiền (ADR-011).
2. **Phí tạo thử thách tính theo số người tối đa** (`challengeFee`), áp dụng cho mọi loại, kể cả thử thách CLB:
   | Số người tối đa | Phí |
   |---|---|
   | ≤ 5 | Miễn phí |
   | 6–10 | 3 Xu/người (10 người = 30 Xu ≈ 30.000đ) |
   | > 10 | 5 Xu/người ≈ 5.000đ/người (20 người = 100 Xu, 100 người = 500 Xu) |

   Thử thách 1-1 tính 2 người, mục tiêu cá nhân tính 1 người, nên cả hai luôn miễn phí. Thử thách CLB trừ phí vào **quỹ CLB**, không trừ ví người tạo.
3. **Kiếm Xu từ chạy:** km đầu được 1 Xu, mỗi km tiếp theo 0,2 Xu, trần 10 Xu/ngày. Ví dụ 5 km = 1,8 Xu, 10 km = 2,8 Xu, half marathon = 5 Xu. Người chạy 5 km mỗi ngày kiếm khoảng 54 Xu/tháng, đủ tạo một thử thách 10 người sau khoảng 2–3 tuần. Nhờ vậy Xu có giá trị, và nguồn chính cho thử thách lớn là quỹ CLB, tài trợ, hoặc gói Xu (Sprint 7).
4. **Vé tạo miễn phí** (`challenge_passes`): admin tặng cho cá nhân hoặc CLB với số vé, sức chứa tối đa mỗi thử thách và hạn dùng.
   - Khi tạo thử thách, server tự dùng vé sắp hết hạn nhất rồi đến vé nhỏ nhất đủ sức chứa.
   - Vé CLB chỉ dùng cho thử thách nội bộ CLB đó.
5. **Admin điều phối:**
   - Chức năng: tìm tài khoản, cộng hoặc trừ Xu (*Xu thưởng* hoặc *Xu nạp*), tặng hoặc thu hồi vé, sửa chính sách.
   - Mọi lệnh đều đi qua sổ cái (`ADMIN_GRANT` / `ADMIN_DEDUCT`) và bắt buộc có lý do.
   - Mọi lệnh được ghi vào `admin_audit_log` và gửi thông báo cho người nhận, hoặc cho ban quản trị CLB.
   - Lệnh chống gửi trùng bằng khóa idempotency.
   - Không cho số dư âm.
6. **Chính sách nằm một chỗ** (`economy_global_config`, có phiên bản). Mặc định ở `private.economy_config()`, admin ghi đè từng khóa. Client có bản sao công thức trong `shared/lib/economy.ts` để hiển thị trước. Server luôn tính lại.

**Hệ quả.**
- Số liệu 6–10 người = 3 Xu/người và mức thưởng chạy là đề xuất ban đầu. Admin chỉnh được mà không cần deploy.
- Hàm cũ `create_challenge_with_ledger` (bậc cố định) vẫn còn cho tương thích, UI mới không dùng.
