# Nhân vật 2D RaceHub: khung chuẩn và cách thêm vật phẩm

Tài liệu cho **họa sĩ / người thiết kế** vật phẩm và **admin** đưa vật phẩm lên shop. Quyết định kiến trúc: [ADR-017](architecture/adr/017-character-2d.md).

## 1. Nhân vật được vẽ thế nào

Nhân vật là **một ảnh thật** (nam hoặc nữ). App vẽ lên canvas theo 3 bước:

1. **Ảnh nền** `public/character/<male|female>/base.webp`.
2. **Đổi màu vùng (TINT).** Mỗi vùng áo / quần / tất / giày có một **mặt nạ** xám cùng kích thước: trắng là vùng được đổi màu, đen là giữ nguyên, xám là trộn một phần (mép mềm). App lấy độ sáng từng điểm so với độ sáng trung bình của vùng rồi nhân vào màu mới, nên nếp vải, bóng đổ và ánh sáng vẫn giữ nguyên.
3. **Xếp lớp (LAYER).** Ảnh PNG trong suốt cùng khung được vẽ chồng lên, theo thứ tự: áo, quần, tất, giày, phụ kiện, đồng hồ, tóc, kính, mũ, hiệu ứng. Dùng cho mũ, kính, áo CLB có logo…

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

## 4. Đổi ảnh nhân vật / thêm tư thế

1. Ảnh gốc (nền trơn, người đứng giữa) đặt tên `scripts/character/source/runner_<male|female>.png`. Thư mục này không bị deploy, chỉ dùng để sinh tài nguyên.
2. Chạy lại `python3 scripts/character/segment.py` (cần `pip install pillow numpy`) để sinh `base.webp` và 4 mặt nạ.
   - Ngưỡng màu trong script chỉ đúng cho bộ ảnh hiện tại. Với ảnh mới, tốt nhất họa sĩ **giao kèm 4 mặt nạ vẽ tay** (`top.png`, `bottom.png`, `socks.png`, `shoes.png`) cùng khung. Khi đó chỉ cần chép vào thư mục, không cần chạy script.
3. **Đổi ảnh nền thì mọi lớp PNG cũ phải vẽ lại theo ảnh mới.** Lớp chỉ khớp với đúng ảnh nền đã dùng để vẽ nó. Vật phẩm đổi màu (TINT) thì không cần làm lại.

## 5. Kiểm tra trước khi đưa lên

- File đúng 900 × 1350, nền trong suốt (lớp) hoặc xám (mặt nạ).
- Mở Tủ đồ, chọn món mới, bật cả **Nam** và **Nữ** để kiểm tra có bị lệch hay lem không.
- Thử với 2–3 màu áo khác nhau để chắc lớp không che mất phần đổi màu.
