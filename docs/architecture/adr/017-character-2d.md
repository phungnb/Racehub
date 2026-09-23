# ADR-017: Nhân vật 2D từ ảnh thật: đổi màu theo mặt nạ + xếp lớp khung chuẩn

**Trạng thái.** Đã chấp nhận (migration `20261001001000_character_2d.sql`). **Thay thế [ADR-016](./016-character-3d.md).** Chuẩn tài nguyên: [docs/NHAN_VAT.md](../../NHAN_VAT.md).

**Bối cảnh.** Bản 3D GLB (ADR-016) chạy được nhưng nhìn "đồ chơi", kém xa ảnh nhân vật có sẵn. Chủ sản phẩm xem nhiều bản thử và chọn hướng **giữ nguyên ảnh nhân vật thật, chỉ đổi màu áo / quần / tất / giày** (giữ nếp vải, ánh sáng), có chuyển Nam / Nữ.

Yêu cầu quan trọng nhất là sau này tự thiết kế thêm vật phẩm (áo CLB, mũ, kính…) mà **không bị lệch** so với nhân vật.

**Quyết định.**

1. **Ảnh nền + mặt nạ vùng.**
   - Mỗi giới tính có `base.webp` và 4 mặt nạ `top/bottom/socks/shoes.png`, tất cả cùng **khung chuẩn 900 × 1350**.
   - Đổi màu tại client (canvas 2D): `màu mới = màu đích × (độ sáng điểm / độ sáng trung bình vùng)`, trộn theo độ phủ mặt nạ. Màu rất tối được nâng tối thiểu và cộng thêm độ lệch sáng để còn thấy nếp gấp.
   - Hàm thuần `tintPixel` có test.
2. **Hai loại vật phẩm** (`avatar_items.render_kind`):
   - `TINT`: chỉ cần `color`. Một dòng CSDL là thêm được một món, không cần họa sĩ.
   - `LAYER`: PNG trong suốt cùng khung chuẩn (`layer_urls` theo giới tính), xếp lớp theo thứ tự ô.
   - Khung chuẩn cố định nên món vẽ trên chính ảnh nền luôn khớp.
   - Ô chỉ hiện trong Tủ đồ khi có vật phẩm, nên thêm Mũ / Kính sau này không cần sửa code.
3. **Canvas vuông.** Ảnh 2:3 được mở rộng hai bên bằng cách kéo dãn cột mép (nền xám trơn), rồi `object-cover` lấp kín khung ở mọi tỉ lệ.
4. **Chuyển đổi từ 3D.**
   - Ngừng bán tóc, mũ, kính, đồng hồ, phụ kiện, hiệu ứng và 2 món trùng màu.
   - Người đã mua được **hoàn đúng số Xu, đúng loại Xu** (đảo bút toán của giao dịch mua; không tìm thấy thì hoàn bằng Xu thưởng) và nhận thông báo.
   - Món áo / quần / tất / giày đã mua được giữ, đổi tên theo màu.
   - Thêm bản "nguyên bản" (màu gốc) cho mỗi ô, làm bộ mặc định.
   - Quà cấp 2 / 3 thay bằng tất và giày.
   - Gỡ `three`, `@react-three/*` và 5,6 MB GLB. Tài nguyên mới khoảng 150 KB.
5. **Máy chủ.**
   - `save_character` chỉ nhận `gender`; 4 ô áo / quần / tất / giày bắt buộc.
   - `get_character` trả kèm chi tiết món đang mặc, để hồ sơ hoặc BXH vẽ được nhân vật mà không cần cả danh mục.

**Hệ quả.**
- Một dáng đứng cho mỗi giới. Thêm tư thế là thêm ảnh nền mới, và các món LAYER phải vẽ lại cho từng tư thế. Món TINT chỉ cần mặt nạ mới.
- Chất lượng mặt nạ quyết định độ sạch khi đổi màu. Bộ hiện tại sinh bằng ngưỡng màu, cộng đường viền vẽ tay cho áo nữ (`scripts/character/segment.py`). Ảnh nền mới nên kèm mặt nạ vẽ tay.
- Còn để sau:
  - Trang admin tải lớp PNG lên, tự kiểm tra kích thước 900 × 1350 và xem thử trên cả hai giới.
  - Ảnh đại diện chụp từ nhân vật.
  - Vật phẩm theo mùa.
