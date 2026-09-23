# Nhân vật 3D RaceHub: chuẩn asset cho họa sĩ 3D

Tài liệu này dành cho **họa sĩ / studio 3D** làm nhân vật và vật phẩm cho RaceHub, và cho **admin** khi đưa vật phẩm mới lên shop. App đã có sẵn trình hiển thị, tủ đồ, shop và bộ asset khởi đầu. Họa sĩ chỉ cần giao file GLB đúng chuẩn bên dưới. Không cần sửa code.

## 1. Tổng quan

- Nhân vật gồm **một thân** (nam hoặc nữ, có bộ xương và hoạt ảnh) cộng **các món đồ**, mỗi món là **một file GLB riêng** gắn vào xương của thân.
- Mỗi món có 2 bản: `…_male.glb` và `…_female.glb`. Ai cũng mặc được mọi món.
- Một mô hình dùng cho nhiều màu: app tự đổi màu theo từng vật phẩm trong shop (xem mục 4).
- Bộ asset khởi đầu nằm trong `public/models/character/`, được sinh bằng `npm run models` (`scripts/character/build-models.mjs`). Đây là bản tạm để app chạy. Họa sĩ thay dần bằng bản đẹp hơn.

## 2. Hệ trục và kích thước

| Mục | Quy định |
|---|---|
| Định dạng | glTF 2.0 nhị phân (`.glb`), vật liệu PBR Metallic-Roughness |
| Trục | **Y hướng lên**, nhân vật **nhìn về +Z**, bên trái nhân vật ở +X |
| Đơn vị | mét. Nam cao khoảng 1,73 m, nữ khoảng 1,62 m, **bàn chân chạm y = 0** |
| Tư thế nghỉ | tay buông xuôi, hơi dang (A-pose khoảng 7°), đứng thẳng |
| Dung lượng | thân ≤ 1,5 MB; mỗi món ≤ 300 KB; texture ≤ 1024², nén KTX2/WebP nếu có |
| Số tam giác | thân ≤ 15.000; mỗi món ≤ 4.000 |

## 3. Bộ xương (tên theo Mixamo)

App tìm xương theo tên và chấp nhận cả khi có hoặc không có tiền tố `mixamorig:`. Các tên bắt buộc:

```
Hips
├─ Spine ─ Spine1 ─ Spine2 ─┬─ Neck ─ Head
│                            ├─ LeftShoulder ─ LeftArm ─ LeftForeArm ─ LeftHand
│                            └─ RightShoulder ─ RightArm ─ RightForeArm ─ RightHand
├─ LeftUpLeg ─ LeftLeg ─ LeftFoot ─ LeftToeBase
└─ RightUpLeg ─ RightLeg ─ RightFoot ─ RightToeBase
```

- Có thể rig bằng **Mixamo** (tải thân lên mixamo.com để tự gắn xương) hoặc Blender + Rigify rồi đổi tên xương cho đúng.
- Node gốc của thân nên tên `Root`. Hiệu ứng dưới chân (vòng hào quang) gắn vào `Root`.
- File thân **phải kèm 3 hoạt ảnh** đúng tên: `Idle` (đứng thở, lặp), `Run` (chạy, lặp khoảng 0,7 giây mỗi chu kỳ), `Wave` (vẫy tay, khoảng 1,6 giây). Có thể lấy từ thư viện hoạt ảnh Mixamo.

## 4. Vật liệu: tên là "hợp đồng" với app

| Tên vật liệu | App làm gì |
|---|---|
| `tint` | tô **màu chính** của vật phẩm (cột `color`) |
| `tint2` | tô **màu phụ**: viền, logo, đế (cột `color2`) |
| `skin` | tô theo **màu da** người chơi chọn (trên thân và trên món đồ lộ da) |
| `hair` | tô theo **màu tóc** người chơi chọn |
| tên khác | giữ nguyên màu và texture của họa sĩ (vd. `sole`, `lens`, `metal`, `gold`) |

- Nếu vật liệu `tint` có texture, app nhân màu vào texture. Vì vậy vẽ texture tông xám sáng để đổi màu đẹp.

## 5. Cách làm một món đồ

Mỗi món đồ là **một ô trang phục**: `hair`, `top`, `bottom`, `socks`, `shoes`, `hat`, `glasses`, `watch`, `accessory`, `effect`. Có 2 cách làm, tùy loại đồ:

**A. Đồ cứng: mũ, kính, đồng hồ, phụ kiện, tóc.**
- Trong GLB, đặt các phần của món đồ vào một node **đặt tên đúng xương** cần gắn. Ví dụ node `Head` chứa mũ, node `LeftForeArm` chứa đồng hồ. Node có thể nằm trong một lớp bọc tên bất kỳ.
- Tọa độ các phần tính **theo không gian của xương đó** trên thân chuẩn. Cách dễ nhất: mở file thân, làm món đồ làm con của xương, rồi xuất riêng.

**B. Đồ co giãn theo cơ thể: áo, quần, tất, giày.**
- Làm `SkinnedMesh` rig vào **đúng bộ xương của file thân RaceHub** (dùng chính file `body_male.glb` / `body_female.glb` làm gốc để skin). App sẽ buộc lại mesh vào xương của nhân vật đang hiển thị.
- Làm theo cách A cũng được, như bộ khởi đầu đang làm (mỗi phần gắn vào một xương).

**Quy ước đặc biệt:** phần tóc đặt tên bắt đầu bằng `hide_hat_`, ví dụ tóc dựng hay búi cao, sẽ được **tự ẩn khi người chơi đội mũ**.

**Tên file:** `<ô>_<kiểu>_<male|female>.glb`, ví dụ `top_tee_male.glb`, `hat_cap_female.glb`. Kiểu (`tee`, `cap`…) chính là `model_key` trong CSDL.

## 6. Đưa vật phẩm lên shop (admin)

1. Đặt file vào `public/models/character/`. Có thể dùng CDN hoặc Supabase Storage: khi đó điền URL vào `model_urls`.
2. Thêm một dòng vào bảng `avatar_items` (SQL Editor):
   ```sql
   insert into public.avatar_items (code, name, description, category, rarity, asset_url, model_key, color, color2, price_xu, unlock_level)
   values ('top_tee_vn', 'Áo cờ đỏ sao vàng', 'Mừng 2/9', 'top', 'epic', 'top_tee', 'top_tee', '#da251d', '#ffcd00', 120, 1);
   -- Asset riêng trên CDN:
   -- update public.avatar_items set model_urls = '{"male": "https://…/top_x_male.glb", "female": "https://…/top_x_female.glb"}' where code = 'top_tee_vn';
   ```
3. Các cột:
   - `price_xu = 0` và `unlock_level > 1`: **quà lên cấp**, tự vào tủ đồ khi người chơi đạt cấp đó.
   - `is_default = true`: mọi người có sẵn.
   - `is_active = false`: ẩn khỏi shop. Người đã mua vẫn giữ.
4. Không cần deploy lại. Người chơi mở Tủ đồ là thấy vật phẩm mới.

## 7. Kiểm tra trước khi giao

- Mở file tại https://gltf-viewer.donmccurdy.com: đúng hướng (+Z), đúng kích thước, không lỗi vật liệu.
- Tên xương, tên node và tên vật liệu đúng như mục 3–5.
- Ghép thử với thân chuẩn ở cả 3 hoạt ảnh `Idle` / `Run` / `Wave`: áo không bị thủng, tóc không xuyên mặt, mũ không chìm vào tóc.
