# Làm và đưa vật phẩm nhân vật lên shop

Tài liệu gồm 3 bước: **thiết kế → tách lớp → đưa lên shop**. Chuẩn kỹ thuật (khung 900 × 1350, thứ tự lớp): [docs/NHAN_VAT.md](../NHAN_VAT.md). Prompt cho AI vẽ: [PROMPT_AI.md](PROMPT_AI.md).

## Chọn cách làm

| Loại vật phẩm | Cách nhanh nhất | Cần gì |
|---|---|---|
| **Màu mới** cho áo / quần / tất / giày | Trang **Quản trị → Vật phẩm → Thêm → Đổi màu** | Chỉ chọn màu, không cần ảnh |
| **Mũ, kính, đồng hồ, phụ kiện, hiệu ứng, logo CLB** | AI vẽ → `make-layer.py extract` → Quản trị tải PNG lên | Ảnh AI + máy có Python |
| Họa sĩ vẽ tay | Họa sĩ giao PNG 900×1350 → `make-layer.py check` → Quản trị tải lên | File PNG đúng khung |
| **Mũ / visor / băng đô theo màu** | Thêm một dòng vào `CATALOG` trong `scripts/character/items/headwear.py` rồi chạy script (vẽ theo hình khối đầu, có bóng và tóc mái) | Chỉ cần mã màu |
| **Để AI làm hết** | Mở Claude Code, gõ `/tao-vat-pham mũ lưỡi trai đỏ` | Ảnh AI đã vẽ (hoặc mô tả món đồ) |

## 1. Thiết kế bằng AI

1. `python3 scripts/character/make-layer.py prepare`: lấy 2 ảnh nhân vật 1024×1536.
2. Mở ChatGPT hoặc Gemini, đính kèm ảnh, dán prompt khung ở [PROMPT_AI.md](PROMPT_AI.md) mục 1, thay mô tả món đồ ở mục 2.
3. Tải ảnh AI trả về. Làm cho cả Nam và Nữ.

## 2. Tách lớp

```bash
python3 scripts/character/make-layer.py extract --gender male --slot hat --code hat_cap_red --input ai_male.png
python3 scripts/character/make-layer.py extract --gender female --slot hat --code hat_cap_red --input ai_female.png
```

Script tự làm các việc sau:
- Đưa ảnh về khung 900×1350.
- Căn lại nếu AI làm lệch hoặc co giãn nhẹ (tới ±5 % và vài chục pixel).
- Cân lại độ sáng.
- Chỉ giữ phần AI vẽ thêm, lấp lỗ bên trong món đồ, làm mềm mép.

Kết quả:
- **Lớp:** `public/character/layers/hat_cap_red_male.png`.
- **Ảnh xem thử:** `scripts/character/out/hat_cap_red_male_preview.png`.
- Cuối lệnh in ra báo cáo, có `"ok": true/false` và các cảnh báo.

**Họa sĩ đã có sẵn PNG** thì chỉ cần kiểm tra:

```bash
python3 scripts/character/make-layer.py check --gender male --slot hat --input hat_cap_red_male.png
```

## 3. Đưa lên shop

**Cách A: trang Quản trị (khuyên dùng, không cần deploy)**

1. Đăng nhập tài khoản `SYSTEM_ADMIN` → **Quản trị → Vật phẩm → Thêm**.
2. Chọn **Lớp ảnh PNG**, chọn ô (Mũ…), nhập tên. Mã tự tạo từ tên.
3. Tải file Nam và Nữ lên. Trang **tự kiểm tra** đúng 900×1350, nền trong suốt, dung lượng dưới 1 MB. Khung xem thử hiện ngay món đồ trên nhân vật, bấm Nam/Nữ để soát.
4. Nhập giá, cấp mở khóa, độ hiếm → **Thêm vào shop**.
   - Ảnh lưu vào kho `character-layers` trên Supabase Storage.
   - Người chơi thấy món mới ngay. Ô mới (vd. Mũ) tự hiện trong Tủ đồ.

**Cách B: SQL Editor** (khi ảnh đã nằm trong repo `public/character/layers/` và đã deploy)

```bash
python3 scripts/character/make-layer.py sql --code hat_cap_red --name "Mũ lưỡi trai Đỏ" --slot hat --rarity rare --price 50
```

Dán câu SQL in ra vào SQL Editor rồi bấm Run.

## 4. Sửa, ngừng bán

- **Quản trị → Vật phẩm:**
  - Bấm bút chì để sửa giá, tên, ảnh.
  - Bấm **Ẩn** để ngừng bán. Người đã mua vẫn giữ món đồ, nhưng món ẩn không hiện trên nhân vật.
- **Không xóa vật phẩm:** để giữ lịch sử mua bán.
- **Không đổi ô của món đã có người mua:** ví dụ đổi mũ thành kính. Khi cần, tạo món mới với mã mới.
- Mọi thay đổi được ghi vào nhật ký quản trị (`admin_audit_log`).

## 5. Kiểm tra chất lượng trước khi bán

- [ ] Xem thử cả **Nam** và **Nữ**: không lệch, không lem ra da hoặc nền.
- [ ] Thử với 2–3 màu áo khác nhau: lớp không che mất phần đổi màu.
- [ ] Mép món đồ mềm, không răng cưa, không còn viền xám của nền cũ.
- [ ] File dưới 300 KB (script tự nén nếu nặng).
- [ ] Giá theo bảng: thường 10–30 · hiếm 40–80 · sử thi 120–200 · huyền thoại 400 Xu.
