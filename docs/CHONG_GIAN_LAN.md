# Chống gian lận bài chạy — quy tắc, ngưỡng, quy trình

Phiên bản bộ phân tích: `ac-2026.10.7` (`FRAUD_ENGINE_VERSION` trong `features/activity/model/fraud.ts`).
Danh mục quy tắc đầy đủ (lý do, dữ liệu đầu vào, ngưỡng, nguyên nhân báo nhầm) nằm trong code tại `FRAUD_RULES` — tài liệu này tóm tắt và giải thích nguyên tắc.

## 1. Nguyên tắc

**RaceHub không sửa dữ liệu của đối tác.** Bài từ Strava / Garmin / COROS giữ nguyên km, thời gian, pace. Hệ thống chỉ phân loại bài: **hợp lệ**, **nghi vấn** (chờ người duyệt) hoặc **bị loại** (do người duyệt quyết định, có thể khôi phục — trừ bài nhập tay).

**Luật bài từ đối tác (chỉnh sửa lần 7, Phụng chốt 06/10/2026):** *"GPS nhảy nếu Strava có GPS (mặc dù nhảy) thì RaceHub vẫn ghi nhận; chỉ không ghi nhận trường hợp nhập tay; cảnh báo chạy máy (hoàn toàn không có GPS)."*

| Loại bài | Kết quả | Ghi chú |
|---|---|---|
| Có GPS (polyline / latlng), dù GPS nhảy | **Ghi nhận ngay** | Dấu hiệu do GPS nhảy chỉ là **Cảnh báo**, không bao giờ giữ bài; km giữ nguyên theo Strava. Hiện ở "Bài có cảnh báo". |
| Nhập tay (`manual` của Strava) | **Không ghi nhận** (`REJECTED`) | Người chạy thấy lý do "Bài nhập tay không được ghi nhận." Không tính km, thử thách, BXH, vinh danh, Xu. Không khôi phục được (`MANUAL_NOT_COUNTED`). |
| Chạy máy / hoàn toàn không có GPS (trainer, VirtualRun, không polyline / latlng) | **Ghi nhận** + cảnh báo `TREADMILL` | Không chờ duyệt. Hiện ở "Bài có cảnh báo". |
| Có dấu hiệu **không** do GPS nhảy | Như cũ | Tim thấp / pace nhanh, sải chân, tốc độ cao kéo dài hay nhanh hơn kỷ lục **không** trùng lỗi GPS, pace TB nhanh hơn kỷ lục (tính trên quãng đường đã bỏ cú nhảy) → vẫn chờ duyệt theo quy tắc ≥ 1 Nghi vấn hoặc ≥ 2 Cảnh báo độc lập. |

**Dấu hiệu "do GPS nhảy"** (`isGpsJumpFlag` trong `fraud.ts`, cờ `gpsJump`): `GPS_TELEPORT`, `GPS_DISTANCE_GAIN`, và dấu hiệu tốc độ (`PACE_CURVE`, `SUSTAINED_SPEED`, `VEHICLE_BURST`) **biến mất khi tính lại** trên quãng đường đã bỏ cú nhảy ≤ 10 giây và các đoạn GPS trôi đứng riêng ≤ 30 giây (xung quanh đang chạy bộ, không có đoạn nhanh nào khác trong ±30 giây). Đi xe thật (đoạn nhanh kéo dài) vẫn còn dấu hiệu sau khi bỏ → giữ nguyên mức. Không dùng "trùng vùng lỗi GPS ±30 giây" làm ranh giới, vì đầu / cuối một đoạn đi xe hay có một "cú nhảy" ngắn — dùng ranh giới đó thì 2/12 bài đi ô tô và 1/12 bài xe máy trong bộ dữ liệu lọt qua.

| Nguyên tắc | Cách làm |
|---|---|
| Mỗi quy tắc có lý do và dữ liệu đầu vào cụ thể | `FRAUD_RULES[code]`: `reason`, `inputs`, `falsePositives`. Mỗi cờ lưu `evidence` (số đo cụ thể: tốc độ, thời lượng, mốc giây). |
| Ngưỡng tốc độ đối chiếu dữ liệu thực tế | Ngưỡng "đủ căn cứ loại" dựa trên **kỷ lục thế giới** theo thời lượng (+5% sai số GPS). Ngưỡng cảnh báo được đo trên bộ dữ liệu có nhãn (mục 4) và theo dõi tỷ lệ loại nhầm thật (mục 6). |
| Tách ngưỡng cảnh báo và ngưỡng đủ căn cứ loại | 4 mức: **Ghi chú** → **Cảnh báo** → **Nghi vấn** → **Đủ căn cứ loại**. Chỉ "Đủ căn cứ loại" là bằng chứng mạnh; kể cả vậy hệ thống chỉ **giữ bài chờ duyệt**, người duyệt mới quyết định loại. |
| Không dùng GPS gap đơn thuần để kết luận gian lận | Khoảng mất tín hiệu chỉ được đánh dấu là *vùng lỗi GPS*. Bài trong app: km không xác minh được hỏi người chạy ("chỉ tính phần có GPS"), không gắn cờ gian lận. |
| Không dùng một điểm GPS để loại cả bài | Mọi tốc độ tính trên **cửa sổ trượt 30 giây**. Cú nhảy GPS ≤ 10 giây được bỏ qua *khi tính tốc độ* (`despike`), km của bài vẫn giữ nguyên. Strava không có streams → "vận tốc tối đa" một điểm chỉ là **Ghi chú**. |
| Kiểm tra các dấu hiệu có độc lập không | Cờ trùng vùng lỗi GPS (±30 giây) bị **hạ một mức** và gắn nhóm `GPS_ERROR`. Các cờ GPS trùng thời điểm nhau đếm là **một** nhóm. Giữ bài khi có ≥ 1 Nghi vấn/Đủ căn cứ, hoặc ≥ 2 nhóm Cảnh báo **độc lập**. Từ lần 7: nhóm `GPS_JUMP` (dấu hiệu do GPS nhảy, tối đa Cảnh báo) và cảnh báo chạy máy **không** được tính vào kết luận. |
| Bộ dữ liệu đo tỷ lệ phân loại sai | `fraudCorpus.ts` (18 kiểu bài × 12, có hạt giống cố định) + `fraud.eval.test.ts` (chạy trong CI). |
| Ghi lý do loại từng bài | `activity_analyses.flags` (mã, mức, nguồn, bằng chứng) + `activity_decisions.reason`. |
| Lưu dữ liệu gốc, kết quả phân tích, lịch sử quyết định | Bảng `activity_analyses` (kèm streams rút gọn khi có cờ) và `activity_decisions` (SYSTEM / REVIEWER / RESTORE). |
| Khôi phục bài loại nhầm | RPC `restore_activity` + mục "Bài đã loại" ở Quản trị → Duyệt bài và CLB → Duyệt bài chạy. |
| Ban quản trị biết bài đã ghi nhận nhưng có cảnh báo | RPC `warned_activities` (013400) + mục **"Bài có cảnh báo (30 ngày)"** ngay dưới "Bài đã loại" ở Quản trị → Người dùng → Duyệt bài chạy (toàn hệ thống, admin) và CLB → Duyệt bài chạy (Ban quản trị CLB: chỉ thành viên CLB mình). Lọc: GPS nhảy / Chạy máy / Khác; bấm để mở bài. |

## 2. Quy tắc và ngưỡng

| Mã | Nguồn | Cảnh báo | Nghi vấn | Đủ căn cứ loại |
|---|---|---|---|---|
| `PACE_CURVE` — nhanh hơn kỷ lục thế giới | GPS | do GPS nhảy | khi trùng lỗi GPS (không do GPS nhảy) | 1′ > 8,6 m/s · 2′ > 7,9 · 5′ > 7,0 · 10′ > 6,8 · 20′ > 6,5 · 1 h > 6,1 · 2 h > 5,85 (×1,05) |
| `SUSTAINED_SPEED` — giữ tốc độ cao lâu | GPS | ≥ 17 km/h ≥ 3′; hoặc do GPS nhảy | ≥ 20 km/h ≥ 2′ | — |
| `VEHICLE_BURST` — giống đi xe | GPS | do GPS nhảy (cả "vận tốc tối đa" một điểm khi không có phân tích) | ≥ 25 km/h ≥ 30″ | — |
| `GPS_TELEPORT` — GPS nhảy | GPS | ≥ 3 lần (không bao giờ giữ bài) | — | — |
| `GPS_DISTANCE_GAIN` — vị trí dịch chuyển | GPS | một cú dịch chuyển ≥ 1 km trong ≤ 10 giây (GPS lạc rồi quay về: chỉ ghi chú) | — | — |
| `STRIDE` — sải chân | GPS+CADENCE | > 1,8 m ≥ 90″ | > 2,1 m ≥ 90″ | — |
| `HR_PACE` — tim thấp / pace nhanh | GPS+HR | 3–5′ | ≥ 5′ | — |
| `HISTORY` — khác thường ngày | HISTORY | ≥ 5 độ lệch chuẩn | — | — |
| `MANUAL` — nhập tay | DEVICE | — | — | luôn — **không ghi nhận** ngay khi đồng bộ (lần 7) |
| `TREADMILL` — chạy máy / không có GPS | DEVICE | luôn — bài vẫn ghi nhận (lần 7) | — | — |

Ngưỡng tốc độ (`SUSTAINED_SPEED`, `VEHICLE_BURST`, nhảy GPS) do admin chỉnh ở **Chính sách vận hành**, không cần sửa code.

### Cú nhảy GPS và kiểu gian lận "đi tắt"

- **GPS nhảy là bình thường.** Ở đô thị, dưới cầu hay giữa nhà cao tầng, vị trí thường lạc vài chục đến vài trăm mét trong 1–3 giây rồi quay về. Strava cộng thêm một ít km do việc này. Trường hợp này chỉ được **ghi chú**: bài vẫn hợp lệ và km giữ nguyên.
- **"Đi tắt" là gì:** tuyến chạy bị cắt rồi nối lại, ví dụ:
  - sửa hoặc ghép file GPX trước khi tải lên Strava;
  - dùng app giả vị trí;
  - tắt rồi bật đồng hồ ở chỗ khác mà thiết bị vẫn nối thẳng hai điểm.

  Dấu hiệu là vị trí **dịch chuyển một lần ≥ 1 km trong vài giây** (≥ 360 km/h), không quay về, rồi chạy tiếp bình thường từ chỗ mới. Trước và sau đó đều là tốc độ chạy bộ, nên các luật tốc độ theo đoạn 30 giây không thấy được.
- **Cách xử lý (chỉnh sửa lần 6–7, 06/10/2026):** bài có GPS được **ghi nhận ngay** dù GPS nhảy; cú dịch chuyển chỉ là **Cảnh báo** và không bao giờ giữ bài (lần 6 vẫn đếm nó là một cảnh báo độc lập và chỉ hạ một mức dấu hiệu tốc độ do GPS trôi — nên bài GPS nhảy vẫn có thể chờ duyệt; lần 7 bỏ hẳn), km giữ nguyên. Đánh đổi đã chấp nhận: kiểu gian lận đi tắt không còn bị giữ tự động. Người duyệt xem bản đồ và bằng chứng (`maxJumpM`: cú nhảy lớn nhất; `addedM`: tổng km do nhảy; `withoutJumpsM`: km nếu bỏ các cú nhảy, chỉ để tham khảo), rồi quyết định **duyệt** hoặc **loại**. Nếu loại nhầm thì có thể khôi phục.
- **Trường hợp dễ báo nhầm:** đồng hồ bắt GPS sai lúc mới bật, hoặc ra khỏi hầm dài. Chính vì vậy dấu hiệu này chỉ là Cảnh báo.
- **Máy chủ (013400):** pace TB "nhanh hơn kỷ lục" được kiểm trên quãng đường đã bỏ cú nhảy (`analysis.clean_distance_m`) — GPS nhảy cộng thêm km không còn làm bài chờ duyệt.

## 3. Quy trình quyết định

1. **Phân tích** (Strava: `strava.server.ts` → `analyzeRun`; bài trong app: kiểm tra trên máy chủ). Kết quả lưu vào `activity_analyses`.
2. **Hệ thống** có ba kết quả: *ghi nhận* (có thể kèm cảnh báo), *giữ chờ duyệt*, hoặc *không ghi nhận* — chỉ bài nhập tay (lần 7). Ghi vào `activity_decisions` với `actor_kind = SYSTEM`.
3. **Người duyệt** (ban điều hành CLB / admin) xem cờ theo mức kèm bằng chứng → duyệt hoặc loại (`REVIEWER`).
4. **Khôi phục** (`RESTORE`): người duyệt (không phải chủ bài) nhập lý do ≥ 5 ký tự. Bài chuyển sang hợp lệ, Xu / XP / thử thách được tính lại bằng trigger thưởng hiện có. Bị chặn (`OVERLAPS_COUNTED_RUN`) nếu trùng thời gian với bài khác đã được tính.
5. Chủ bài xem được lịch sử quyết định của bài mình (`activity_audit`), không xem được chi tiết nội bộ.

## 4. Kết quả đánh giá trên bộ dữ liệu có nhãn

`npx vitest run features/activity/model/fraud.eval.test.ts` — 12 bài mỗi kiểu:

| Nhóm | Số bài | Chuyển người duyệt | Ghi chú |
|---|---|---|---|
| Bài thật phong trào (7 kiểu: đèn đỏ, tempo, 8×400 m, 5×1 km pace 3:15, 10 km pace 3:05, trail, không cảm biến) | 84 | **0%** | |
| Bài thật có lỗi GPS (nhảy điểm, trôi nhà cao tầng, mất tín hiệu, kết hợp biến tốc) | 48 | **0%** | chỉ ghi chú, km giữ nguyên |
| Gian lận rõ (ô tô 5′, đạp xe, xe điện, xe máy từng đoạn) | 48 | **100%** chuyển duyệt | |
| Đi tắt 2 km (tuyến nhảy) | 12 | 0% | **Chấp nhận từ lần 6**: chỉ Cảnh báo, bài được ghi nhận |
| GPS nhảy kiểu khác (`fraud.test.ts`, lần 7): nhiều cú 1,2 km, 300 m rồi quay về, dịch chuyển 600 m–1 km trải 15–20 giây, trôi ra rồi về, 10 cú 200 m | 6 | **0%** | ghi nhận, Cảnh báo được lưu |
| VĐV đỉnh cao 5 km pace 2:50 | 12 | 100% chuyển duyệt | Chấp nhận: hiếm, người duyệt xác nhận |
| Ngồi xe kẹt đường 13–15 km/h | 12 | 0% | **Giới hạn đã biết**: tốc độ như người chạy |

CI chặn nếu bài thật hoặc bài lỗi GPS bị giữ > 0%, hoặc gian lận rõ phát hiện < 95%.

## 5. Giới hạn

- Bộ dữ liệu hiện là **mô phỏng**. Ngưỡng sẽ được hiệu chỉnh tiếp bằng số liệu thật ở mục 6.
- Không phân biệt được xe đi rất chậm với người chạy nếu không có nhịp tim / cadence.
- VĐV đỉnh cao luôn bị chuyển duyệt.

## 6. Theo dõi tỷ lệ loại nhầm trên dữ liệu thật

Quản trị → Duyệt bài → thẻ thống kê (`fraud_review_stats`, 90 ngày):
- **Tỷ lệ giữ nhầm** = (bài bị giữ rồi được duyệt + bài được khôi phục) / số bài bị giữ đã có kết luận.
- **Theo quy tắc**: số lần mỗi mã cờ dẫn tới giữ bài và tỷ lệ nhầm của mã đó → quy tắc nào nhầm nhiều thì nới ngưỡng ở Chính sách vận hành.

Khi đổi quy tắc trong code: tăng `FRAUD_ENGINE_VERSION`, chạy lại `fraud.eval.test.ts`, so bảng kết quả.
