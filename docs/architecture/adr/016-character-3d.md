# ADR-016: Nhân vật 3D dạng mô-đun (GLB + xương Mixamo)

**Trạng thái.** **Bị thay thế bởi [ADR-017](./017-character-2d.md)** (nhân vật 2D từ ảnh thật). Bộ GLB, trình hiển thị three.js và tài liệu chuẩn asset 3D đã gỡ khỏi repo. Bảng và RPC của migration `20261001000900_character_shop.sql` vẫn dùng tiếp.

**Bối cảnh.** Đặc tả Module 3.2–3.3 có avatar thay được áo, quần, giày, mũ, kính và đồng hồ, cùng một shop vật phẩm theo độ hiếm. Trước đây app chỉ có 2 ảnh PNG cố định và một bản 3D ghép từ khối cơ bản. Chủ sản phẩm chọn **3D thật (GLB)**, thay vì vector 2D hoặc ảnh render theo từng bộ đồ.

**Quyết định.**

1. **Mô-đun theo xương.** Một thân (nam hoặc nữ) có bộ xương đặt tên theo **Mixamo**, kèm 3 hoạt ảnh `Idle` / `Run` / `Wave`. Mỗi món đồ là một GLB riêng:
   - Đồ cứng gắn vào xương theo tên node.
   - Đồ skinned được buộc lại vào bộ xương của thân.

   Mixamo là chuẩn phổ biến nhất, họa sĩ nào cũng làm được, và thư viện hoạt ảnh miễn phí.
2. **Màu tách khỏi hình.** Vật liệu tên `tint` / `tint2` / `skin` / `hair` được app tô màu. Một mô hình cho ra nhiều vật phẩm, ví dụ áo thun Xanh / Trắng / Đen. Thêm vật phẩm mới chỉ cần thêm một dòng CSDL.
3. **Bộ asset khởi đầu sinh bằng code** (`scripts/character/build-models.mjs`, three.js + GLTFExporter). Mục đích là để app chạy ngay khi chưa có họa sĩ:
   - Gồm 66 file, khoảng 5,6 MB: 2 thân, 5 kiểu tóc, 5 áo, 4 quần, 3 tất, 2 giày, 4 mũ, 2 kính, 2 đồng hồ, 4 phụ kiện, 1 hiệu ứng.
   - Phong cách "đồ chơi vinyl" tròn trịa.
   - Khi có asset của họa sĩ, chỉ cần thay file hoặc điền `model_urls`.
4. **Hiển thị:** React Three Fiber, tải riêng qua `next/dynamic` (không vào bundle chính, không chạy phía server).
   - Mỗi món đồ tải trong một `Suspense` riêng, nên thân không nhấp nháy khi đổi đồ.
   - Ánh sáng studio dựng từ Lightformer, không tải HDR từ mạng.
   - Máy không có WebGL hoặc tải lỗi thì hiện ảnh PNG tĩnh.
5. **Kinh tế:** mua qua sổ cái (`SHOP_ITEM`, tiêu Xu thưởng trước), giá theo độ hiếm:

   | Độ hiếm | Giá |
   |---|---|
   | Thường | 10–30 Xu |
   | Hiếm | 40–80 Xu |
   | Sử thi | 120–200 Xu |
   | Huyền thoại | 400 Xu |

   Có **quà lên cấp** miễn phí từ cấp 2 đến cấp 5 (Module 1.3 · FR8), tự vào tủ đồ. Người chơi thử đồ trên nhân vật trước khi mua. Lưu cả bộ đồ trong một lệnh; server kiểm tra quyền sở hữu và đúng ô.

**Hệ quả.**
- Chất lượng hình phụ thuộc asset. Bộ khởi đầu là bản tạm, cần họa sĩ 3D làm lại thân, tóc và đồ theo chuẩn để đạt mức "đẹp như game".
- Đồ skinned từ họa sĩ phải rig trên chính file thân RaceHub. Nếu đổi thân, phải giao cả bộ thân và đồ.
- Còn để sau:
  - Ảnh đại diện chụp từ nhân vật (dùng cho bảng tin và BXH).
  - Giao diện admin quản lý vật phẩm (hiện thêm bằng SQL).
  - Vật phẩm theo mùa (Sprint 6).
  - Khóa vật phẩm độc quyền khi bị hạ cấp (Module 1.3).
