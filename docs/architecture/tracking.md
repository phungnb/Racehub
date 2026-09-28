# Ghi bài chạy (Tracking Engine)

Giao diện chỉ gửi lệnh và hiển thị. Mọi phép tính và trạng thái nằm trong phần lõi thuần TypeScript: không phụ thuộc React, trình duyệt hay nền tảng, và có test.

| Tầng | File | Việc |
|---|---|---|
| Nguồn vị trí | `features/run/model/location.ts` | Trình duyệt dùng `navigator.geolocation`. App cài dùng Core Location (iOS) hoặc Fused Location (Android) qua plugin background-geolocation, nên vẫn ghi khi tắt màn hình. iOS đặt `activityType = .fitness` (`scripts/patch-native-gps.mjs`) |
| Lọc điểm + quãng đường | `features/run/model/tracker.ts` (`TrackEngine`) | Lọc Kalman theo sai số từng điểm, trộn vận tốc Doppler, phát hiện đứng yên, bước tích luỹ thích ứng, loại nhảy điểm. Mất tín hiệu quá 20 giây thì chỉ nối khi tốc độ suy ra hợp lý và luôn ghi lại (`gaps`) |
| Phiên chạy | `features/run/model/session.ts` (`RunSession`) | Bắt đầu, Tạm dừng, Tiếp tục, Kết thúc, Khôi phục. Tự tạm dừng. Đứng nghỉ quá lâu. Pace, từng km. Đồng hồ thời gian chạy không lùi. Bộ đếm chất lượng GPS |
| Lưu cục bộ | `features/run/model/recovery.ts` | Lưu tạm theo khối 100 điểm, mỗi lần chỉ ghi khối cuối. Hàng chờ gửi khi mất mạng |
| Giao diện | `features/run/hooks/useRunTracker.ts`, `components/RunScreen.tsx` | Nối nguồn vị trí với `RunSession`, đồng hồ 1 giây, giọng HLV theo sự kiện, gửi máy chủ |
| Máy chủ | `submit_and_process_activity`, `activity_attach_gps_quality` (008800) | Kiểm tra lại quãng đường theo tuyến, từng km, mất tín hiệu, chống gian lận khi thi đấu, chống trùng giờ, tóm tắt chất lượng GPS |

Viết app native thuần sau này: giữ nguyên `RunSession` và `TrackEngine` (hoặc chuyển 1-1 sang Swift/Kotlin), chỉ thay nguồn vị trí.

## Quy tắc thời gian

- **Thời gian chạy** (moving time) chỉ tính lúc di chuyển. Pace trung bình bằng thời gian chạy chia quãng đường, giống Strava và Garmin, nên dừng nghỉ không làm chậm pace.
- **Tổng thời gian** tính từ lúc bắt đầu đến lúc kết thúc, trừ các lúc bấm Tạm dừng. Máy chủ lưu cả hai.
- **Tự tạm dừng** (mặc định bật, tắt được): đứng yên khoảng 10 giây thì đồng hồ chạy đứng lại. Mới bấm Bắt đầu mà còn đứng thì hiện "Sẵn sàng", chưa báo tự tạm dừng.
- **Đứng nghỉ mà không bấm dừng:**
  - Đứng yên 10 phút: app hỏi có muốn Kết thúc không (bằng giọng nói, rung và băng thông báo).
  - Đứng yên 30 phút: app tự chuyển sang Tạm dừng, tổng thời gian ngừng tăng.
  - Bấm Kết thúc khi đã đứng yên từ 2 phút: bỏ phần đứng yên cuối bài, giờ kết thúc tính từ lúc dừng chạy. Nếu không bỏ, bài quên bấm Kết thúc sẽ có tổng thời gian sai và dễ chồng giờ với bài sau, khiến máy chủ báo trùng.

## Chất lượng GPS (008800)

Mỗi bài ghi bằng app gửi kèm một tóm tắt khoảng 0,5–2 KB. Tóm tắt này **không lưu từng điểm bị loại**. Nội dung gồm:

- số điểm nhận được và số điểm được dùng;
- số điểm bị loại theo từng lý do;
- sai số trung bình và lớn nhất;
- số lần mất tín hiệu, tổng giây mất, số đoạn được nối;
- số lần ẩn app hoặc tắt màn hình;
- số lần tạm dừng tay, tự tạm dừng, đứng nghỉ lâu, và phần đứng yên cuối bài bị bỏ;
- nhật ký sự kiện;
- thiết bị và nền tảng;
- phần kiểm thử, nếu có.

Dữ liệu nằm trong bảng riêng `activity_gps_quality`. Chỉ chủ bài (qua chi tiết bài chạy → "Chất lượng GPS lúc ghi") và admin xem được.

## Kiểm thử thực địa

1. Trên điện thoại cần thử, mở `/run?qa=1`. Admin có thể bấm nút **Kiểm thử GPS** ở màn Chạy thay cho bước này.
2. Chạy theo một trong 11 kịch bản: trời quang, nhà cao tầng, tán cây, vòng sân, đi chậm, tạm dừng 2 phút, đứng nghỉ lâu, khoá màn hình 20–30 phút, chuyển app hoặc nghe gọi, mất mạng, đóng app rồi mở lại.
3. Ở màn tổng kết, chọn kịch bản, nhập quãng đường chuẩn và ghi chú, rồi Lưu.
4. Xem kết quả ở **Quản trị → Hệ thống → Kiểm thử GPS**:
   - bảng kiểm theo thiết bị (kịch bản nào đã chạy, sai lệch tốt nhất);
   - danh sách các lần chạy thử kèm chỉ số;
   - thống kê chất lượng mọi bài ghi bằng app;
   - xuất Excel.

Mức đánh giá sai lệch: **≤ 2 %** là tốt (ngang đồng hồ GPS), **≤ 5 %** chấp nhận được, lớn hơn thì cần xem lại.

## Giới hạn còn lại

- Trên app cài, dữ liệu lưu tạm nằm trong bộ nhớ của WebView, ghi 5 giây một lần và ngay khi app bị ẩn. Nếu hệ điều hành đóng app, có thể mất vài giây cuối.
- iOS có thể dừng app khi máy quá nóng hoặc pin yếu. Không app nào tránh được hoàn toàn, kể cả Strava.

## Admin đổi quy tắc không cần sửa code (009100)

Vào **Quản trị → Hệ thống → Chính sách vận hành**. Mỗi lần lưu là một phiên bản mới, có kiểm tra giới hạn, ghi nhật ký quản trị, xem được lịch sử và khôi phục bằng một nút.

- **Ghi bài chạy:** tự tạm dừng sau bao nhiêu giây đứng yên; hỏi Kết thúc sau bao nhiêu phút; tự chuyển Tạm dừng sau bao nhiêu phút; đứng yên cuối bài bao lâu thì bỏ. App đọc lại mỗi 10 phút và áp cho bài bắt đầu sau đó (`RunSession` nhận quy tắc qua hàm khởi tạo).
- **Ngưỡng chống gian lận:** số bài tối đa mỗi ngày, pace nhanh nhất hợp lệ, tốc độ đi xe, giữ tốc độ cao hoặc nghiêm trọng, nhảy điểm GPS.
  - `submit_and_process_activity` (bài ghi bằng app) và `analyzeRun` (bài từ Strava) đọc chung một bộ ngưỡng.
  - Chỉ admin và máy chủ đọc được các số này.

## Bài nghi vấn (009700, 009800)

- **Mọi bài chạy** (ghi bằng app hoặc từ Strava) qua cùng một bộ kiểm tra, có tham gia thử thách hay không — vì bài nào cũng được cộng Xu / XP.
- Bài có dấu hiệu nghi vấn → chờ xác minh, chưa cộng Xu / XP / BXH / điểm CLB. Ngưỡng tự duyệt `antiCheat.autoApproveMaxScore` mặc định 0 (không tự duyệt bài nghi vấn nào); admin có thể nâng, áp như nhau cho mọi người.
- Bài chờ vì **mất tín hiệu GPS** (không có dấu hiệu tốc độ bất thường): người chạy bấm **"Chỉ tính phần có GPS"** → bỏ quãng nối thẳng, bài được duyệt ngay với phần đã kiểm chứng (dưới 200 m thì không ghi nhận).
- Lời báo cho người chạy chỉ một câu ngắn (vd. "Mất tín hiệu GPS một đoạn."), không lộ ngưỡng. Chi tiết kỹ thuật ở `review_detail` cho người duyệt.

## Bài chạy trùng giờ (009900)

- Một tài khoản ghi nhiều bài chồng thời gian (nhiều thiết bị, dùng chung tài khoản, hoặc app + đồng hồ/Strava): **mỗi thời điểm chỉ tính một bài**. Hai bài coi là trùng khi chồng nhau > 60 giây.
- Bài mới dài hơn tổng các bài trùng giờ đang được tính trên 10% và không nghi vấn → bài mới được tính; các bài cũ chuyển "Không ghi nhận", thu hồi Xu / XP (`private.revoke_run_reward`), nhiệm vụ / huy hiệu / thử thách tự tính lại qua trigger sẵn có.
- Ngược lại bài mới vẫn được lưu vào lịch sử với lời báo "Trùng giờ với bài chạy khác." (không còn bị bỏ lặng lẽ). Strava / Garmin / COROS trùng giờ mà không dài hơn thì bỏ qua như trước.
- Trigger `trg_ac_activity_overlap` (BEFORE INSERT, mọi đường ghi bài) khóa theo tài khoản (`pg_advisory_xact_lock`), nên hai máy gửi cùng lúc không lọt cả hai bài. Gửi lại đúng bài cũ vẫn báo `ACTIVITY_DUPLICATE`.
