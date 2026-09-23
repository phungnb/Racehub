# Thư viện prompt AI vẽ vật phẩm cho nhân vật RaceHub

Bộ prompt đầy đủ cho **mọi ô trang phục** trong hệ thống: áo, quần, tất, giày, đồ đội đầu, kính, đồng hồ, phụ kiện, tóc, hiệu ứng.

- Mỗi prompt là **một khối hoàn chỉnh**. Chép nguyên khối, dán vào ChatGPT hoặc Gemini kèm ảnh nhân vật, chỉ thay chữ trong `{ngoặc nhọn}`.
- Prompt viết bằng tiếng Anh vì AI vẽ ảnh làm theo tiếng Anh chính xác hơn. Phần giải thích viết bằng tiếng Việt.
- Mô tả từng món dựa trên đặc điểm đồ chạy bộ thật đang bán (xem mục 12). Logo luôn là **tia chớp RaceHub** hoặc logo CLB, **không** dùng logo thương hiệu thật.

Mục lục:

0. [Quy trình 3 bước](#0-quy-trình-3-bước)
1. [Áo](#1-áo--slot-top)
2. [Quần](#2-quần--slot-bottom)
3. [Tất](#3-tất--slot-socks)
4. [Giày](#4-giày--slot-shoes)
5. [Đồ đội đầu](#5-đồ-đội-đầu--slot-hat)
6. [Kính](#6-kính--slot-glasses)
7. [Đồng hồ](#7-đồng-hồ--slot-watch)
8. [Phụ kiện](#8-phụ-kiện--slot-accessory)
9. [Tóc](#9-tóc--slot-hair)
10. [Hiệu ứng](#10-hiệu-ứng--slot-effect)
11. [Prompt phụ: đổi màu, bản nữ, sửa lỗi, nghĩ ý tưởng](#11-prompt-phụ)
12. [Tham khảo sản phẩm thật](#12-tham-khảo-sản-phẩm-thật)

---

## 0. Quy trình 3 bước

**Bước 1. Lấy ảnh nhân vật**

```bash
python3 scripts/character/make-layer.py prepare
```

Lệnh tạo 2 ảnh `scripts/character/out/nhan_vat_male_1024x1536.png` và `nhan_vat_female_1024x1536.png`.

**Bước 2. Nhờ AI vẽ**
- Mở ChatGPT (tạo ảnh) hoặc Gemini, đính kèm **một** ảnh nhân vật, dán prompt của món đồ.
- **Mẹo khớp tuyệt đối:** nếu công cụ có "chọn vùng / Select area" (ChatGPT, Photoshop Generative Fill), tô đúng vùng đặt món đồ rồi mới dán prompt.
- **AI đổi mặt, đổi dáng hay đổi nền** thì bỏ ảnh, tạo lại.
- **Làm Nam trước.** Ưng ý rồi mới làm Nữ bằng prompt ở mục 11.

**Bước 3. Tách lớp → đưa lên shop**

```bash
python3 scripts/character/make-layer.py extract --gender male --slot {ô} --code {mã} --input anh_ai.png [--region ...]
```

Mỗi món bên dưới ghi sẵn `--slot`, mã gợi ý, giá gợi ý và `--region` khi món to hơn vùng mặc định. Sau đó đưa lên shop qua **Quản trị → Vật phẩm → Thêm** (xem [HUONG_DAN.md](HUONG_DAN.md)).

> **Áo và quần có hai cách:**
> - **Chỉ đổi màu** kiểu áo hoặc quần sẵn có: không cần AI, vào Quản trị → Vật phẩm → Thêm → **Đổi màu**. Người chơi được giữ nếp vải gốc.
> - **Kiểu mới** (ba lỗ, dài tay, áo gió, quần bó, váy…): dùng prompt bên dưới, AI **vẽ lại cả món**, tách thành lớp ảnh ở ô `top` hoặc `bottom`.
>   - Món lớp ảnh **không đổi màu được** trong app. Mỗi màu là một món riêng, dùng prompt "đổi màu" ở mục 11.
>   - Lớp áo tự nằm trên lớp quần (áo khoác, vạt áo đè lên cạp quần).

---

## 1. Áo — `slot: top`

**Tách lớp:**
- Áo ngắn tay, ba lỗ, croptop: vùng mặc định.
- Áo dài tay, áo khoác: thêm `--region 0,0.14,1,0.62` để lấy trọn tay áo.

### 1.1 Áo thun kỹ thuật (technical tee) · mã `top_tech_{màu}` · 30–60 Xu

```text
Edit this image. Replace the character's current shirt with a new running shirt:
a lightweight technical running t-shirt in {royal blue} with raglan sleeves, a slightly fitted athletic cut,
breathable mesh panels on the sides, flat-lock seams, a small reflective {silver} lightning-bolt logo on the left chest,
and a thin reflective strip on the back of the shoulders.
The fabric must wrinkle and fold naturally around the crossed arms / the pose, with the same soft studio light
from the front-left and realistic shading.
Keep EVERYTHING else exactly the same: same person, face, hair, skin, pose, shorts, socks, shoes, watch,
gray studio background, camera framing and zoom. Do not crop or re-frame. Output: portrait 1024x1536.
Style: the same semi-realistic 3D-render (Pixar-like) look as the character. No other logos or text.
```

### 1.2 Áo ba lỗ thi đấu (race singlet) · mã `top_singlet_{màu}` · 60 Xu

```text
Edit this image. Replace the character's current shirt with a race singlet:
a sleeveless ultra-light racing singlet in {orange} with a scoop neck, wide armholes showing the shoulders,
a subtle perforated mesh texture, a split side hem, and a small {white} lightning-bolt logo on the chest.
Where the old sleeves were, paint the character's natural bare shoulders and upper arms with matching skin tone,
muscle definition and lighting.
Keep EVERYTHING else exactly the same: same person, face, hair, pose, shorts, socks, shoes, watch,
gray studio background, framing and zoom. Output: portrait 1024x1536, same semi-realistic 3D-render style.
```

### 1.3 Áo croptop / bra thể thao (nữ) · mã `top_bra_{màu}` · 40–80 Xu

```text
Edit this image. Replace the character's current top with a sports bra style running crop top:
a {black} medium-support sports bra with a racerback, wide under-bust band with a small {lime} lightning-bolt logo,
smooth matte fabric with a subtle sheen and clean bonded edges.
Where fabric is removed, paint natural skin with matching tone and lighting.
Keep EVERYTHING else exactly the same: same person, face, hair and ponytail, pose, shorts, socks, shoes, watch,
gray studio background, framing and zoom. Output: portrait 1024x1536, same semi-realistic 3D-render style.
```

### 1.4 Áo dài tay half-zip · mã `top_halfzip_{màu}` · 80 Xu · `--region 0,0.14,1,0.62`

```text
Edit this image. Replace the character's current shirt with a long-sleeve half-zip running top:
{heather gray} brushed technical fabric, a short stand-up collar with a {lime} quarter zip half open,
thumbholes at the cuffs, fitted sleeves that follow the arms naturally, reflective piping along the sleeves,
and a small lightning-bolt logo on the chest.
The long sleeves must cover the arms completely following the exact same arm pose.
Keep EVERYTHING else exactly the same: same person, face, hair, hands, pose, shorts, socks, shoes, watch
(worn over the sleeve), gray studio background, framing and zoom. Output: portrait 1024x1536, same 3D-render style.
```

### 1.5 Áo gió chạy bộ (windbreaker) · mã `top_jacket_{màu}` · 150 Xu · `--region 0,0.14,1,0.64`

```text
Edit this image. Dress the character in a packable running windbreaker jacket over the shirt:
ultralight ripstop nylon in {neon yellow}, slightly translucent, zipped halfway up, a small hood folded at the collar,
elastic cuffs, reflective {silver} details on the chest and sleeves, and a small lightning-bolt logo.
The jacket hem sits just below the waistband of the shorts. The fabric shows light crinkles and a soft sheen.
Keep EVERYTHING else exactly the same: same person, face, hair, hands, pose, shorts, socks, shoes,
gray studio background, framing and zoom. Output: portrait 1024x1536, same semi-realistic 3D-render style.
```

### 1.6 Áo CLB (club jersey) · mã `top_clb_{tên clb}` · tùy CLB

Đính kèm **2 ảnh**: ảnh nhân vật và logo CLB.

```text
Edit the first image. Replace the character's current shirt with a running club jersey:
a technical running t-shirt in the club colors {navy and sky blue}, with a sublimated diagonal stripe pattern
across the chest, the club logo from the second image printed on the left chest (about 8 cm wide),
the club name "{HỒ TÂY RUNNERS}" printed in bold sporty letters across the upper back shoulders (not visible from front)
and small on the right sleeve. Fabric folds and lighting must look natural on the body.
Keep EVERYTHING else exactly the same: same person, face, hair, pose, shorts, socks, shoes, watch,
gray studio background, framing and zoom. Output: portrait 1024x1536, same semi-realistic 3D-render style.
```

**Chỉ in logo lên áo người chơi đang mặc** (logo đổi màu theo áo nào cũng hợp): dùng prompt dưới đây, tách lớp với `--slot accessory`.

```text
Edit the first image. Print the logo from the second image on the front of the character's existing shirt,
centered on the chest, about 12 cm wide, following the fabric folds and shading so it looks printed on the fabric.
Keep the shirt color and everything else exactly the same. Portrait 1024x1536, no re-framing, no other changes.
```

### 1.7 Áo sự kiện / Finisher · mã `top_event_{sự kiện}` · quà hoặc 120 Xu

```text
Edit this image. Replace the character's current shirt with an official race finisher t-shirt:
a {bright red} technical tee with a large gold "FINISHER" print and the text "{RACEHUB MARATHON 2026}" on the chest,
a small gold star graphic, and fine gold trim on the sleeve cuffs. Natural fabric folds and studio lighting.
Keep EVERYTHING else exactly the same: same person, face, hair, pose, shorts, socks, shoes, watch,
gray studio background, framing and zoom. Output: portrait 1024x1536, same semi-realistic 3D-render style.
```

### 1.8 Áo nén (compression) · mã `top_compression_{màu}` · 80 Xu

```text
Edit this image. Replace the character's current shirt with a skin-tight short-sleeve compression running top
in {matte black} with {lime} flat-lock seams tracing the chest and shoulders, a subtle textured grip pattern,
and a small lightning-bolt logo. The fabric hugs the muscles and shows their shape with soft highlights.
Keep EVERYTHING else exactly the same: same person, face, hair, pose, shorts, socks, shoes, watch,
gray studio background, framing and zoom. Output: portrait 1024x1536, same semi-realistic 3D-render style.
```

---

## 2. Quần — `slot: bottom`

**Tách lớp:**
- Quần ngắn: vùng mặc định.
- Quần bó ngắn / quần lửng: `--region 0,0.34,1,0.8`.
- Quần bó dài: `--region 0,0.34,1,0.92`.

### 2.1 Quần short xẻ tà 3" (split shorts) · mã `bottom_split_{màu}` · 60 Xu

```text
Edit this image. Replace the character's current shorts with racing split shorts:
very short 3-inch {red} running shorts with high side splits, a lightweight woven shell with a slight sheen,
a thin {white} contrast binding along the hem, a flat elastic waistband with a small lightning-bolt logo on the left leg.
Where the old shorts covered the thighs, paint natural bare thighs with matching skin tone, muscle and lighting.
Keep EVERYTHING else exactly the same: same person, face, hair, shirt, pose, arms, socks, shoes, watch,
gray studio background, framing and zoom. Output: portrait 1024x1536, same semi-realistic 3D-render style.
```

### 2.2 Quần short 5" có lót · mã `bottom_5in_{màu}` · 30–50 Xu

```text
Edit this image. Replace the character's current shorts with classic 5-inch running shorts:
{navy} lightweight stretch woven fabric, a wide comfortable waistband, a small back zip pocket,
curved side hem, reflective lightning-bolt logo on the left leg, natural fabric folds at the hips.
Keep EVERYTHING else exactly the same: same person, face, hair, shirt, pose, socks, shoes, watch,
gray studio background, framing and zoom. Output: portrait 1024x1536, same semi-realistic 3D-render style.
```

### 2.3 Quần short 2 trong 1 (có quần bó bên trong) · mã `bottom_2in1_{màu}` · 80 Xu

```text
Edit this image. Replace the character's current shorts with 2-in-1 running shorts:
a loose {black} outer short over a slightly longer {charcoal} compression half-tight that peeks out 3 cm
below the outer hem, a wide flat waistband, side phone pocket on the inner tight, small lightning-bolt logo.
Keep EVERYTHING else exactly the same: same person, face, hair, shirt, pose, socks, shoes, watch,
gray studio background, framing and zoom. Output: portrait 1024x1536, same semi-realistic 3D-render style.
```

### 2.4 Quần bó ngắn (half tights) · mã `bottom_halftight_{màu}` · 60 Xu · `--region 0,0.34,1,0.8`

```text
Edit this image. Replace the character's current shorts with running half tights:
{matte black} compression half tights ending just above the knee, a wide high-rise waistband,
{lime} bonded seams along the outer thigh, a small side pocket and a small lightning-bolt logo.
The tights hug the thigh muscles with soft highlights.
Keep EVERYTHING else exactly the same: same person, face, hair, shirt, pose, knees and lower legs, socks, shoes,
watch, gray studio background, framing and zoom. Output: portrait 1024x1536, same semi-realistic 3D-render style.
```

### 2.5 Quần bó dài (full tights) · mã `bottom_tights_{màu}` · 80 Xu · `--region 0,0.34,1,0.92`

```text
Edit this image. Replace the character's current shorts with full-length running tights:
{deep navy} brushed thermal running tights reaching the ankles, a high-rise waistband with a back zip pocket,
reflective {silver} strips at the lower calves, ankle zips, and a small lightning-bolt logo on the hip.
The tights follow the exact leg shape and stance; the socks and shoes stay exactly the same (tights end inside the socks).
Keep EVERYTHING else exactly the same: same person, face, hair, shirt, pose, socks, shoes, watch,
gray studio background, framing and zoom. Output: portrait 1024x1536, same semi-realistic 3D-render style.
```

### 2.6 Quần lửng 3/4 (capri) · mã `bottom_capri_{màu}` · 80 Xu · `--region 0,0.34,1,0.84`

```text
Edit this image. Replace the character's current shorts with 3/4 length running capri tights
in {purple} with a subtle tonal geometric print, ending mid-calf, a wide high-rise waistband,
mesh insets behind the knees and a small lightning-bolt logo.
Keep EVERYTHING else exactly the same: same person, face, hair, shirt, pose, lower calves, socks, shoes, watch,
gray studio background, framing and zoom. Output: portrait 1024x1536, same semi-realistic 3D-render style.
```

### 2.7 Váy chạy bộ (skort, nữ) · mã `bottom_skort_{màu}` · 80 Xu

```text
Edit this image. Replace the character's current shorts with a running skort:
a flowy {coral pink} pleated running skirt over built-in compression shorts, a wide flat waistband,
the skirt hem sits at mid-thigh and moves slightly, a small lightning-bolt logo on the side.
Keep EVERYTHING else exactly the same: same person, face, hair, top, pose, socks, shoes, watch,
gray studio background, framing and zoom. Output: portrait 1024x1536, same semi-realistic 3D-render style.
```

---

## 3. Tất — `slot: socks`

Chỉ đổi màu tất thì dùng Quản trị → **Đổi màu**. Kiểu mới dùng prompt dưới đây.

**Tách lớp:**
- Tất bó bắp chân: `--region 0,0.62,1,0.94`.
- Tất cổ thấp: vùng mặc định.

### 3.1 Tất bó bắp chân (compression socks) · mã `socks_compression_{màu}` · 40 Xu

```text
Edit this image. Replace the character's socks with knee-high compression running socks
in {lime green} with a {black} graduated stripe pattern, a ribbed cuff just below the knees, a subtle
ribbed texture that hugs the calves, and a small lightning-bolt logo on the side of the calf.
The socks go into the same shoes; shoes and everything else stay exactly the same.
Keep the person, face, hair, clothes, pose, gray background, framing and zoom identical. Portrait 1024x1536,
same semi-realistic 3D-render style.
```

### 3.2 Tất cổ thấp (no-show) · mã `socks_noshow_{màu}` · 15 Xu

```text
Edit this image. Replace the character's socks with no-show running socks so the socks are barely visible
above the shoe collar: paint the ankles as natural bare skin with matching tone and lighting, and show only a thin
{white} sock edge at the shoe opening. Shoes and everything else stay exactly the same. Portrait 1024x1536,
no re-framing, same semi-realistic 3D-render style.
```

### 3.3 Tất cổ vừa có họa tiết · mã `socks_pattern_{tên}` · 20–30 Xu

```text
Edit this image. Replace the character's socks with crew-length running socks with a fun pattern:
{white socks with small red and yellow lightning bolts}, a ribbed cuff, a cushioned look.
Shoes and everything else stay exactly the same. Portrait 1024x1536, no re-framing, same 3D-render style.
```

---

## 4. Giày — `slot: shoes`

Chỉ đổi màu giày dùng **Đổi màu**. Kiểu giày mới dùng prompt dưới đây, vùng mặc định.

### 4.1 Giày carbon thi đấu (super shoe) · mã `shoes_carbon_{màu}` · 200 Xu

```text
Edit this image. Replace the character's running shoes with carbon-plated marathon racing super shoes:
a very thick, bouncy {white} foam midsole with a pronounced rocker toe, a visible {orange} carbon plate edge
along the midsole, a thin translucent {pink} engineered mesh upper, a minimal outsole and a small lightning-bolt logo
on the side. Both feet keep exactly the same position, angle and ground contact shadow.
Keep EVERYTHING else exactly the same: same person, legs, socks, clothes, pose, gray background, framing and zoom.
Output: portrait 1024x1536, same semi-realistic 3D-render style.
```

### 4.2 Giày chạy hằng ngày (daily trainer) · mã `shoes_daily_{màu}` · 60–80 Xu

```text
Edit this image. Replace the character's running shoes with cushioned daily trainer running shoes:
a {black} knit upper with a padded heel collar, a {gum-colored} rubber outsole, a medium-thick foam midsole
with a {lime} accent line, flat laces, and a small reflective lightning-bolt logo.
Both feet keep exactly the same position, angle and ground shadow. Everything else stays identical.
Portrait 1024x1536, no re-framing, same semi-realistic 3D-render style.
```

### 4.3 Giày trail · mã `shoes_trail_{màu}` · 120 Xu

```text
Edit this image. Replace the character's running shoes with rugged trail running shoes:
a {olive green and orange} abrasion-resistant mesh upper with a protective rubber toe cap, quick-lace toggle,
an aggressive lugged black outsole visible at the edges, a light dust effect on the sole edges,
and a small lightning-bolt logo. Both feet keep exactly the same position, angle and ground shadow.
Everything else stays identical. Portrait 1024x1536, no re-framing, same semi-realistic 3D-render style.
```

---

## 5. Đồ đội đầu — `slot: hat`

Mũ chạy, visor và băng đô **đổi màu** thì không cần AI: thêm một dòng vào `scripts/character/items/headwear.py` (xem [HUONG_DAN.md](HUONG_DAN.md) mục 1a). Kiểu khác dùng prompt dưới đây, vùng mặc định.

### 5.1 Mũ chạy 6 múi (kiểu Ciele GOCap / Nike AeroBill) · mã `hat_cap_{tên}` · 60 Xu

```text
Edit this image. Add ONLY a running cap on the character's head:
a lightweight unstructured 6-panel running cap in {black} technical fabric, low-profile crown, short slightly curved brim
with a {olive} contrast color under the brim, small laser-cut vent holes on the side panels, a small {lime}
lightning-bolt logo on the front, sitting low on the forehead with a soft brim shadow on the forehead.
The cap compresses the hair: no hair sticks out above the crown; side hair above the ears stays.
Keep EVERYTHING else exactly the same: face, pose, clothes, gray background, framing and zoom.
Portrait 1024x1536, same semi-realistic 3D-render style.
```

### 5.2 Mũ vành tròn chống nắng (bucket) · mã `hat_bucket_{màu}` · 80 Xu

```text
Edit this image. Add ONLY a lightweight running bucket hat on the character's head:
{sand beige} quick-dry fabric, a short downward-sloping brim all around, mesh vent band around the crown,
a thin toggle chin cord hanging loose, small lightning-bolt logo, soft shadow on the forehead.
No hair sticks out above the hat. Keep everything else exactly the same. Portrait 1024x1536, same 3D-render style.
```

### 5.3 Mũ len mùa đông (beanie) · mã `hat_beanie_{màu}` · 60 Xu

```text
Edit this image. Add ONLY a thin running beanie on the character's head:
a {dark green} lightweight merino rib-knit beanie covering the top of the head and the tops of the ears,
a reflective {silver} lightning-bolt logo on the front, natural knit texture.
Hair above the beanie disappears; bangs may peek out slightly. Keep everything else exactly the same.
Portrait 1024x1536, same semi-realistic 3D-render style.
```

### 5.4 Khăn bandana / băng đô buộc (head tie) · mã `hat_headtie_{màu}` · 30 Xu

```text
Edit this image. Add ONLY a running head tie on the character's head:
a {red} thin fabric head tie across the forehead just above the eyebrows, knotted at the back with two short tails
visible behind the head, small white lightning-bolt logo, a few front hair strands falling over it naturally.
Keep everything else exactly the same. Portrait 1024x1536, same semi-realistic 3D-render style.
```

Visor và băng đô vải bông / thun mảnh: xem mẫu có sẵn trong `headwear.py`. Nếu muốn AI vẽ, dùng mô tả:
- Visor: `a {white} running visor with a terry sweatband and short curved brim, NO crown`.
- Băng đô bông: `a {red} terry-cloth sweatband 5 cm wide across the forehead`.

---

## 6. Kính — `slot: glasses`

Vùng mặc định.

### 6.1 Kính chắn một mảnh (kiểu Oakley Sutro) · mã `glasses_shield_{màu}` · 120 Xu

```text
Edit this image. Add ONLY sport sunglasses to the character's face:
oversized single-shield running sunglasses with a {white} frame and a {mirrored ice-blue} lens covering both eyes,
resting correctly on the nose bridge, temples going back over the ears into the hair, subtle reflections of the
studio light on the lens, a small contact shadow on the cheeks.
Keep the face shape, hair, expression and everything else exactly the same. Portrait 1024x1536, same 3D-render style.
```

### 6.2 Kính gọng tròn (kiểu goodr) · mã `glasses_round_{màu}` · 50 Xu

```text
Edit this image. Add ONLY lightweight sport sunglasses to the character's face:
{matte black} frame with rounded rectangular {dark smoke polarized} lenses, non-slip matte finish,
sitting correctly on the nose, slight reflection on the lenses.
Keep everything else exactly the same. Portrait 1024x1536, same semi-realistic 3D-render style.
```

### 6.3 Kính đổi màu (photochromic) đeo trên mũ · mã `glasses_onhead_{màu}` · 80 Xu

```text
Edit this image. Add ONLY sport sunglasses pushed up on top of the character's head / forehead hairline:
a {red} half-rim frame with {amber} photochromic lenses, resting naturally on the hair.
The eyes stay fully visible. Keep everything else exactly the same. Portrait 1024x1536, same 3D-render style.
```

---

## 7. Đồng hồ — `slot: watch`

Vùng mặc định. Hai nhân vật đã đeo sẵn đồng hồ đen: prompt dưới đây **thay** đồng hồ đó.

### 7.1 Đồng hồ GPS mặt tròn · mã `watch_gps_{màu}` · 80 Xu

```text
Edit this image. Replace the character's existing wristwatch with a GPS running watch on the same wrist:
a round {titanium silver} bezel, a bright always-on screen showing a pace number "4:35", a slim {orange}
silicone strap, realistic small reflections. Same wrist position and size. Keep everything else exactly the same.
Portrait 1024x1536, no re-framing, same semi-realistic 3D-render style.
```

### 7.2 Đồng hồ thông minh mặt vuông · mã `watch_smart_{màu}` · 120 Xu

```text
Edit this image. Replace the character's existing wristwatch with a square smartwatch on the same wrist:
a rounded-square {black} case, a colorful workout screen with a heart-rate ring, a {lime} sport loop strap.
Same wrist position and size. Keep everything else exactly the same. Portrait 1024x1536, same 3D-render style.
```

---

## 8. Phụ kiện — `slot: accessory`

**Tách lớp:**
- Vùng mặc định bao ngực đến đùi.
- Bao tay chạy bộ và găng tay: `--region 0,0.2,1,0.6`.

### 8.1 Số đeo ngực (race bib) · mã `accessory_bib_{sự kiện}` · 20 Xu

```text
Edit this image. Pin a race bib on the front of the character's shirt:
white tyvek paper bib with a {red} top band reading "{RACEHUB 2026}", a large bold black number "{2026}",
four small silver safety pins at the corners, the paper slightly curved following the chest.
Keep everything else exactly the same. Portrait 1024x1536, same semi-realistic 3D-render style.
```

### 8.2 Huy chương hoàn thành · mã `accessory_medal_{sự kiện}` · quà

```text
Edit this image. Add a finisher medal hanging around the character's neck:
a shiny {gold} round medal with an embossed running figure and lightning bolt, on a wide {red and yellow} ribbon
around the neck, resting on the chest with a small shadow on the shirt.
Keep everything else exactly the same. Portrait 1024x1536, same semi-realistic 3D-render style.
```

### 8.3 Áo nước trail (hydration vest) · mã `accessory_vest_{màu}` · 180 Xu

```text
Edit this image. Add a trail running hydration vest worn over the shirt:
a lightweight {teal} stretch-mesh vest with two soft 500 ml flasks with {orange} bite valves in the chest pockets,
adjustable sternum straps, a small whistle, reflective trim. The vest follows the body and the arm pose.
Keep everything else exactly the same. Portrait 1024x1536, same semi-realistic 3D-render style.
```

### 8.4 Đai chạy bộ (running belt) · mã `accessory_belt_{màu}` · 40 Xu

```text
Edit this image. Add a slim running belt around the character's waist over the shorts:
a {black} stretchy tube belt with a zipped phone pocket in front and two small energy gel loops, a reflective logo.
Keep everything else exactly the same. Portrait 1024x1536, same semi-realistic 3D-render style.
```

### 8.5 Bao tay chạy bộ (arm sleeves) · mã `accessory_sleeves_{màu}` · 40 Xu · `--region 0,0.2,1,0.6`

```text
Edit this image. Add UV-protection running arm sleeves on both arms:
{white} lightweight compression sleeves from the upper arm to the wrist, a subtle cooling texture, a thin
{black} cuff band, small lightning-bolt logo; they follow the exact arm pose. The watch stays over the sleeve.
Keep everything else exactly the same. Portrait 1024x1536, same semi-realistic 3D-render style.
```

### 8.6 Khăn ống (neck gaiter / buff) · mã `accessory_gaiter_{màu}` · 30 Xu

```text
Edit this image. Add a tubular neck gaiter around the character's neck, pulled down (not covering the face):
thin {multicolor geometric pattern in blue and lime} stretch fabric with soft folds around the neck.
Keep everything else exactly the same. Portrait 1024x1536, same semi-realistic 3D-render style.
```

### 8.7 Bình nước cầm tay · mã `accessory_bottle_{màu}` · 30 Xu

```text
Edit this image. Add a soft handheld running water bottle held naturally in one of the character's hands:
a 350 ml soft flask in a {black} hand strap with a small pocket, the fingers wrapped around it realistically.
Keep the pose and everything else exactly the same. Portrait 1024x1536, same semi-realistic 3D-render style.
```

---

## 9. Tóc — `slot: hair`

AI vẽ lại kiểu tóc, script tách phần khác đi. Tóc **ngắn hơn** tóc gốc cũng làm được: AI tự vẽ lại nền và da ở chỗ tóc cũ.

**Tách lớp:** `--region 0,0,1,0.4`.

### 9.1 Tóc nam · mã `hair_{kiểu}` · 30–60 Xu

```text
Edit this image. Change ONLY the character's hairstyle to {a short textured crop with a slight fade on the sides}
in the same dark brown hair color. Where the old hair is removed, paint the gray studio background or scalp/forehead
naturally with matching light. Keep the face, ears, expression and everything else exactly the same.
Portrait 1024x1536, same semi-realistic 3D-render style.
```

### 9.2 Tóc nữ · mã `hair_{kiểu}` · 30–60 Xu

```text
Edit this image. Change ONLY the character's hairstyle to {a high braided ponytail with a few loose face-framing strands}
in the same hair color. Paint the background naturally where the old hair is removed.
Keep the face, expression and everything else exactly the same. Portrait 1024x1536, same 3D-render style.
```

---

## 10. Hiệu ứng — `slot: effect`

Tách lớp: vùng mặc định là cả khung.

### 10.1 Vòng hào quang dưới chân · mã `effect_aura_{màu}` · 400 Xu

```text
Edit this image. Add ONLY a glowing energy effect: a soft {lime green} glowing ring on the floor around the character's
feet with small light particles rising, and a subtle rim glow on the legs. Do not change the character or background
otherwise. Portrait 1024x1536, same style.
```

### 10.2 Vệt tốc độ (speed lines) · mã `effect_speed_{màu}` · 200 Xu

```text
Edit this image. Add ONLY dynamic speed-line streaks in {white and electric blue} flowing behind the character
on the left and right sides of the gray background, like a motion blur trail, not covering the body or face.
Everything else stays exactly the same. Portrait 1024x1536.
```

### 10.3 Pháo giấy về đích (confetti) · mã `effect_confetti` · quà sự kiện

```text
Edit this image. Add ONLY festive confetti falling around the character: small {gold, red and lime} paper pieces
and streamers in the air in front of the gray background, a few resting on the floor, none covering the face.
Everything else stays exactly the same. Portrait 1024x1536.
```

---

## 11. Prompt phụ

**Đổi màu món vừa vẽ** (dùng tiếp trong cùng cuộc trò chuyện với AI):

```text
Perfect. Now generate the exact same design again on the same original character image, changing ONLY the main color
to {navy blue} and the accent color to {orange}. Everything else, including shape, folds and position, stays identical.
```

**Làm bản cho nhân vật Nữ** (đính kèm ảnh nhân vật nữ, cùng cuộc trò chuyện):

```text
Now apply the exact same item design to this second character image (female). Adapt the fit naturally to her body
and pose; keep her face, hair and ponytail, pose, clothes, background and framing exactly the same. Portrait 1024x1536.
```

**AI lỡ đổi mặt, dáng hoặc nền:**

```text
The character's face / pose / background changed. Start again from the ORIGINAL image I attached and only add the item.
Nothing else may change, not even the lighting or zoom.
```

**Món đồ trông giả** (soát theo danh sách lỗi):

```text
Improve realism: the {cap / band} must follow the curve of the head (arched, higher at the center of the forehead),
fit the head width without floating, cast a soft shadow on the forehead, and have no gap between the crown and the brim.
Keep everything else identical.
```

**Nhờ AI nghĩ ý tưởng cho một sự kiện:**

```text
Tôi làm app chạy bộ RaceHub (Việt Nam) có nhân vật 2D mặc đồ thể thao. Gợi ý 10 vật phẩm
cho sự kiện {Quốc khánh 2/9 / Tết / giải marathon Hà Nội}, mỗi món gồm: tên tiếng Việt (≤ 30 ký tự),
ô trang phục (top, bottom, socks, shoes, hat, glasses, watch, accessory, hair, effect), độ hiếm (common, rare, epic, legendary),
giá Xu gợi ý (1 Xu ≈ 1.000đ: thường 10–30, hiếm 40–80, sử thi 120–200, huyền thoại 400)
và một câu mô tả tiếng Anh theo mẫu trong docs/vat-pham/PROMPT_AI.md.
```

### Những lỗi hay gặp làm món đồ trông "giả"

- **Vòng quanh đầu (mũ, băng đô) cong xuống hình chữ U.** Nhìn ngang tầm mắt, phải hơi cong hình vòm.
- **Món đồ rộng hơn người, lơ lửng.** Phải ôm theo hình khối, hai đầu khuất ra sau.
- **Không có bóng.** Cần bóng mềm ở chỗ tiếp xúc: dưới mép mũ, dưới cổ áo, dưới vạt áo trên quần.
- **Áo, quần không có nếp.** Vải phải gấp theo tư thế: khuỷu tay khoanh, hông, đùi.
- **Chỗ bị bỏ vải (ba lỗ, quần xẻ) còn dấu áo cũ.** Phải vẽ lại da tự nhiên.
- **Đồ màu sáng bị lấm tấm hoặc bệt màu.** Vải kỹ thuật sáng gần như trơn, có bóng nhẹ.
- **Logo thương hiệu thật lọt vào ảnh.** Yêu cầu AI xoá, chỉ giữ tia chớp RaceHub.

### Tách lớp: xử lý sự cố

| Hiện tượng | Cách xử lý |
|---|---|
| Lớp dính thêm mảng nền hoặc da | Tăng `--threshold 45`, hoặc thu `--region` |
| Món đồ bị khuyết, thủng | Giảm `--threshold 24` |
| Món đồ bị cắt mép (tay áo, ống quần) | Nới `--region` theo gợi ý ở từng mục |
| Cảnh báo "ảnh AI lệch dáng nhiều" | AI đã vẽ lại người. Tạo lại, nên dùng chọn vùng |

---

## 12. Tham khảo sản phẩm thật

Nghiên cứu tháng 9/2026.

| Loại | Mẫu tham khảo | Đặc điểm nên giữ khi thiết kế |
|---|---|---|
| Áo chạy | Áo thun kỹ thuật tay raglan, áo ba lỗ thi đấu, áo nén | Vải mỏng có lưới thoáng, đường may phẳng, logo phản quang nhỏ |
| Quần chạy | Short xẻ tà 3", short 5", 2 trong 1 (Saysky, REI Swiftland), half tight (Adidas Adizero, Nike Aeroswift), tights (Janji) | Cạp rộng phẳng, túi sau có khóa, viền phản quang |
| Giày | Carbon: Nike Vaporfly/Alphafly, Puma Fast-R, Altra Vanish Carbon · Hằng ngày: Puma Deviate Nitro · Trail: HOKA Tecton X, Adidas Terrex Agravic | Đế rất dày, mũi cong (rocker), lộ mép tấm carbon; giày trail có gai đế |
| Mũ chạy | Ciele GOCap, Nike AeroBill | Vải mỏng không cứng, thân mũ thấp, lưỡi ngắn, lỗ thoáng, mặt dưới lưỡi khác màu |
| Visor | Ciele ALZvisor, Nike AeroBill visor | Băng thấm mồ hôi + lưỡi trai, hở đỉnh đầu |
| Băng đô | Halo, Nike (bông 4–5 cm) · Buff CoolNet, Nike Flex (thun mảnh) | Dải chặn mồ hôi, không trượt |
| Kính | Oakley Sutro (mắt chắn lớn), goodr (gọng tròn, rẻ, chống trượt) | Mắt kính một mảnh là dáng đặc trưng của dân chạy |

Nguồn:
- Mũ: [Treeline Review](https://www.treelinereview.com/gearreviews/best-running-hats), [The Run Testers](https://theruntesters.com/best-running-caps/)
- Băng đô: [Garage Gym Reviews](https://www.garagegymreviews.com/best-running-headbands)
- Kính: [Treeline Review](https://www.treelinereview.com/gearreviews/best-running-sunglasses)
- Quần: [Running Warehouse](https://www.runningwarehouse.com/learningcenter/gear_guides/apparel/best-running-shorts.html), [GearJunkie](https://gearjunkie.com/endurance/running/best-running-shorts), [Treeline Review: tights](https://www.treelinereview.com/gearreviews/best-mens-running-tights)
- Giày: [RunRepeat](https://runrepeat.com/guides/best-carbon-plate-running-shoes), [Trail Runner](https://www.trailrunnermag.com/gear/shoes/best-trail-running-super-shoes/)
