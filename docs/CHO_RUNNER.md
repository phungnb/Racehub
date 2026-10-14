# Chợ Runner — cơ chế hoạt động

> Code `features/market` · migration `005300_market_partners.sql` (đối tác), `006400_bib_market.sql` (Chợ BIB)
> Nguyên tắc chung: **RaceHub không thu tiền hộ, không làm trung gian thanh toán.** Người dùng liên hệ và thanh toán trực tiếp với nhau.

Chợ Runner có 2 phần: **Đối tác** và **Chợ BIB**.

## 1. Đối tác (HLV / cửa hàng / dịch vụ)

| Bước | Ai làm | Ở đâu |
|---|---|---|
| 1. Tạo hồ sơ (miễn phí): tên, giới thiệu, chuyên môn, bảng dịch vụ + giá, khu vực, liên hệ, ảnh | Đối tác (bất kỳ tài khoản nào; mỗi loại 1 hồ sơ) | Chợ Runner → **Tôi** (hoặc thẻ "Bạn là HLV, cửa hàng…?" → Đăng ký hồ sơ) |
| 2. Hồ sơ ở trạng thái **Chờ xác minh**, chưa hiện với ai | — | Thẻ trạng thái ngay đầu Chợ Runner |
| 3. Xác minh: kiểm tra thông tin, giấy tờ / chứng chỉ (nếu cần), có thể liên hệ đối tác | Admin | Quản trị → Cộng đồng → **Đối tác** (ô "Hồ sơ đối tác" trong Việc cần xử lý) |
| 4. **Duyệt** → hiện trên Chợ, gắn dấu xác minh, đối tác nhận thông báo. **Cần bổ sung** → đối tác sửa rồi tự gửi lại. **Ẩn** khi vi phạm | Admin | như trên, mọi thao tác ghi nhật ký quản trị |
| 5. Runner tìm theo loại, khu vực, chuyên môn → liên hệ trực tiếp (điện thoại, Zalo, Facebook, web) | Runner | Chợ Runner → Đối tác |

**Để đối tác dễ biết cách hợp tác:**
- Người chưa có hồ sơ thấy thẻ **"Bạn là HLV, cửa hàng hay dịch vụ cho runner?"** ở đầu Chợ. Thẻ ghi 3 bước, có nút **Đăng ký hồ sơ** và **Liên hệ hợp tác**. Nút liên hệ gửi email tới `NEXT_PUBLIC_SUPPORT_EMAIL`; cần đặt biến môi trường này thì nút mới hiện.
- Đối tác đã được xác minh có thể được gắn làm **tác giả bài Kiến thức**. Cuối mỗi bài như vậy có nút "Xem hồ sơ & dịch vụ". Bài về giáo án, dinh dưỡng, thiết bị tự dẫn người đọc sang đúng nhóm đối tác.
- Hiện **admin chưa đăng hồ sơ thay đối tác**. Hồ sơ gắn với tài khoản của chủ để họ tự cập nhật giá và liên hệ. Nếu cần, bản sau có thể thêm tính năng "admin tạo hồ sơ hộ rồi trao quyền cho chủ".

### 1b. Cửa hàng đối tác (migration 016000)

Đối tác tạo hồ sơ xong là vào được **Quản lý cửa hàng** (`/market/me/shop/<id>`) để bán hàng; khách chỉ thấy sản phẩm sau khi hồ sơ được xác minh.

| Phần | Cách hoạt động |
|---|---|
| Sản phẩm | Tối đa 200 sản phẩm / đối tác: ≤ 8 ảnh, giá + giá gốc (hiện % giảm), danh mục, SKU, mô tả, bật / ẩn. |
| Phân loại | ≤ 30 phân loại (size, màu…), mỗi cái có giá riêng (tuỳ chọn) và tồn kho riêng. Không có phân loại thì dùng tồn kho của sản phẩm. Tồn kho trống = không giới hạn. |
| Đặt hàng | Giỏ hàng lưu trên máy khách. Khi đặt, **server tự tính lại giá, phí giao, tồn kho** (khoá hàng, chống bán lố); lỗi một dòng thì cả đơn không ghi. Đơn lưu ảnh chụp tên / giá lúc đặt. |
| Thanh toán | **Chuyển khoản VietQR** thẳng vào tài khoản đối tác (nội dung = mã đơn `RHxxxxxx`) hoặc **COD** (đối tác bật). RaceHub không giữ tiền. |
| Phí giao | Phí cố định + ngưỡng miễn phí do đối tác đặt. |
| Đơn của đối tác | Chờ xác nhận → Đã nhận tiền → Đang giao (mã vận đơn) → Hoàn tất; hoặc Huỷ (hoàn lại tồn kho). Đơn chuyển khoản phải xác nhận nhận tiền trước khi giao. Xuất Excel (CSV). |
| Đơn của khách | `/market/orders`: xem trạng thái, mã vận đơn, mở lại mã chuyển khoản, tự huỷ khi đơn còn "Chờ xác nhận". |
| Thông báo | Đối tác nhận thông báo đơn mới / khách huỷ; khách nhận thông báo khi đối tác nhận tiền, giao, hoàn tất, huỷ. |
| Riêng tư | Họ tên, điện thoại, địa chỉ nhận chỉ chủ shop và người đặt xem được. Tài khoản ngân hàng chỉ hiện cho khách trong đơn đang chờ chuyển khoản. |

## 2. Chợ BIB

Runner nhượng lại BIB khi không chạy được, hoặc đăng tin cần mua BIB giải đã hết suất.

| Quy tắc | Lý do |
|---|---|
| Chỉ runner **≥ 3 bài chạy hợp lệ**, không bị khoá mới đăng tin | Chống tài khoản ảo, lừa đảo |
| **Giá nhượng ≤ giá gốc**; 0đ = tặng lại | Chống phe vé, runner mua đúng giá |
| Ghi rõ cách chuyển: **đổi tên qua BTC** (khuyến khích) / chưa rõ | Nhiều giải cấm chạy BIB người khác (bị loại, mất bảo hiểm) |
| Liên hệ **ẩn** trong danh sách; bấm "Xem liên hệ" mới hiện; ≤ 30 tin / 24 giờ; người đăng thấy số lượt xem | Hạn chế cào số điện thoại |
| Tối đa 5 tin đang mở / người; ≤ 10 tin mới / ngày | Chống spam |
| Tin **tự hết hạn** sau ngày giải; người đăng chuyển được sang "Đang giao dịch" / "Đã xong" / gỡ tin | Danh sách luôn còn hiệu lực |
| **Báo cáo** (lừa đảo, phe vé…) → tab Báo cáo của admin; 3 người báo cáo → tin tạm ẩn | Tự bảo vệ cộng đồng |
| Admin ẩn / hiện tin (kèm lý do, người đăng được thông báo): Quản trị → Cộng đồng → **Chợ BIB** | Xử lý vi phạm |

Ngay đầu Chợ BIB có khung nhắc an toàn: chỉ chuyển tiền sau khi BTC đã xác nhận đổi tên, và không đặt cọc cho người lạ.
