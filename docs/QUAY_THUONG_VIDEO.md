# Quay thưởng: chấp nhận / huỷ kết quả và ghi video buổi quay

Chỉnh sửa lần 7 — yêu cầu của chủ sản phẩm: *"Khi có kết quả nên cho BTC chấp nhận hoặc huỷ kết quả; nghiên cứu thêm quay video
buổi quay thưởng (chỉ màn hình quay thưởng thôi; nút chấp nhận hoặc huỷ kết quả nằm ngoài màn hình quay)."*

## 1. Chấp nhận / huỷ kết quả (migration `20261001013500_quest_draw_round7.sql`)

```
READY ──Bắt đầu──▶ LIVE ──Kết thúc / Quay nhanh──▶ PENDING ──Chấp nhận──▶ DONE (báo người trúng, đăng bảng tin)
  ▲                                                   │
  └───────────────Huỷ kết quả (ghi nhật ký)───────────┘
```

- **PENDING (chờ xác nhận)**: quay xong nhưng chưa chính thức — chưa báo người trúng, chưa đăng bảng tin. Thành viên thấy
  "Ban tổ chức đang xác nhận kết quả".
- **Chấp nhận** (`confirm_lucky_draw`): chỉ người có quyền quay thưởng của chương trình (`private.draw_can_manage`). Ghi
  `confirmed_by`, `confirmed_at`, rồi mới công bố. Bấm lại không công bố hai lần; đã chấp nhận thì không huỷ được.
- **Huỷ kết quả** (`reject_lucky_draw(id, lý do)`): ghi một dòng `lucky_draw_rejections` — ai huỷ, lúc nào, lý do (≤ 300 ký tự),
  danh sách trúng bị huỷ, seed / mã băm / số người của lần quay đó — xoá người trúng, đưa lượt quay về READY. Lần "Bắt đầu" sau
  chốt lại danh sách và tạo **seed mới**.
- **Minh bạch**: mọi người thấy *số lần* kết quả bị huỷ (`reject_count`); chi tiết từng lần chỉ ban tổ chức thấy (`rejections`).
  Bảng nhật ký không đọc thẳng được (RLS bật, không cấp quyền bảng), chỉ qua hàm.
- **Dữ liệu cũ**: các lượt DONE trước 013500 giữ nguyên = coi như đã chấp nhận (`confirmed_at` rỗng).
- Nút **Chấp nhận / Huỷ kết quả** nằm ở thẻ lượt quay và ở chân màn hình quay — ngoài vùng được ghi hình.

## 2. Ghi video buổi quay (đã làm — phương án canvas)

Nút máy quay ở đầu màn hình quay (cạnh nút âm thanh). Bấm → ghi; bấm ô vuông → dừng và lưu file. Đang ghi có nhãn `REC mm:ss`.

**Cách làm**: vùng quay hiển thị bằng DOM (chữ, ảnh đại diện, hiệu ứng CSS) nên không ghi thẳng được. Thay vào đó
`features/draw/components/stagePaint.ts` **vẽ lại vùng quay** (tên lượt quay, giải đang quay, tên chạy / người trúng, bảng người
trúng, mã cam kết, giờ ghi) lên một canvas 1280×720 không hiện ra màn hình, 30 khung/giây; `canvas.captureStream(30)` + tiếng
quay (Web Audio → `MediaStreamAudioDestinationNode`, chỉ khi đang bật tiếng) → `MediaRecorder` (≈ 2,5 Mbit/s ≈ 19 MB/phút).

- Chỉ vùng quay vào video: không có thanh công cụ, nút Chấp nhận / Huỷ, thông báo, thanh điều hướng.
- Không vẽ ảnh đại diện: ảnh từ nguồn khác làm canvas "bẩn" → trình duyệt chặn ghi.
- Định dạng: MP4 (H.264 + AAC/Opus) → file `.mp4`, mở được trên iPhone, Windows, Zalo, Facebook. Trình duyệt chưa ghi được MP4 (Firefox, Chrome / Edge < 126, WebView cũ) mới lưu WebM (`.webm`).
- Lưu file (`shared/lib/saveImage.ts → saveFileBlob`): máy tính / Android Chrome tải file; iPhone mở bảng Chia sẻ;
  **app cài** ghi file vào bộ nhớ tạm bằng `@capacitor/filesystem` rồi mở bảng Chia sẻ (`@capacitor/share`) để lưu / gửi Zalo.
- Trình duyệt không hỗ trợ (`MediaRecorder` hoặc `canvas.captureStream` không có, không có định dạng nào): nút đổi thành biểu
  tượng gạch chéo, bấm hiện lý do ngắn.
- Tự dừng sau 30 phút; đóng màn hình quay khi đang ghi → dừng và lưu phần đã ghi; huỷ bảng Chia sẻ → có nút "Lưu lại".

| Nền tảng | Ghi được | Ghi chú |
| --- | --- | --- |
| Chrome / Edge máy tính (≥ 126) | Có (MP4; bản 94–125: WebM) | Dùng tốt nhất cho máy chiếu |
| Firefox (≥ 90) | Có (WebM) | |
| Android Chrome, app cài Android (WebView ≥ 126) | Có (MP4; WebView cũ hơn: WebM) | Lưu qua bảng Chia sẻ trong app |
| Safari macOS / iOS ≥ 14.5 | Có (MP4) | Nên thử thực tế trước buổi lễ; iOS < 14.5 không có MediaRecorder |
| WebView rất cũ / trình duyệt trong Zalo, Facebook | Thường không | Hiện lý do, dùng chức năng quay màn hình của điện thoại |

**Rủi ro / giới hạn**
- Video là bản *vẽ lại* vùng quay, không phải ảnh chụp màn hình y hệt (không có ảnh đại diện, pháo giấy đơn giản hơn).
  Mục đích là bằng chứng buổi quay: tên chạy, người trúng, mã cam kết, giờ ghi đều có trong khung hình.
- File lớn trên điện thoại: app cài phải đổi video sang base64 để ghi file → buổi quay rất dài (> 20–30 phút) có thể hết bộ nhớ.
  Đã giới hạn 30 phút/lần; buổi dài nên ghi nhiều đoạn hoặc ghi trên máy tính.
- Ra file `.webm` (Firefox, trình duyệt cũ) thì một số iPhone / Windows Media Player không mở được → cập nhật Chrome / Edge rồi ghi lại để ra `.mp4`, hoặc mở bằng VLC.
- Tab bị che / máy khoá màn hình: trình duyệt có thể giảm nhịp `setInterval` → video giật trong lúc đó.

**Phương án khác đã xem, không chọn**
- `getDisplayMedia({ preferCurrentTab: true })` + Region Capture (`CropTarget.fromElement`) — ghi đúng điểm ảnh của vùng quay, kể
  cả ảnh đại diện, pháo giấy. Nhưng chỉ Chrome / Edge máy tính hỗ trợ; Android (Chrome, WebView), iOS, Firefox **không có**
  `getDisplayMedia` cho tab; mỗi lần ghi phải bấm cho phép chia sẻ màn hình (gây khó hiểu trên máy chiếu). Có thể bổ sung sau như
  tuỳ chọn "Ghi chất lượng cao" khi `CropTarget` có sẵn.
- Thư viện chụp DOM (html2canvas…) mỗi khung hình: quá chậm cho 30 khung/giây, nặng thêm ~40 KB.
- Ghi ở máy chủ: không có luồng hình ở máy chủ, tốn băng thông / lưu trữ; không cần cho nhu cầu hiện tại.

## 3. Kiểm tra

- `tests/db/draw-confirm-round7.test.ts`: chờ xác nhận không công bố; người không có quyền không chấp nhận / huỷ được; huỷ ghi
  nhật ký đủ (ai, lúc nào, lý do, kết quả bị huỷ), quay lại có seed mới; chấp nhận mới công bố; dữ liệu DONE cũ giữ nguyên.
- `features/draw/model/recording.test.ts`: chọn định dạng, ẩn nút khi không hỗ trợ, tên file.
- Thử tay trước buổi lễ: mở màn hình quay trên máy chiếu (Chrome), bấm ghi, quay vài giải, Kết thúc, dừng ghi → mở file xem lại;
  rồi Chấp nhận (hoặc Huỷ kết quả → Bắt đầu quay lại).
