# Bộ prompt AI vẽ vật phẩm cho nhân vật RaceHub

Dùng với AI **sửa ảnh**: ChatGPT (tạo ảnh), Gemini (Nano Banana), hoặc bất kỳ công cụ nào nhận ảnh đầu vào.

AI **vẽ thêm món đồ lên chính ảnh nhân vật**. Sau đó script `make-layer.py` so ảnh AI với ảnh gốc để tách riêng món đồ ra thành lớp PNG trong suốt, đúng khung 900 × 1350. Nhờ vậy món đồ luôn khớp người, không lệch.

> Prompt viết bằng tiếng Anh vì các AI vẽ ảnh làm theo tiếng Anh chính xác hơn. Chỉ cần thay phần trong `{ngoặc nhọn}`.

## 0. Chuẩn bị ảnh gửi cho AI

```bash
python3 scripts/character/make-layer.py prepare
```

Lệnh này tạo `scripts/character/out/nhan_vat_male_1024x1536.png` và `..._female_...`. Mỗi món đồ gửi **từng ảnh một** (Nam riêng, Nữ riêng).

**Mẹo để tách lớp sạch nhất:**

- **Chọn khổ dọc 2:3 (1024×1536).** Trong ChatGPT, ghi rõ "portrait 1024x1536".
- **Dùng tính năng chọn vùng nếu có.** ChatGPT có nút "Select / Edit area", Photoshop có Generative Fill. Chỉ tô vùng đặt món đồ (đầu, cổ tay…), AI sẽ không đụng chỗ khác. Đây là cách khớp gần như tuyệt đối.
- **AI đổi mặt, đổi dáng hoặc đổi nền** thì bỏ ảnh đó, tạo lại. Không cố dùng.
- **Làm Nam trước.** Khi được ưng ý, gửi ảnh Nữ kèm câu: "same item as the previous image".

## 1. Prompt khung (dùng cho mọi món)

```text
Edit this image. Add ONLY the following item to the character: {MÔ TẢ MÓN ĐỒ}.

Strict rules:
- Keep EVERYTHING else pixel-identical: same person, same face, same hair, same pose, same body proportions,
  same clothes, same colors, same lighting, same gray studio background, same camera framing and zoom.
- Do not crop, zoom, re-frame, re-center or change the canvas. Output size: portrait 1024x1536.
- The item must follow the existing pose and perspective, with realistic shading that matches the soft studio light
  coming from the front-left, and a subtle contact shadow where it touches the body.
- Style: the same semi-realistic 3D-render look as the character (Pixar-like), clean edges, no text unless requested.
- Do not add any other objects, logos, watermarks or background changes.
```

## 2. Prompt theo loại món (thay vào `{MÔ TẢ MÓN ĐỒ}`)

Mô tả dưới đây viết theo **đặc điểm của sản phẩm chạy bộ thật** (xem mục 6). Món đồ trông "đúng chất" hơn hẳn so với mô tả chung chung như "a cap".

| Ô (`slot`) | Món | Mô tả gợi ý |
|---|---|---|
| `hat` | Mũ chạy (kiểu Ciele GOCap / Nike AeroBill) | `a lightweight unstructured 6-panel running cap in {black} technical fabric, low-profile crown, short slightly curved brim, a {olive} contrast color under the brim, small laser-cut vent holes on the side panels, a small {lime} lightning-bolt logo on the front, sitting low on the forehead` |
| `hat` | Visor | `a {white} running visor: soft terry sweatband around the head and a short curved brim, NO crown so the top of the hair stays visible, a small {blue} lightning-bolt logo on the band` |
| `hat` | Băng đô bông (kiểu Halo / Nike) | `a {red} terry-cloth sweatband about 5 cm wide across the forehead just above the eyebrows, slightly fuzzy texture, small {white} lightning-bolt logo in the center; let a few front hair strands fall naturally over the band` |
| `hat` | Băng đô thun mảnh (kiểu Buff) | `a thin {black} elastic sports headband about 2 cm wide along the hairline, subtle ribbed texture, tiny {lime} logo` |
| `glasses` | Kính chắn một mảnh (kiểu Oakley Sutro) | `oversized single-shield sport sunglasses with a {white} frame and {mirrored blue} lens covering both eyes, resting on the nose, temples going back over the ears` |
| `glasses` | Kính gọng tròn (kiểu goodr) | `lightweight {black} sport sunglasses with rounded rectangular lenses in {dark smoke}, matte non-slip frame` |
| `watch` | Đồng hồ GPS | `a {black} GPS running watch with a round face and a slim silicone strap on the character's visible wrist, screen showing a pace number` |
| `accessory` | Số đeo ngực | `a race bib pinned on the chest of the shirt, white paper with number "{2026}" in bold black, four safety pins` |
| `accessory` | Huy chương | `a gold finisher medal on a {red} ribbon hanging around the neck, resting on the chest` |
| `accessory` | Áo nước trail | `a lightweight {teal} trail running hydration vest over the shirt with two soft flasks in the front pockets` |
| `accessory` | Túi đeo tay | `a {black} running phone armband on the upper arm` |
| `effect` | Hào quang | `a soft glowing {lime green} energy ring on the floor around the feet, light particles rising, subtle glow on the legs` |

- **Món cho Nữ đội mũ:** thêm câu `The character is female; her ponytail comes out through the back opening of the cap.`
- **Visor và băng đô cho Nữ:** thêm câu `Keep her bangs and ponytail; the band sits over the hair.`
- **Logo:** chỉ dùng tia chớp RaceHub hoặc logo CLB. Không để AI vẽ logo thương hiệu thật (Nike, Oakley…).

### Những lỗi hay gặp làm món đồ trông "giả", cần tránh

- **Vòng quanh đầu vẽ cong xuống hình chữ U.** Nhìn ngang tầm mắt, mũ và băng đô phải hơi cong hình vòm (giữa trán cao, hai bên thấp dần).
- **Món đồ rộng quá đầu, lơ lửng.** Hai đầu dải phải khuất ra sau đầu, không chìa ra ngoài.
- **Không có bóng.** Cần bóng mềm dưới mép băng đô và bóng lưỡi trai đổ xuống trán.
- **Có khe hở giữa thân mũ và lưỡi trai,** hoặc lưỡi trai quá dày. Nhìn ngang, lưỡi trai chỉ là một dải cong mỏng, thấy mặt dưới.
- **Tóc thò ra ngoài thân mũ ở phía trên.** Mũ phải ép gọn tóc.
- **Vải quá lấm tấm.** Vải kỹ thuật màu sáng gần như trơn.

## 3. Áo CLB có logo (gửi kèm ảnh logo)

Đính kèm **2 ảnh**: ảnh nhân vật và ảnh logo CLB (nền trong suốt nếu có).

```text
Edit the first image. Print the logo from the second image on the front of the character's existing shirt,
centered on the chest, about {12} cm wide, following the fabric folds and shading so it looks printed on the fabric.
Keep the shirt color and everything else exactly the same. Portrait 1024x1536, no re-framing, no other changes.
```

Khi tách lớp, dùng `--slot accessory` để logo **chồng lên màu áo người chơi chọn**. Logo đổi theo áo nào cũng hợp.

Muốn làm cả chiếc áo CLB (màu và họa tiết riêng), dùng `--slot top`. Khi đó lớp vẽ đè toàn bộ áo, người chơi không đổi màu áo được nữa.

## 4. Nhờ AI nghĩ ý tưởng vật phẩm

```text
Tôi làm app chạy bộ RaceHub (Việt Nam) có nhân vật 2D mặc đồ thể thao. Gợi ý 10 vật phẩm
cho sự kiện {Quốc khánh 2/9 / Tết / giải marathon Hà Nội}, mỗi món gồm: tên tiếng Việt (≤ 30 ký tự),
ô trang phục (hat, glasses, watch, accessory, effect, hoặc màu áo/quần/tất/giày), độ hiếm (common, rare, epic, legendary),
giá Xu gợi ý (1 Xu ≈ 1.000đ: thường 10–30, hiếm 40–80, sử thi 120–200, huyền thoại 400)
và một câu mô tả tiếng Anh để đưa vào prompt vẽ ảnh.
```

## 5. Sau khi có ảnh AI

```bash
python3 scripts/character/make-layer.py extract --gender male   --slot hat --code hat_cap_red --input ~/Downloads/ai_male.png
python3 scripts/character/make-layer.py extract --gender female --slot hat --code hat_cap_red --input ~/Downloads/ai_female.png
```

Mở `scripts/character/out/hat_cap_red_male_preview.png` để xem 3 ảnh cạnh nhau: ảnh AI, nhân vật mặc đồ, lớp tách ra.

| Hiện tượng | Cách xử lý |
|---|---|
| Lớp dính thêm mảng nền hoặc da | Tăng `--threshold 45`, hoặc thu vùng: `--region 300,0,650,260` (pixel khung 900×1350) |
| Món đồ bị khuyết hoặc thủng | Giảm `--threshold 24` |
| Món đồ bị cắt mép | Nới `--region` (vd. mũ có vành dài: `--region 0,0,1,0.32`) |
| Cảnh báo "ảnh AI lệch dáng nhiều" | AI đã vẽ lại người. Tạo lại ảnh (nên dùng chọn vùng) |

Ưng ý thì đưa lên shop theo [HUONG_DAN.md](HUONG_DAN.md) mục 3.

## 6. Tham khảo sản phẩm thật (nghiên cứu 9/2026)

| Loại | Mẫu tham khảo | Đặc điểm nên giữ khi thiết kế |
|---|---|---|
| Mũ chạy | Ciele GOCap, Nike AeroBill Featherlight | Vải mỏng không cứng, thân mũ thấp, lưỡi ngắn hơi cong, lưới hoặc lỗ laser hai bên, logo phản quang nhỏ, mặt dưới lưỡi thường khác màu |
| Visor | Ciele ALZvisor, Nike AeroBill visor | Băng thấm mồ hôi quanh đầu + lưỡi trai, hở đỉnh đầu |
| Băng đô bông | Halo, Nike Swoosh headband | Bản 4–5 cm, vải bông xù, có dải chặn mồ hôi |
| Băng đô mảnh | Buff CoolNet, Nike Flex | Thun gân mảnh 2–3 cm, không trượt |
| Kính | Oakley Sutro (mắt chắn một mảnh lớn), goodr (gọng tròn, giá rẻ, chống trượt) | Kính chắn một mảnh là "dáng" đặc trưng của dân chạy |

Nguồn:
- [Treeline Review: running hats](https://www.treelinereview.com/gearreviews/best-running-hats)
- [The Run Testers: running caps](https://theruntesters.com/best-running-caps/)
- [Garage Gym Reviews: running headbands](https://www.garagegymreviews.com/best-running-headbands)
- [Treeline Review: running sunglasses](https://www.treelinereview.com/gearreviews/best-running-sunglasses)
