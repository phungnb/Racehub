---
name: tao-vat-pham
description: Tạo vật phẩm mới cho nhân vật 2D RaceHub (mũ, kính, đồng hồ, phụ kiện, hiệu ứng, logo CLB, hoặc màu áo/quần/tất/giày). Dùng khi người dùng muốn thiết kế, tách lớp, kiểm tra hoặc đưa một món đồ lên shop.
---

# Tạo vật phẩm nhân vật RaceHub

Trả lời người dùng bằng **tiếng Việt**. Đọc trước: `docs/NHAN_VAT.md` (khung chuẩn), `docs/vat-pham/HUONG_DAN.md`, `docs/vat-pham/PROMPT_AI.md`.

Đầu vào (`$ARGUMENTS`) là mô tả món đồ, ví dụ "mũ lưỡi trai đỏ logo RH", có thể kèm đường dẫn ảnh AI hoặc PNG.

## Bước 1: Xác định món đồ

Từ mô tả, chốt các thông tin sau. Chỉ hỏi lại khi thật sự mơ hồ; còn lại tự đề xuất rồi ghi rõ trong trả lời.
- `slot`: một trong `top`, `bottom`, `socks`, `shoes`, `accessory`, `watch`, `hair`, `glasses`, `hat`, `effect`.
- **Kiểu vật phẩm:**
  - Chỉ đổi màu áo / quần / tất / giày → **TINT**, không cần ảnh. Nhảy tới bước 4 (SQL hoặc trang Quản trị với `color`).
  - Kiểu áo / quần / tất / giày mới (ba lỗ, dài tay, áo gió, quần bó, váy, giày carbon…) → **LAYER** ở đúng ô đó. AI vẽ lại cả món. Mỗi màu là một món riêng.
  - Còn lại → **LAYER**.
- `code`: `<slot>_<mô tả không dấu>`, chữ thường, số, `_`, 3–48 ký tự. Ví dụ `hat_cap_red`.
- **Tên tiếng Việt:** ≤ 60 ký tự.
- **Độ hiếm và giá (Xu):** thường 10–30 · hiếm 40–80 · sử thi 120–200 · huyền thoại 400. Quà lên cấp thì giá 0 và cấp 2–5.

## Bước 1b: Mũ / visor / băng đô chỉ khác màu?

Nếu món mới chỉ là **màu khác** của mũ chạy, visor, băng đô bông hoặc băng đô mảnh, thì **không cần AI**:
1. Thêm dòng vào `CATALOG` trong `scripts/character/items/headwear.py`, theo mẫu các dòng có sẵn.
2. Chạy `python3 scripts/character/items/headwear.py <code>`.
3. Ghép thử bằng `python3 scripts/character/items/preview.py <ảnh ra> public/character/layers/<code>_male.png public/character/layers/<code>_female.png`, rồi mở ảnh ra xem.
4. Sang bước 4.

Không dùng lại mã đồ 3D cũ đã ngừng bán (xem `docs/vat-pham/HUONG_DAN.md` mục 1a).

## Bước 2: Có ảnh chưa?

- **Người dùng đã đưa ảnh AI** (ảnh nhân vật đã vẽ thêm món đồ) → sang bước 3.
- **Đã có PNG khung chuẩn của họa sĩ** → chạy `check`, bỏ qua bước 3:
  ```bash
  python3 scripts/character/make-layer.py check --gender <male|female> --slot <slot> --input <file>
  ```
- **Chưa có ảnh:**
  1. Chạy `python3 scripts/character/make-layer.py prepare`.
  2. Lấy prompt hoàn chỉnh của đúng món trong `docs/vat-pham/PROMPT_AI.md`: mục 1–10 theo ô, thay màu và chi tiết trong `{ngoặc nhọn}`. Nếu món chưa có mẫu, viết theo cấu trúc của món gần nhất. Soát theo danh sách "Những lỗi hay gặp" ở mục 11. Ghi kèm `--slot`, `--region` gợi ý của món đó.
  3. Đưa người dùng: prompt, đường dẫn 2 ảnh `scripts/character/out/nhan_vat_*_1024x1536.png`, và dặn dùng tính năng chọn vùng nếu có.
  4. Dừng lại, chờ người dùng gửi ảnh AI.

## Bước 3: Tách lớp và tự soát

Với mỗi giới tính có ảnh:

```bash
python3 scripts/character/make-layer.py extract --gender <g> --slot <slot> --code <code> --input <ảnh AI>
```

1. Đọc báo cáo JSON. Nếu `"ok": false`, hoặc có cảnh báo "lệch dáng", thì ảnh AI không dùng được. Báo người dùng tạo lại, gợi ý dùng chọn vùng.
2. **Mở ảnh xem thử** `scripts/character/out/<code>_<g>_preview.png` bằng công cụ đọc ảnh và **tự nhìn**:
   - Lớp dính nền hoặc da → chạy lại với `--threshold` cao hơn (40–50) hoặc `--region` hẹp hơn.
   - Món đồ bị khuyết → `--threshold` thấp hơn (22–28).
   - Bị cắt mép → nới `--region`.
3. Lặp tối đa 4 lần. Vẫn không đạt thì báo rõ lý do và đề nghị tạo lại ảnh AI.
4. Kiểm tra file cuối cùng bằng `check`.

## Bước 4: Đưa lên shop

Nói cho người dùng cả hai cách:
- **Trang Quản trị → Vật phẩm → Thêm** (khuyên dùng): tải 2 file `public/character/layers/<code>_<g>.png`, nhập tên, giá, độ hiếm. Không cần deploy.
- **SQL:** chạy `python3 scripts/character/make-layer.py sql --code <code> --name "<tên>" --slot <slot> --rarity <r> --price <giá> [--level <cấp>] [--description "<mô tả>"]`, rồi đưa câu SQL để dán vào Supabase SQL Editor.
  - Cách này cần commit ảnh trong `public/character/layers/` và deploy.
  - Chỉ commit khi người dùng đồng ý.

## Quy tắc

- Không sửa ảnh nền `public/character/<g>/base.webp` hay mặt nạ. Đổi chúng sẽ làm lệch mọi lớp đã có.
- Không dùng ảnh có logo thương hiệu thật (Nike, Adidas…) khi chưa được phép.
- SQL đưa cho người dùng tuân theo giới hạn SQL Editor: không `select … into`, không khối `do $$`.
- Cuối cùng tóm tắt: mã, tên, ô, giá, file đã tạo, ảnh xem thử, bước người dùng cần làm.
