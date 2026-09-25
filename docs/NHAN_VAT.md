# Nhân vật 2D RaceHub: khung chuẩn và cách thêm vật phẩm

Tài liệu cho **họa sĩ / người thiết kế** vật phẩm và **admin** đưa vật phẩm lên shop. Quyết định kiến trúc: [ADR-017](architecture/adr/017-character-2d.md).

## 1. Nhân vật được vẽ thế nào

Nhân vật là **một ảnh thật** (nam hoặc nữ). App vẽ lên canvas theo 3 bước:

1. **Ảnh nền** `public/character/<male|female>/base.webp`.
2. **Đổi màu vùng (TINT).** Mỗi vùng áo / quần / tất / giày có một **mặt nạ** xám cùng kích thước: trắng là vùng được đổi màu, đen là giữ nguyên, xám là trộn một phần (mép mềm). App lấy độ sáng từng điểm so với độ sáng trung bình của vùng rồi nhân vào màu mới, nên nếp vải, bóng đổ và ánh sáng vẫn giữ nguyên.
3. **Xếp lớp (LAYER).** Ảnh PNG trong suốt cùng khung được vẽ chồng lên, theo thứ tự: quần, tất, giày, áo (vạt áo và áo khoác nằm trên quần), phụ kiện, đồng hồ, tóc, kính, mũ, hiệu ứng. Dùng cho mũ, kính, áo CLB có logo…

## 2. Khung chuẩn: quy tắc để đồ không bị lệch

| Mục | Quy định |
|---|---|
| Kích thước | **900 × 1350 px** (tỉ lệ 2:3) cho mọi file: ảnh nền, mặt nạ, lớp vật phẩm |
| Vị trí | Vẽ trên **chính ảnh nền** của giới tính đó, không dịch, không co giãn. Góc trên trái của file lớp trùng góc trên trái của ảnh nền |
| Lớp vật phẩm | PNG 32-bit có kênh trong suốt, ngoài món đồ là trong suốt hoàn toàn, ≤ 300 KB (nén bằng pngquant / Squoosh) |
| Mặt nạ | PNG xám 8-bit, trắng là vùng đổi màu, mép làm mềm 1–2 px |

**Cách làm một lớp khớp 100%.**

1. Mở `base.webp` của giới tính cần làm trong Photoshop / Figma / Krita (900 × 1350).
2. Tạo layer mới phía trên, vẽ món đồ (mũ, logo áo CLB…) đè đúng vào người.
3. Ẩn layer ảnh nền, xuất **riêng layer món đồ** ra PNG 900 × 1350 nền trong suốt.
4. Làm lại cho giới còn lại. Nếu chỉ có một bản, app dùng bản đó cho cả hai (chỉ nên làm vậy với hiệu ứng).

Không cắt sát (trim) file khi xuất. Chỉ cần giữ nguyên kích thước canvas thì món đồ sẽ luôn khớp.

## 3. Thêm vật phẩm

**Cách dễ nhất:** trang **Quản trị → Vật phẩm → Thêm**. Tải PNG lên, trang tự kiểm tra khung và xem thử trên Nam/Nữ, không cần SQL hay deploy. Quy trình đầy đủ (kể cả nhờ AI vẽ): [docs/vat-pham/HUONG_DAN.md](vat-pham/HUONG_DAN.md).

Hoặc dùng SQL Editor:

**Một màu mới cho áo / quần / tất / giày** chỉ cần thêm một dòng, không cần file ảnh:

```sql
insert into public.avatar_items (code, name, description, category, rarity, asset_url, color, price_xu, unlock_level)
values ('top_vn_red', 'Áo Đỏ Cờ', 'Mừng Quốc khánh 2/9', 'top', 'epic', 'tint', '#da251d', 120, 1);
```

- `category` là một trong: `top`, `bottom`, `socks`, `shoes`.
- `color = null` nghĩa là màu nguyên bản của ảnh.

**Một món lớp ảnh** (mũ, kính, áo CLB có logo…):

1. Tải 2 file PNG lên Supabase Storage (bucket công khai) hoặc đặt vào `public/character/layers/`.
2. Thêm dòng:
   ```sql
   insert into public.avatar_items (code, name, category, rarity, asset_url, render_kind, layer_urls, price_xu, unlock_level)
   values ('hat_cap_racehub', 'Mũ lưỡi trai RaceHub', 'hat', 'rare', 'layer', 'LAYER',
     '{"male": "/character/layers/hat_cap_racehub_male.png", "female": "/character/layers/hat_cap_racehub_female.png"}', 50, 1);
   ```
3. Ô mới (ví dụ **Mũ**) tự hiện trong Tủ đồ khi có ít nhất một món đang bán.

- **Áo CLB có logo:** có thể làm lớp cho ô `accessory` để mặc chồng lên áo đã đổi màu, hoặc làm lớp cho ô `top` (khi đó lớp vẽ đè toàn bộ áo).
- Các cột chung:
  - `price_xu = 0` và `unlock_level > 1`: **quà lên cấp**, tự vào tủ đồ khi người chơi đạt cấp đó.
  - `is_default = true`: mọi người có sẵn.
  - `is_active = false`: ẩn khỏi shop.
- Không cần deploy lại.

## 3b. Quản lý trang phục (migration 005800)

**Vòng đời** (Quản trị → Vật phẩm): *Nháp* (chỉ admin thấy) → *Chờ duyệt* → *Đang bán* → *Ngừng bán* (người đã có vẫn mặc) → *Gỡ hẳn*. Món đã có người sở hữu không đưa về Nháp được. Món mới tạo mặc định là **Nháp**: xem thử kỹ rồi bấm **Bán**.

**Điều kiện mở khóa** (ô *Điều kiện mở khóa & bán*):

| Điều kiện | Ý nghĩa |
|---|---|
| Cấp 1–8 | Chưa đủ cấp thì khóa |
| Huy hiệu | Phải có huy hiệu (mã trong `achievements`) |
| Thử thách | Phải hoàn thành thử thách |
| Chỉ thành viên CLB | Đồng phục: chỉ thành viên thấy / mua / mặc; rời CLB tự tháo |
| Mở bán từ / đến | Ngoài khung giờ thì khóa (*Sắp mở bán* / *Hết thời gian*) |
| Giới hạn số lượng | Bán hết thì *Hết hàng* |

Giá **0 Xu + có điều kiện** = tự phát khi người chơi đủ điều kiện (quà cấp, quà huy hiệu, quà thử thách, đồng phục miễn phí).

**Bộ sưu tập:** Quản trị → Vật phẩm → *Bộ sưu tập* (Mùa, Sự kiện, CLB, Nhà tài trợ…). Tủ đồ có nút lọc theo bộ đang mở.

## 3c. Vùng in trên áo

Áo (ô `top`) có 4 vùng in, vẽ theo nếp vải và bóng đổ của áo, bị cắt gọn trong mặt nạ áo:

| Vùng | Nội dung | Giới hạn |
|---|---|---|
| Logo ngực trái | PNG / WebP / JPG nền trong suốt, ≤ 2 MB | kho `uniform-media` |
| Chữ lớn giữa ngực | thường là tên CLB | 24 ký tự |
| Dòng phụ | khẩu hiệu, năm thành lập | 32 ký tự |
| Tên runner | tên gọi của **người mặc** (từ cuối họ tên, viết hoa) | tự co cho vừa |

Màu chữ và kiểu chữ (Thể thao / Hiện đại / Cổ điển) chọn chung cho cả áo. Tọa độ vùng in theo khung chuẩn nằm ở `PRINT_ZONES` (`features/character/model/catalog.ts`); đổi ảnh nền thì đo lại.

**Đồng phục CLB:** Chủ nhiệm / đội trưởng vào **Cài đặt CLB → Đồng phục CLB → Thiết kế mẫu áo** (màu, logo, chữ, bật tên runner, xem thử trên nhân vật) → **Gửi duyệt** (tối đa 3 mẫu chờ). Admin vào **Quản trị → Vật phẩm → Đồng phục**, xem thử, **đặt giá như vật phẩm thường** (0 Xu = phát miễn phí cho cả CLB) hoặc trả lại kèm lý do. Duyệt xong cả CLB nhận thông báo.

> Áo thật chỉ bán qua **Shop đối tác ở Chợ Runner**. RaceHub không nhận tiền áo.

## 3d. Bộ đồng phục — Kit Studio (migration 005900)

Mở ở **Cài đặt CLB → Đồng phục CLB → Thiết kế bộ đồng phục** (ban quản trị CLB) hoặc **Quản trị → Vật phẩm → Thiết kế bộ đồ / Đồng phục → Thiết kế** (admin).

1. **Màu CLB:** tải ảnh áo đấu thật (chụp thẳng, nền trơn) hoặc bấm *Màu từ logo CLB* → hệ thống hút màu chủ đạo (bỏ nền và màu pha ở mép), chọn màu chính / màu phụ, phối sẵn kiểu *Cổ điển*. Đổi kiểu: *Đồng bộ*, *Tương phản*, *Sáng*.
2. **Từng món:** áo, quần, tất, giày — màu, họa tiết, bật / tắt món trong bộ (tắt thì thành viên giữ món đang mặc).
3. **In áo:** logo ngực (hoặc *Dùng logo CLB*), chữ lớn, dòng phụ, tên runner.

Họa tiết là "màu thứ hai" vẽ theo mặt nạ nên giữ nếp vải như màu nền; hình học ở `features/character/model/patterns.ts`. Các món cùng bộ có chung `kit`; Tủ đồ hiện thẻ bộ với **Mặc cả bộ** và **Mua phần còn thiếu**.

## 4. Đổi ảnh nhân vật / thêm tư thế

1. Ảnh gốc (nền trơn, người đứng giữa) đặt tên `scripts/character/source/runner_<male|female>.png`. Thư mục này không bị deploy, chỉ dùng để sinh tài nguyên.
2. Chạy lại `python3 scripts/character/segment.py` (cần `pip install pillow numpy`) để sinh `base.webp` và 4 mặt nạ.
   - Ngưỡng màu trong script chỉ đúng cho bộ ảnh hiện tại. Với ảnh mới, tốt nhất họa sĩ **giao kèm 4 mặt nạ vẽ tay** (`top.png`, `bottom.png`, `socks.png`, `shoes.png`) cùng khung. Khi đó chỉ cần chép vào thư mục, không cần chạy script.
3. **Đổi ảnh nền thì mọi lớp PNG cũ phải vẽ lại theo ảnh mới.** Lớp chỉ khớp với đúng ảnh nền đã dùng để vẽ nó. Vật phẩm đổi màu (TINT) thì không cần làm lại.

## 5. Kiểm tra trước khi đưa lên

- File đúng 900 × 1350, nền trong suốt (lớp) hoặc xám (mặt nạ).
- Mở Tủ đồ, chọn món mới, bật cả **Nam** và **Nữ** để kiểm tra có bị lệch hay lem không.
- Thử với 2–3 màu áo khác nhau để chắc lớp không che mất phần đổi màu.
