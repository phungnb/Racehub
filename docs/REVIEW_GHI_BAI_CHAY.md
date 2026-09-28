# Review mã nguồn: ghi bài chạy (GPS tracking)

Ngày: 28/09/2026 · Phạm vi: `features/run` (bộ máy GPS, phiên chạy, lưu tạm, hàng chờ, màn Chạy) + khung app.

## Kiến trúc hiện tại (giữ nguyên)

```
Nguồn vị trí (location.ts: trình duyệt / plugin nền native)
  → RunSession (session.ts, thuần TS): pha chạy, đồng hồ, tự tạm dừng, đứng lâu, từng km, lưu tạm, payload
      → TrackEngine (tracker.ts, thuần TS): Kalman 2 trục + lọc đứng yên / rung / nhảy điểm / mất tín hiệu
  → useRunTracker (hook React): nối nguồn vị trí + đồng hồ + giọng HLV + lưu máy + gửi máy chủ
  → RunScreen (giao diện)
Máy chủ tự tính lại km từ tuyến + chống gian lận (không tin số app gửi).
```

Điểm mạnh: logic tính toán tách khỏi React, test được bằng mô phỏng; đồng hồ tính theo mốc thời gian thật (không đếm tích tắc, đúng cả khi tab bị treo); lưu tạm theo khối 100 điểm (bài 3 giờ vẫn chỉ ghi vài KB mỗi lần); mất mạng lúc lưu thì cất vào hàng chờ; điểm từ app giả lập GPS bị bỏ.

## 1. Lỗi logic và bug

| # | Vấn đề | Mức | Trạng thái |
|---|---|---|---|
| 1 | **Bài chạy lưu trên máy không gắn tài khoản.** Đăng xuất (không xoá dữ liệu máy) rồi người khác đăng nhập → hàng chờ tự gửi bài của người trước vào tài khoản người sau (nhận Xu, XP của người khác); màn Chạy cũng hỏi khôi phục bài của người khác | Cao | **Đã sửa**: bài lưu tạm và hàng chờ ghi `uid`; chỉ khôi phục, đếm, gửi bài của đúng tài khoản |
| 2 | **Điểm GPS nhảy bị đưa vào bộ lọc Kalman rồi mới loại** (kiểm tra "TELEPORT" nằm sau bước cập nhật) → vận tốc ước lượng bị kéo lệch, vài giây sau vẫn cộng một phần cú nhảy. Mô phỏng: chạy 1,8 km có điểm nhảy 80 m mỗi 45 giây → **dư 95 m (5 %)** | Cao | **Đã sửa**: loại điểm trước khi cập nhật (so với vị trí dự đoán ± 5 lần độ bất định, "innovation gating"); 3 điểm lệch liên tiếp thì nhận (đổi hướng thật). Sai số còn < 15 m. Có test chứng minh |
| 3 | **Thanh điều hướng trên / dưới vẫn hiện khi đang chạy**: chạm nhầm → rời màn Chạy → dừng ghi GPS (bài còn trong bản lưu tạm nhưng mất đoạn tới lúc mở lại) | Cao | **Đã sửa**: ẩn cả hai thanh khi đang tìm GPS / chạy / tạm dừng |
| 4 | Tạm dừng vẫn hiện "Pace hiện tại" cũ (vd 12:40) | Thấp | **Đã sửa** |
| 5 | Lời nhắc "đứng yên 10 phút / 30 phút" ghi cứng, trong khi admin đổi được mốc ở Chính sách vận hành | Thấp | **Đã sửa**: lấy theo chính sách |
| 6 | Split km tính thời gian cả đoạn chứa mốc km (sai tối đa ~1 đoạn, 4–5 giây) | Thấp | Chấp nhận; có thể nội suy theo tỷ lệ quãng |
| 7 | Bài siêu dài (> ~120 km ở bước lọc 6 m) có thể vượt 20.000 điểm → máy chủ từ chối, bài kẹt ở hàng chờ | Thấp | Đề xuất: thưa điểm trước khi gửi khi > 18.000 (giữ `distance_m`) |
| 8 | Lỗi máy chủ cố định (vd dữ liệu hỏng) được coi như "mất mạng" → thử lại tới 7 ngày | Thấp | Đề xuất: phân biệt lỗi 5xx tạm thời và lỗi nghiệp vụ |

## 2. Hiệu năng và pin

| Điểm | Đánh giá | Trạng thái |
|---|---|---|
| GPS độ chính xác cao, 1 điểm / giây | Cần cho km chính xác; bộ máy tự lọc rung nên không cần `distanceFilter` | Giữ |
| **Tạm dừng lâu vẫn bật GPS toàn công suất** (kể cả khi tự tạm dừng sau 30 phút đứng yên — quên tắt app là hết pin) | Tốn pin | **Đã sửa**: tạm dừng quá 5 phút thì tắt GPS; bấm Tiếp tục bật lại |
| Vẽ lại màn hình ~2 lần / giây (1 lần theo điểm GPS + 1 lần theo đồng hồ) | Nhẹ (một màn hình, không danh sách dài) | Giữ |
| Tính pace 30 giây gần nhất mỗi giây | Chỉ duyệt ~30 điểm cuối | Giữ |
| Lưu tạm 5 giây / lần, ghi khối cuối (≤ 100 điểm) | Tốt | Giữ |
| Trình duyệt: giữ màn hình sáng bằng Wake Lock + video câm (iPhone) | Tốn pin hơn app cài (màn hình phải sáng); có chế độ "bỏ túi" màn đen cho OLED | Khuyên dùng app cài để chạy nền |
| Bộ nhớ: điểm tuyến lưu gọn (toạ độ 6 chữ số, bỏ trường trống) | Bài 3 giờ ~2.700 điểm, vài trăm KB | Giữ |

## 3. Kiến trúc và mã

- Tách `useRunTracker` (318 dòng) thành các phần một việc: `model/coach.ts` (câu giọng HLV, hàm thuần + test), `api/submitRun.ts` (gửi / cất hàng chờ, trả kết quả dạng union), `hooks/useStoredFlag.ts` (công tắc nhớ trên máy), `hooks/useRunActive.ts` (báo khung app đang chạy). Hook chính chỉ còn nối các phần; 5 ref rời gộp thành một `latest`; bật / tắt GPS gom vào `startWatch` / `stopAll`.
- Giữ nguyên logic: toàn bộ test phiên chạy, bộ máy GPS, lưu tạm vẫn đạt; thêm test cho phần mới.
- Còn nên làm: `RunScreen.tsx` (~500 dòng) tách mỗi pha thành một file (`IdleView`, `LiveView`, `SummaryView`).

## 4. Bảo mật và ngoại lệ

| Tình huống | Xử lý |
|---|---|
| Mất mạng lúc lưu | Cất vào hàng chờ trên máy, tự gửi khi có mạng / mỗi phút; gửi trùng máy chủ bỏ qua |
| App bị đóng giữa chừng | Mở lại hỏi khôi phục (bản lưu 5 giây / lần) |
| Mất GPS > 15 giây | Báo "Mất tín hiệu GPS"; đoạn mất được ghi lại, chỉ nối khi tốc độ hợp lý |
| Từ chối quyền vị trí | Dừng, báo, app cài có nút mở cài đặt |
| Dữ liệu vị trí trên máy | localStorage, xoá sau khi gửi; hàng chờ tối đa 7 ngày; nay gắn tài khoản. Không mã hoá (trình duyệt không có kho an toàn); xoá tài khoản thì xoá hết |
| Giả lập GPS (app cài) | Điểm `simulated` bị bỏ; máy chủ chống gian lận thêm một lớp |

## 5. Trải nghiệm khi đang chạy

Đã làm: số km rất lớn; thời gian / pace to hơn (từ 24 lên 28–36 px), nhãn thẳng hàng; lời nhắc chỉ còn một dòng chữ to (trước là đoạn văn 2–3 dòng chữ 12 px khó đọc khi chạy); ẩn thanh điều hướng.

Đề xuất tiếp:
1. **Kết thúc nhầm không quay lại được**: sau Tạm dừng, một chạm Kết thúc là xong. Nên cho "Chạy tiếp" ngay ở màn tổng kết (như Strava) hoặc giữ 1 giây để kết thúc.
2. Rung nhẹ mỗi km (giọng nói có thể không nghe được khi đeo tai nghe nhạc / máy không có giọng tiếng Việt).
3. Tuỳ chọn nền sáng tương phản cao khi chạy dưới nắng.
4. Chế độ bỏ túi nên hiện pace hiện tại thay vì pace trung bình (người chạy cần biết đang nhanh hay chậm).
