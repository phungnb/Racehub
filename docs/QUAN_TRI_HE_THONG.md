# Quy chế quản trị hệ thống RaceHub

Áp dụng từ migration `20261001011800_feedback_round4.sql`.

## 1. Hai tầng quản trị

| | **Quản trị chính** (chủ hệ thống) | **Admin thường** (nhân viên) |
|---|---|---|
| Ai đặt | Chỉ người giữ **key hệ thống** (Supabase SQL Editor / service role). App **không** đặt được. | Quản trị chính thêm trong app (Quản trị → Người dùng → **Đội quản trị**). |
| Quyền | Toàn quyền. Cấp / gỡ admin, phân nhóm quyền, đặt hạn dùng. | Chỉ các **nhóm quyền được giao**; có thể có ngày hết hạn. |
| Tác động admin khác | Có (trừ Quản trị chính khác). | **Không**: không cấp, gỡ, phân quyền hay khóa được admin nào. |
| Bị gỡ trong app | **Không**. Chỉ gỡ được bằng key hệ thống. | Quản trị chính gỡ được. |
| Số lượng | Tối đa 3; khuyên dùng 1 chính + 1 dự phòng. | Không giới hạn. |

### Đặt Quản trị chính (làm một lần)
Mở Supabase → **SQL Editor** rồi chạy:

```sql
select private.admin_set_owner('email-dang-nhap-cua-ban@...');
```

- Bỏ Quản trị chính: `select private.admin_set_owner('email', false);`
- Khi chưa có Quản trị chính, **không ai** cấp / gỡ quyền admin được trong app.

### Admin cũ
Admin có trước migration 011800 vẫn giữ **toàn quyền như trước**, để app không bị gián đoạn. Họ hiện nhãn "chưa phân quyền" cho tới khi Quản trị chính phân quyền lại. Nên phân quyền lại ngay, hoặc gỡ các tài khoản không dùng hay không có email.

## 2. Các nhóm quyền

| Mã | Nhóm | Gồm |
|---|---|---|
| USERS | Người dùng | Tìm tài khoản, xem hồ sơ, khóa / mở khóa, tài khoản bất thường |
| ECONOMY | Kinh tế Xu | Cộng / trừ Xu, chính sách kinh tế, gói nạp, quỹ CLB, chỉ số |
| ORDERS | Đơn hàng & gói | Xác nhận thanh toán, tặng gói VIP / Pro, bảng giá |
| CLUBS | CLB & doanh nghiệp | Gói CLB Pro, xóa CLB, doanh nghiệp; toàn quyền trong mọi CLB |
| CHALLENGES | Thử thách & giải | Hủy thử thách, lượt tạo, chợ BIB, đơn vị tổ chức giải |
| SHOP | Cửa hàng & khuyến mãi | Vật phẩm, quà, khuyến mãi, nhiệm vụ, voucher, đối tác, quay thưởng |
| CONTENT | Nội dung | Trang hướng dẫn & chính sách, thông báo hệ thống |
| MODERATION | Kiểm duyệt | Báo cáo vi phạm, duyệt bài chạy, kiểm thử GPS |
| SYSTEM | Hệ thống | Kiểm tra hệ thống, lỗi, chính sách vận hành, Strava |
| AUDIT | Nhật ký | Xem nhật ký quản trị (chỉ đọc) |

Gợi ý phân quyền:
- **CSKH:** USERS + MODERATION.
- **Kế toán:** ORDERS (không cho ECONOMY nếu không cần cộng / trừ Xu tay).
- **Biên tập:** CONTENT.
- **Vận hành giải:** CHALLENGES + CLUBS.
- **Marketing:** SHOP.
- **Kỹ thuật:** SYSTEM + AUDIT.

**Cách kiểm tra quyền:** mọi hàm quản trị `admin_*` đi qua `is_system_admin()` / `require_admin()`. Hai hàm này đọc tên hàm RPC đang được gọi (`request.path`) và đối chiếu với nhóm quyền. Vì vậy quyền luôn được kiểm tra **ở máy chủ**: ẩn nút trên giao diện chỉ để dễ nhìn, không phải lớp bảo vệ.

## 3. Chống bị hack mất hệ thống

1. **Key hệ thống là "chìa khóa gốc".** Service role key và mật khẩu cơ sở dữ liệu:
   - Chỉ Quản trị chính giữ; không gửi qua chat hay email.
   - Không để trong mã nguồn; chỉ đặt ở biến môi trường máy chủ.
   - Đổi key ngay khi nghi lộ (Supabase → Settings → API → Roll).
2. **Tài khoản Quản trị chính:**
   - Dùng email riêng, không chia sẻ.
   - Mật khẩu mạnh, bật **xác thực 2 lớp** cho cả email, Supabase, Vercel và GitHub.
3. **Quản trị chính không bị chiếm qua app.** Kể cả khi một tài khoản admin bị lộ mật khẩu, kẻ gian cũng không tự nâng lên Quản trị chính được, và không gỡ được Quản trị chính.
4. **Tài khoản dự phòng.** Có một Quản trị chính dự phòng (email khác, cất kỹ) để lấy lại quyền nếu tài khoản chính bị khóa hay mất.
5. **Không có email thì không làm admin.** Tài khoản không có email đăng nhập không được cấp quyền admin, để tránh tài khoản "ma".
6. **Thông báo tức thì.** Mỗi khi cấp / gỡ / phân quyền admin, mọi Quản trị chính nhận thông báo.

## 4. Chống nhân viên lạm quyền

1. **Quyền tối thiểu:** mỗi người chỉ có nhóm quyền đúng việc; mặc định admin mới **không có quyền nào**.
2. **Hạn dùng:** cộng tác viên hay nhân viên thời vụ được đặt ngày hết hạn; quá hạn là tự mất quyền.
3. **Không tự cấp, không đụng nhau:**
   - Admin không tự cấp quyền cho mình.
   - Admin không cấp / gỡ / khóa được admin khác.
   - Đơn nạp / mua gói của một admin phải do admin khác xác nhận.
   - Admin không nhận Xu.
4. **Nhật ký bất biến:** mọi thao tác quản trị ghi vào `admin_audit_log`, không sửa / xóa được (kể cả admin). Quản trị chính nên xem **Nhật ký quản trị** hằng tuần, đặc biệt các mục Cộng / trừ Xu, Xác nhận đơn hàng, Đổi quyền admin.
5. **Nghỉ việc là gỡ quyền ngay.** Tab Đội quản trị → Gỡ quyền.
6. **Rà soát định kỳ (mỗi tháng):**
   - Ai còn là admin.
   - Ai đã lâu không đăng nhập (thì gỡ).
   - Nhóm quyền có còn đúng việc không.
