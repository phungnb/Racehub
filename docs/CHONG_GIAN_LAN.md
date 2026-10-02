# Chống gian lận bài chạy — quy tắc, ngưỡng, quy trình

Phiên bản bộ phân tích: `ac-2026.10.3` (`FRAUD_ENGINE_VERSION` trong `features/activity/model/fraud.ts`).
Danh mục quy tắc đầy đủ (lý do, dữ liệu đầu vào, ngưỡng, nguyên nhân báo nhầm) nằm trong code tại `FRAUD_RULES` — tài liệu này tóm tắt và giải thích nguyên tắc.

## 1. Nguyên tắc

| Nguyên tắc | Cách làm |
|---|---|
| Mỗi quy tắc có lý do và dữ liệu đầu vào cụ thể | `FRAUD_RULES[code]`: `reason`, `inputs`, `falsePositives`. Mỗi cờ lưu `evidence` (số đo cụ thể: tốc độ, thời lượng, mốc giây). |
| Ngưỡng tốc độ đối chiếu dữ liệu thực tế | Ngưỡng "đủ căn cứ loại" dựa trên **kỷ lục thế giới** theo thời lượng (+5% sai số GPS). Ngưỡng cảnh báo được đo trên bộ dữ liệu có nhãn (mục 4) và theo dõi tỷ lệ loại nhầm thật (mục 6). |
| Tách ngưỡng cảnh báo và ngưỡng đủ căn cứ loại | 4 mức: **Ghi chú** → **Cảnh báo** → **Nghi vấn** → **Đủ căn cứ loại**. Chỉ "Đủ căn cứ loại" là bằng chứng mạnh; kể cả vậy hệ thống chỉ **giữ bài chờ duyệt**, người duyệt mới quyết định loại. |
| Không dùng GPS gap đơn thuần để kết luận gian lận | Khoảng mất tín hiệu chỉ được đánh dấu là *vùng lỗi GPS*. Bài trong app: km không xác minh được hỏi người chạy ("chỉ tính phần có GPS"), không gắn cờ gian lận. |
| Không dùng một điểm GPS để loại cả bài | Mọi tốc độ tính trên **cửa sổ trượt 30 giây**. Cú nhảy GPS ≤ 10 giây bị bỏ khỏi quãng đường (`despike`). Strava không có streams → "vận tốc tối đa" một điểm chỉ là **Ghi chú**. |
| Kiểm tra các dấu hiệu có độc lập không | Cờ trùng vùng lỗi GPS (±30 giây) bị **hạ một mức** và gắn nhóm `GPS_ERROR`. Các cờ GPS trùng thời điểm nhau đếm là **một** nhóm. Giữ bài khi có ≥ 1 Nghi vấn/Đủ căn cứ, hoặc ≥ 2 nhóm Cảnh báo **độc lập**. |
| Bộ dữ liệu đo tỷ lệ phân loại sai | `fraudCorpus.ts` (18 kiểu bài × 12, có hạt giống cố định) + `fraud.eval.test.ts` (chạy trong CI). |
| Ghi lý do loại từng bài | `activity_analyses.flags` (mã, mức, nguồn, bằng chứng) + `activity_decisions.reason`. |
| Lưu dữ liệu gốc, kết quả phân tích, lịch sử quyết định | Bảng `activity_analyses` (kèm streams rút gọn khi có cờ) và `activity_decisions` (SYSTEM / REVIEWER / RESTORE). |
| Khôi phục bài loại nhầm | RPC `restore_activity` + mục "Bài đã loại" ở Quản trị → Duyệt bài và CLB → Duyệt bài chạy. |

## 2. Quy tắc và ngưỡng

| Mã | Nguồn | Cảnh báo | Nghi vấn | Đủ căn cứ loại |
|---|---|---|---|---|
| `PACE_CURVE` — nhanh hơn kỷ lục thế giới | GPS | — | khi trùng lỗi GPS | 1′ > 8,6 m/s · 2′ > 7,9 · 5′ > 7,0 · 10′ > 6,8 · 20′ > 6,5 · 1 h > 6,1 · 2 h > 5,85 (×1,05) |
| `SUSTAINED_SPEED` — giữ tốc độ cao lâu | GPS | ≥ 17 km/h ≥ 3′ | ≥ 20 km/h ≥ 2′ | — |
| `VEHICLE_BURST` — giống đi xe | GPS | — | ≥ 25 km/h ≥ 30″ | — |
| `GPS_TELEPORT` — GPS nhảy | GPS | ≥ 3 lần | — | — |
| `GPS_DISTANCE_GAIN` — km do GPS nhảy | GPS | phần bỏ ≥ 500 m và ≥ 10% | — | — |
| `STRIDE` — sải chân | GPS+CADENCE | > 1,8 m ≥ 90″ | > 2,1 m ≥ 90″ | — |
| `HR_PACE` — tim thấp / pace nhanh | GPS+HR | 3–5′ | ≥ 5′ | — |
| `HISTORY` — khác thường ngày | HISTORY | ≥ 5 độ lệch chuẩn | — | — |
| `MANUAL`, `TREADMILL` | DEVICE | — | luôn chuyển người duyệt | — |

Ngưỡng tốc độ (`SUSTAINED_SPEED`, `VEHICLE_BURST`, nhảy GPS) do admin chỉnh ở **Chính sách vận hành**, không cần sửa code.

**Sửa km thay vì loại bài:** khi phần bị bỏ do cú nhảy GPS ≥ max(200 m, 3%), máy chủ ghi km đã làm sạch và lưu ghi chú "Bỏ X m do GPS nhảy…". Cách này vô hiệu hoá luôn kiểu gian lận "nhảy tuyến để đi tắt".

## 3. Quy trình quyết định

1. **Phân tích** (Strava: `strava.server.ts` → `analyzeRun`; bài trong app: kiểm tra trên máy chủ). Kết quả lưu vào `activity_analyses`.
2. **Hệ thống** chỉ có hai kết quả: *ghi nhận* hoặc *giữ chờ duyệt*. Ghi vào `activity_decisions` với `actor_kind = SYSTEM`.
3. **Người duyệt** (ban điều hành CLB / admin) xem cờ theo mức kèm bằng chứng → duyệt hoặc loại (`REVIEWER`).
4. **Khôi phục** (`RESTORE`): người duyệt (không phải chủ bài) nhập lý do ≥ 5 ký tự. Bài chuyển sang hợp lệ, Xu / XP / thử thách được tính lại bằng trigger thưởng hiện có. Bị chặn (`OVERLAPS_COUNTED_RUN`) nếu trùng thời gian với bài khác đã được tính.
5. Chủ bài xem được lịch sử quyết định của bài mình (`activity_audit`), không xem được chi tiết nội bộ.

## 4. Kết quả đánh giá trên bộ dữ liệu có nhãn

`npx vitest run features/activity/model/fraud.eval.test.ts` — 12 bài mỗi kiểu:

| Nhóm | Số bài | Bị giữ / sửa km | Ghi chú |
|---|---|---|---|
| Bài thật phong trào (7 kiểu: đèn đỏ, tempo, 8×400 m, 5×1 km pace 3:15, 10 km pace 3:05, trail, không cảm biến) | 84 | **0%** | |
| Bài thật có lỗi GPS (nhảy điểm, trôi nhà cao tầng, mất tín hiệu, kết hợp biến tốc) | 48 | **0%** | km nhảy được bỏ, không giữ bài |
| Gian lận rõ (ô tô 5′, đạp xe, xe điện, xe máy từng đoạn, nhảy tuyến 2 km) | 60 | **100%** | nhảy tuyến được xử lý bằng sửa km |
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
