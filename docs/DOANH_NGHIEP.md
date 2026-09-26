# RaceHub Doanh nghiệp / Liên CLB

Gói thứ ba sau **Free** và **CLB Pro**, tham khảo mô hình Free → Pro → Enterprise của Tucana.
Gói này **báo giá riêng**, bán theo hợp đồng. Migration: `20261001008300_organizations.sql`.

## 1. Bán cho ai, bán cái gì

| Khách hàng | Bài toán | RaceHub giải bằng |
|---|---|---|
| Doanh nghiệp (nhân sự, công đoàn) | Phong trào sức khoẻ nhân viên, giải chạy nội bộ, báo cáo cho lãnh đạo | Chiến dịch, bảng xếp hạng phòng ban (tổng + bình quân đầu người), báo cáo CSV theo mã nhân viên |
| Liên đoàn / hệ thống CLB | Quản lý nhiều CLB, giải liên CLB | CLB thành viên, bảng xếp hạng theo CLB, tài trợ CLB Pro cho cả hệ thống |
| Trường học | Phong trào theo lớp / khoa | Đơn vị đặt tên tuỳ ý (Lớp, Khoa…), chiến dịch theo số ngày chạy |

**Giá trị bán được:**
1. Giảm việc thủ công: số liệu tự đồng bộ, không phải gom ảnh chụp Strava, không phải làm bảng tính.
2. Thi đua công bằng: xếp theo tổng *và* bình quân đầu người, kèm tỷ lệ tham gia của từng đơn vị.
3. Thương hiệu riêng: logo, ảnh bìa, chủ đề màu, khẩu hiệu.
4. Riêng tư và chống gian lận: tổ chức chỉ thấy tổng km / số buổi / số ngày của từng người; không thấy bản đồ, vị trí hay nhịp tim. Chỉ tính bài hợp lệ và đang chia sẻ.

## 2. Định giá (gợi ý, admin chốt theo hợp đồng)

RaceHub **không giữ tiền**: hợp đồng, hoá đơn VAT và chuyển khoản đều làm ngoài app. Admin chỉ bật / gia hạn gói.

| Hạng mục | Gợi ý |
|---|---|
| Phí theo số chỗ | 8.000 – 15.000 ₫ / người / tháng, tối thiểu 50 chỗ, trả theo năm |
| Gói chiến dịch ngắn hạn | 1 chiến dịch 1–3 tháng, giá trọn gói theo quy mô |
| Liên đoàn | Theo số CLB; tuỳ chọn *tài trợ CLB Pro* cho mọi CLB thành viên |
| Dịch vụ thêm | Thiết kế BIB / huy chương / áo, tổ chức sự kiện offline — qua đối tác ở Chợ Runner |

Tham chiếu: Tucana Pro khoảng 1,2 triệu ₫ / CLB / năm, gói Enterprise của họ báo giá riêng.
Với một doanh nghiệp 300 người, mức 10.000 ₫ / người / tháng tương đương 36 triệu ₫ / năm.

## 3. Luồng bán hàng → triển khai

1. Khách vào **`/doanh-nghiep`** (xem được khi chưa đăng nhập) và gửi form báo giá. Admin nhận thông báo.
2. Admin mở **Quản trị → Kinh doanh → Doanh nghiệp → Yêu cầu báo giá**, gọi điện rồi đánh dấu "Đã liên hệ".
3. Ký hợp đồng. Admin bấm **Tạo tổ chức** ngay trên yêu cầu đó và điền:
   - email tài khoản người quản trị (người này đăng ký RaceHub trước);
   - số chỗ, số CLB, ngày hết hạn, có tài trợ CLB Pro hay không;
   - thông tin xuất hoá đơn.

   Yêu cầu báo giá tự chuyển sang "Đã ký".
4. Người quản trị tổ chức nhận thông báo. Họ vào **Tổ chức của tôi**, tạo đơn vị, đặt thương hiệu, rồi gửi mã mời hoặc link `/orgs/join/<mã>` qua email hay Zalo nội bộ.
5. Tạo **chiến dịch**:
   - cách tính: tổng km, số buổi hoặc số ngày chạy;
   - mục tiêu chung và mục tiêu mỗi người;
   - quãng tối thiểu mỗi bài.

   Mọi người được báo và số liệu tính tự động.
6. Cuối kỳ, quản trị tổ chức xuất báo cáo (CSV) để trao giải và báo cáo cho lãnh đạo.
7. Gia hạn: admin sửa ngày hết hạn (bắt buộc ghi lý do vào nhật ký). Khi hết hạn:
   - dữ liệu cũ vẫn xem được, nhưng không tạo chiến dịch mới và không nhận thành viên mới;
   - cron hằng ngày trả lại gói cũ cho các CLB đã được tài trợ Pro.

## 4. Quy tắc chính (máy chủ kiểm tra)

- **Số chỗ:**
  - chỉ tính thành viên trực tiếp đã được duyệt;
  - nếu vượt số chỗ, hệ thống báo `ORG_FULL`;
  - thành viên CLB thuộc tổ chức không chiếm chỗ (liên đoàn giới hạn theo số CLB).
- **Một CLB chỉ thuộc một tổ chức tại một thời điểm.** CLB vào tổ chức khi ban quản trị CLB đồng ý (Cài đặt CLB → Tổ chức / liên đoàn).
- **Tài trợ CLB Pro:**
  - hệ thống lưu gói cũ của CLB và nâng CLB lên Pro tới hết hạn hợp đồng;
  - khi CLB rời tổ chức, tổ chức tắt tài trợ hoặc hết hạn, CLB được trả lại gói cũ;
  - ngoại lệ: CLB đã tự gia hạn Pro dài hơn thì giữ nguyên.
- **Người được tính trong chiến dịch:** thành viên tổ chức và thành viên các CLB thuộc tổ chức.
- **Bài được tính:** bài hợp lệ, đang chia sẻ, dài từ mức km tối thiểu trở lên.
- **Quyền:**
  - người sở hữu và quản trị viên tổ chức quản lý mọi thứ;
  - thành viên xem chiến dịch, bảng xếp hạng và danh sách thành viên (không thấy mã nhân viên);
  - admin hệ thống có toàn quyền.

## 5. Việc nên làm tiếp

- Tự động xác nhận chuyển khoản (PayOS / Casso) cho gói CLB Pro và VIP.
- Chiến dịch có giải thưởng từ nhà tài trợ (dùng lại voucher 004xxx).
- Trang công khai của tổ chức: bảng xếp hạng chiến dịch để truyền thông nội bộ.
- Đăng nhập SSO công ty (Google Workspace / Microsoft) cho khách hàng lớn.
