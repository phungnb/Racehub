# Xin Strava duyệt app RaceHub (Strava Developer Program)

Cập nhật: 26/09/2026.

> "Duyệt đối tác" ở đây là **Developer Program Review**: vòng duyệt bắt buộc để app được kết nối với nhiều người dùng Strava. Strava còn có chương trình **đối tác kinh doanh** riêng (hợp tác thương mại, quảng bá). Chương trình đó đàm phán qua email, chỉ nên liên hệ sau khi app đã qua duyệt và có người dùng.

## 1. Các mức truy cập

| Mức | Số người kết nối Strava được | Cách lên mức |
|---|---|---|
| App mới ("Single Player Mode") | **1** (chính bạn) | Mặc định |
| Standard (tự nâng) | **tối đa 10** (nhóm chạy thử) | Tự bấm nâng cấp trong trang **API Settings** (strava.com/settings/api), không cần duyệt |
| Sau khi được duyệt | **999**, sau đó xin thêm | Nộp form Developer Program (link ở cuối trang developers.strava.com/docs/rate-limits) |

Khi đã đủ số người, người thứ 11 (hoặc thứ 2) bấm "Connect with Strava" sẽ gặp lỗi `403 Too many athletes`.

👉 **Việc đầu tiên:** vào strava.com/settings/api và xem "Athlete Capacity" của app RaceHub. Nếu đang là 1 → tự nâng lên 10 để chạy thử với nhóm nhỏ trong lúc chờ duyệt.

Thời gian duyệt: khoảng **7–10 ngày làm việc**. Quá hạn thì email **developers@strava.com**, kèm Client ID.

## 2. Strava từ chối vì những gì

Email từ chối của Strava thường nêu một trong các lý do sau:

1. **Không mang lại trải nghiệm bổ trợ cho người dùng Strava**, tức là app chỉ sao chép Strava.
2. **Dùng API không tối ưu**, ví dụ quét liên tục thay vì dùng webhook.
3. **Lo ngại bảo mật / quyền riêng tư.**
4. **Vi phạm API Agreement**: điều thường gặp nhất là **hiển thị dữ liệu Strava của người này cho người khác** (bảng xếp hạng, bảng tin), và dùng dữ liệu Strava cho AI.

### RaceHub đang đứng ở đâu

| Hạng mục | Trạng thái |
|---|---|
| Nhận bài qua **webhook** (không quét liên tục), chặn đồng bộ tay < 1 phút | ✅ |
| Thu hồi quyền khi người dùng ngắt kết nối / xoá tài khoản; xử lý sự kiện "deauthorize" và "xoá bài" từ Strava | ✅ |
| Nút **Connect with Strava** màu cam, **Powered by Strava**, link **View on Strava**, ghi nguồn trên ảnh chia sẻ | ✅ (vừa làm) |
| Chi tiết bài Strava (bản đồ, từng km, nhịp tim) chỉ chủ bài xem | ✅ (006700) |
| Tên app không chứa chữ "Strava", không làm người dùng tưởng Strava làm app | ✅ |
| **Quãng đường từ Strava hiện trên BXH CLB, BXH thử thách, bảng tin, kết quả giải chạy ảo** | ❌ **Đây là điểm dễ bị từ chối nhất.** Xem mục 3 |
| Không dùng dữ liệu Strava cho AI | ✅ (chưa có tính năng AI dùng dữ liệu bài chạy — giữ nguyên như vậy) |

## 3. Quyết định trước khi nộp: bài Strava trên bảng xếp hạng

Theo điều khoản hiện hành, dữ liệu Strava của một người chỉ được hiển thị cho chính người đó. Bảng xếp hạng CLB hay thử thách có tổng km lấy từ Strava của thành viên khác là hiển thị dữ liệu cho người khác. Có 3 hướng:

| Hướng | Cách làm | Được | Mất |
|---|---|---|---|
| **A. Tuân thủ hoàn toàn** (khuyên dùng) | Bài Strava chỉ tính cho **chính người chạy** (thống kê, Xu, XP, huy hiệu). BXH, bảng tin, kết quả giải chỉ dùng bài ghi bằng **app RaceHub** (và sau này Garmin/COROS kết nối trực tiếp) | Dễ qua duyệt; không lo bị khoá API | Người chỉ dùng đồng hồ + Strava không lên BXH, trừ khi ghi thêm bằng app |
| B. Xin ngoại lệ | Nộp như hiện tại, giải thích BXH chỉ trong CLB kín, người dùng tự đồng ý chia sẻ | Giữ nguyên sản phẩm | Khả năng cao bị từ chối; dù qua duyệt vẫn có thể bị thu hồi sau |
| C. Bỏ Strava | Chỉ ghi bằng app + kết nối trực tiếp Garmin Connect / COROS / Apple Health | Không phụ thuộc Strava | Mất kênh đồng bộ phổ biến nhất |

Nếu chọn **A**, mình có thể làm phần code: đánh dấu bài nguồn Strava là "chỉ mình tôi" trong mọi truy vấn BXH / bảng tin / giải chạy ảo, hiện giải thích cho người dùng, và gợi ý họ ghi bằng app.

**Nên làm thêm (khuyến nghị):** khi người dùng ngắt kết nối Strava thì xoá các bài lấy từ Strava của họ. Hiện app chỉ thu hồi quyền, bài cũ vẫn giữ. Điều khoản Strava yêu cầu xoá dữ liệu Strava khi người dùng yêu cầu; bạn cần đọc lại bản mới nhất tại strava.com/legal/api.

## 4. Chuẩn bị hồ sơ

### 4.1. Thông tin điền form

| Trường | Gợi ý nội dung |
|---|---|
| Tên app | RaceHub |
| Website | Tên miền production (không dùng link `*.vercel.app` nếu đã có tên miền riêng) |
| Chính sách quyền riêng tư / Điều khoản | `https://<tên-miền>/privacy`, `https://<tên-miền>/terms` |
| Mô tả app (tiếng Anh) | Xem mẫu 4.3 |
| Cách dùng dữ liệu Strava | Chỉ đọc (hiện xin `read,activity:read_all` — xem ghi chú dưới bảng); dùng để tính tiến độ cá nhân, huy hiệu, cấp độ **cho chính người dùng**; không hiển thị cho người khác; không dùng cho AI; xoá khi người dùng ngắt kết nối / xoá tài khoản |
| Số người dùng dự kiến | Trung thực: ví dụ "~300 người trong 3 tháng đầu, chủ yếu các CLB chạy bộ tại Việt Nam" |
| Webhook | Có |
| Ảnh chụp màn hình | Xem 4.2 |

**Ghi chú quyền truy cập:** app đang xin `activity:read_all`, tức là đọc cả bài người dùng để chế độ "Chỉ mình tôi" trên Strava. Người duyệt có thể hỏi vì sao cần.
- Nếu không cần bài riêng tư, đổi thành `read,activity:read` (một dòng `STRAVA_SCOPES` trong `features/integrations/strava/strava.server.ts`) sẽ dễ qua duyệt hơn.
- Nếu giữ, hãy giải thích: người dùng thường để bài ở chế độ riêng tư nhưng vẫn muốn tính vào tiến độ cá nhân trên RaceHub.

### 4.2. Ảnh chụp màn hình bắt buộc

Chụp **mọi nơi** có nút kết nối hoặc dữ liệu Strava. Chụp trên điện thoại, bản production, tài khoản thật đã kết nối Strava:

1. Onboarding bước 2 — nút **Connect with Strava**.
2. Trang Tôi — dòng Strava với nút **Connect with Strava** (lúc chưa kết nối) và nút Ngắt (lúc đã kết nối).
3. Thẻ "Kết nối Strava" ở trang chủ.
4. Danh sách bài chạy có bài nguồn Strava.
5. Chi tiết một bài Strava **của chính mình**: có **Powered by Strava** + **View on Strava**.
6. Chi tiết bài Strava **của người khác**: chỉ có số tổng, ghi rõ "chỉ người chạy xem được chi tiết".
7. Ảnh chia sẻ bài Strava có dòng **Powered by Strava**.
8. (Nếu chọn hướng A) BXH CLB / thử thách: bài Strava không hiện cho người khác, kèm dòng giải thích.

**Trước khi chụp:** tải bộ nút / logo chính thức tại developers.strava.com/guidelines ("Connect with Strava" cam, "Powered by Strava"). Đặt vào `public/brand/strava/` với tên `connect-with-strava.svg`, `powered-by-strava.svg`, rồi đặt biến môi trường `NEXT_PUBLIC_STRAVA_BRAND_ASSETS=1` trên Vercel và deploy lại. App sẽ dùng ảnh chính thức thay cho bản chữ đang dùng tạm. Strava yêu cầu dùng đúng file của họ, không vẽ lại.

### 4.3. Mẫu mô tả (tiếng Anh, sửa cho khớp hướng bạn chọn)

> RaceHub is a Vietnamese running-club app: club chat, group-run events with QR check-in, club treasury, virtual races and a gamified running character. Users record runs with RaceHub's own GPS tracker. Connecting Strava is optional and lets a user import their own activities so that their personal progress, badges and character level update automatically.
>
> Strava data is read-only (scopes: read, activity:read), is shown **only to the athlete who owns it** (with "Powered by Strava" attribution and "View on Strava" links), is never shown to other users or on leaderboards, and is never used for AI/ML. We use webhooks (no polling). When a user disconnects Strava or deletes their account we revoke the token and delete their Strava-derived data.
>
> *(Chỉ dùng câu "only to the athlete…" nếu chọn hướng A; chỉ dùng câu "delete their Strava-derived data" sau khi đã làm mục "Nên làm thêm" ở phần 3. Mô tả sai với thực tế là lý do bị thu hồi API.)*
>
> Privacy policy: https://<domain>/privacy — Terms: https://<domain>/terms

## 5. Sau khi nộp

- Theo dõi email (kể cả thư rác) từ Strava; họ có thể hỏi thêm.
- Bị từ chối → đọc lý do, sửa, nộp lại. Đừng nộp lại y nguyên.
- Được duyệt (999 người) → khi gần đủ, hoặc khi hạn mức 2.000 lượt/ngày bắt đầu chật, email developers@strava.com xin nâng. Nêu số người dùng, cách app dùng webhook và cache.

Nguồn:
- [Strava – Rate limits & form Developer Program](https://developers.strava.com/docs/rate-limits/)
- [Strava – Our Developer Program](https://communityhub.strava.com/developers-knowledge-base-14/our-developer-program-3203)
- [Strava – API FAQ](https://communityhub.strava.com/developers-knowledge-base-14/strava-api-faq-12906)
- [Strava – Brand guidelines](https://developers.strava.com/guidelines/)
- [Strava – cập nhật API Agreement](https://press.strava.com/articles/updates-to-stravas-api-agreement)
- [Thảo luận: app bảng xếp hạng CLB bị từ chối](https://communityhub.strava.com/developers-api-7/urgent-manual-review-requested-for-internal-club-app-client-id-263175-13722)
