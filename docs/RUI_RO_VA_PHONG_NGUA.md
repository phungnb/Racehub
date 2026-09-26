# RaceHub — Nghiên cứu GPS & Sổ rủi ro

Cập nhật: 26/09/2026. Tài liệu sống: mỗi sự cố thật hoặc rủi ro mới → thêm một dòng.

Ký hiệu trạng thái:
- ✅ Đã xử lý trong code.
- 🟡 Đã giảm một phần.
- 🔴 Chủ sản phẩm phải tự làm (cấu hình, tài khoản, pháp lý), code không làm thay được.

---

## Phần 1. GPS: các app chuẩn làm gì, RaceHub đã làm gì

### Strava, Nike Run Club, Garmin, Grab/ship làm thế nào

| Kỹ thuật | Strava / NRC / Garmin | App giao hàng (Grab, ship) | RaceHub |
|---|---|---|---|
| **Nguồn vị trí** | GPS 1 lần/giây, độ chính xác cao nhất. iOS đặt `activityType = .fitness`, không cho iOS tự dừng cập nhật | Fused Location (GPS + Wi-Fi + cảm biến) | ✅ Android: Fused 1 giây/lần, HIGH_ACCURACY. ✅ iOS: `kCLLocationAccuracyBest`, không tự dừng, **thêm `activityType = .fitness`** (`scripts/patch-native-gps.mjs`) |
| **Chạy khi tắt màn hình** | App native + dịch vụ nền | Dịch vụ nền + hướng dẫn tắt tối ưu pin theo hãng | ✅ App cài: GPS nền, có thông báo cố định. ✅ **Hướng dẫn tắt tối ưu pin theo hãng** (Xiaomi, Samsung, OPPO, realme, vivo, Huawei), hiện trên màn Chạy. 🟡 Trình duyệt: giữ màn hình sáng, không chạy được khi bấm nút nguồn |
| **Chờ GPS sẵn sàng** | Chỉ bắt đầu khi tín hiệu ổn định | — | ✅ Cần 3 điểm tốt (≤ 20 m) liên tiếp hoặc 1 điểm ≤ 10 m. Vẫn có nút "Bắt đầu ngay" |
| **Lọc nhiễu** | Bỏ điểm xấu, làm mượt, không nối các điểm "kẹt" | Kalman + khớp bản đồ đường (map-matching) | ✅ Kalman theo sai số từng điểm. Bỏ điểm > 35 m, điểm nhảy > 43 km/h, rung khi đứng yên. **Không** khớp vào đường, vì chạy bộ đi qua công viên, sân, đường mòn (Strava cũng không làm) |
| **Tính quãng đường** | Máy có "distance stream" riêng (Doppler / cảm biến bước) thì dùng. Không có thì tính từ toạ độ và làm mượt ([Strava](https://support.strava.com/hc/en-us/articles/216919487-How-Distance-is-Calculated)) | Theo tuyến đã khớp đường | ✅ Kết hợp vận tốc Doppler của chip GPS với vị trí. Mô phỏng lệch < 2 %. ✅ **Mới: máy chủ lưu đúng số app đo** (trước đây tự cộng lại điểm-điểm nên dư 2–11 %) |
| **Tự tạm dừng** | Có | — | ✅ Đứng yên 10 giây thì dừng tính giờ |
| **Mất tín hiệu** | Ghi nhận, không nối "ảo" | Nội suy theo đường | ✅ Báo "Mất GPS". Đoạn nối chỉ được tính nếu tốc độ hợp lý. Máy chủ đánh cờ `GPS_GAP` |
| **Độ cao** | Không có khí áp kế thì dùng bản đồ độ cao; chỉ cộng dốc khi leo liên tục > 10 m ([Strava](https://support.strava.com/hc/en-us/articles/115001294564-Elevation-on-Strava-FAQs)) | — | 🔴 Chưa làm: độ cao GPS điện thoại sai ±10–30 m, nên hiện chưa hiển thị leo dốc cho bài ghi bằng app. Hướng làm: API độ cao (DEM) phía máy chủ |
| **Không mất bài** | Lưu dần trên máy, gửi lại khi có mạng | Hàng chờ offline | ✅ Lưu tạm 5 giây/lần, khôi phục khi app bị đóng, hàng chờ gửi lại. ✅ **Mới: làm tròn toạ độ (1 cm), mỗi điểm gọn ~20 %** dù đã thêm trường quãng đường |
| **Chống gian lận** | Phân tích tốc độ, xe cộ, app giả GPS | Phát hiện vị trí giả | ✅ Chặn điểm từ app giả GPS (cờ `simulated`). Luật tốc độ duy trì, xe máy, nhảy điểm. ✅ **Mới: số km app gửi bị kẹp theo hình học tuyến**, không khai khống được |

### Lỗi gốc tìm ra lần này và cách sửa

1. **Máy chủ lưu km dư 2–11 %** (lỗi nghiêm trọng nhất).
   - App hiển thị X km (đã hiệu chỉnh Doppler), nhưng máy chủ cộng khoảng cách giữa các điểm. Nhiễu GPS làm tuyến zig-zag nên tổng dài hơn thực tế.
   - Đo trên mô phỏng 3,9 km (thực tế → app → máy chủ cũ):

     | Kịch bản | Thực tế | App | Máy chủ cũ |
     |---|---|---|---|
     | GPS ±10 m | 3.900 m | 3.927 m | 4.006 m (+2,7 %) |
     | GPS ±15 m | 3.900 m | 3.900 m | 4.128 m (+5,8 %) |
     | Phố cao tầng | 3.900 m | 3.885 m | 4.319 m (+10,7 %) |

   - Sửa (migration `006600`): mỗi điểm mang quãng đường tích luỹ. Máy chủ dùng số này nhưng kẹp mỗi đoạn ≤ 1,1 × đoạn thẳng + 3 m, và tổng ≤ tổng đoạn thẳng. Từng km cũng được tính ngay trên máy chủ.
2. **Bắt đầu tính giờ bằng một điểm GPS "may mắn"** (điểm Wi-Fi/ô mạng). Nay phải chờ tín hiệu ổn định.
3. **iOS không biết app là chạy bộ** (`activityType` mặc định). Đã vá.
4. **Android các hãng tự "giết" GPS nền** ([dontkillmyapp.com](https://dontkillmyapp.com/xiaomi)). Đã thêm hướng dẫn theo hãng máy. Không app nào tự tắt được chế độ này; Strava và Grab cũng phải hướng dẫn người dùng.

---

## Phần 2. Sổ rủi ro

Mức độ:
- **Cao**: xảy ra sẽ mất người dùng, mất tiền hoặc bị gỡ app.
- **TB**: gây phiền, xử lý được.
- **Thấp**: theo dõi.

### A. GPS & dữ liệu bài chạy

| # | Rủi ro | Mức | Trạng thái / phòng ngừa |
|---|---|---|---|
| A1 | Quãng đường sai lệch so với Strava/Garmin | Cao | ✅ Engine Kalman + Doppler; máy chủ lưu đúng số app (006600). 🔴 Cần chạy thử thật 3–5 bài song song với đồng hồ Garmin để đối chiếu |
| A2 | Ghi bằng trình duyệt, bấm nút nguồn → GPS dừng, tuyến "đường thẳng" | Cao | ✅ Giữ màn hình sáng, chế độ bỏ túi, báo mất GPS, máy chủ đánh cờ `GPS_GAP`. 🔴 Khuyến khích cài app native |
| A3 | Android (Xiaomi/OPPO/Samsung…) tắt app chạy nền → bài đứt đoạn | Cao | ✅ Hướng dẫn theo hãng trên màn Chạy. ✅ Khôi phục bài khi app bị đóng |
| A4 | Mất bài khi mất mạng / app bị đóng | Cao | ✅ Lưu tạm + hàng chờ + chống gửi trùng. 🟡 Safari (web, không cài) có thể xoá dữ liệu trang sau 7 ngày không mở; hàng chờ nên được gửi trong ngày |
| A5 | Độ cao / leo dốc sai | TB | 🔴 Chưa hiển thị leo dốc cho bài ghi bằng app; cần API độ cao (DEM) |
| A6 | Chạy máy chạy bộ / trong nhà (không có GPS) | TB | 🔴 Chưa hỗ trợ. Hướng làm: đếm bước bằng gia tốc kế (như NRC), hoặc nhập qua đồng hồ / Strava |

### B. Pháp lý & nền tảng

| # | Rủi ro | Mức | Trạng thái / phòng ngừa |
|---|---|---|---|
| B1 | **Vi phạm Thoả thuận API Strava (từ 11/11/2024)**: dữ liệu Strava của một người chỉ được hiển thị cho chính người đó ([Strava](https://press.strava.com/articles/updates-to-stravas-api-agreement), [Help Center](https://support.strava.com/hc/en-us/articles/31798729397773-API-Agreement-Update-How-Data-Appears-on-3rd-Party-Apps)); cấm đưa dữ liệu vào AI. Hậu quả: bị thu hồi API, mất đồng bộ Strava của mọi người dùng | **Cao** | ✅ 006700: bài Strava của người khác chỉ còn số tổng (ẩn bản đồ, từng km, nhịp tim, thiết bị). ✅ **Đã được Strava duyệt (999 người, 09/2026).** ✅ Nút / ghi nguồn đúng chuẩn thương hiệu Strava. Hướng dẫn nộp duyệt: `docs/STRAVA_DUYET_APP.md`. ✅ **Hướng B+ (007000)**: bài Strava chỉ lên bảng tin CLB / BXH / thử thách / giải chạy / league khi runner bật đồng ý; admin chuyển ngay sang hướng A (chỉ chủ bài thấy) ở Quản trị → Hệ thống → Strava. 🟡 Rủi ro còn lại: điều khoản vẫn ghi "chỉ hiển thị cho chính người dùng" — nên email developers@strava.com mô tả mô hình đồng ý để xin xác nhận. Không dùng dữ liệu Strava cho AI |
| B2 | **Giới hạn API Strava**: 200 lượt / 15 phút, 2.000 lượt / ngày (đọc: 100 / 1.000) ([Strava](https://developers.strava.com/docs/rate-limits/)). Mỗi bài tốn 1–3 lượt → quá ~500–1.000 người dùng tích cực là nghẽn | Cao | ✅ Nhận bài qua webhook (không quét liên tục). Chặn đồng bộ tay dưới 1 phút. Báo lỗi 429 rõ ràng. 🔴 Xin nâng hạn mức khi có ~300 người kết nối |
| B3 | **App Store từ chối vì thiếu xoá tài khoản** (Apple 5.1.1(v)) | **Cao** | ✅ 006800 + `/api/account/delete` + nút "Xoá tài khoản" trong Cài đặt |
| B4 | **App Store từ chối vì app "chỉ là trang web"** (Apple 4.2 — vỏ Capacitor mở `server.url`) ([tham khảo](https://www.mobiloud.com/blog/app-store-review-guidelines-webview-wrapper/)) | Cao | 🟡 Có tính năng native thật (GPS nền, thông báo, chia sẻ, quét QR, trang offline). 🔴 Khi nộp: ghi chú cho người duyệt nhấn mạnh GPS nền + thông báo; quay video demo ghi bài chạy khi khoá màn hình; cung cấp tài khoản demo có dữ liệu |
| B5 | **Luật Bảo vệ dữ liệu cá nhân 2025** (hiệu lực 01/01/2026); Nghị định 356/2025: **dữ liệu vị trí, sức khoẻ = dữ liệu nhạy cảm** ([TVPL](https://thuvienphapluat.vn/chinh-sach-phap-luat-moi/vn/ho-tro-phap-luat/chinh-sach-moi/89602/quy-dinh-moi-ve-bao-ve-du-lieu-ca-nhan-doi-voi-du-lieu-vi-tri-ca-nhan-du-lieu-sinh-trac-hoc-tu-01-01-2026)) | **Cao** | ✅ Đã có: xin đồng ý trước khi dùng vị trí; Quanh đây có đồng ý riêng và chỉ lưu ô lưới, không toạ độ; bản đồ mặc định riêng tư; quyền xoá dữ liệu tự phục vụ; trang Chính sách. 🔴 Lập hồ sơ đánh giá tác động xử lý dữ liệu cá nhân, gửi Bộ Công an (A05) theo luật; chỉ định đầu mối bảo vệ dữ liệu; kiểm tra lại với luật sư |
| B6 | Google Play: khai báo dịch vụ nền loại "location" (Android 14+) | TB | ✅ App không xin quyền vị trí nền (chỉ dùng dịch vụ nền có thông báo khi đang ghi). 🔴 Khi nộp: điền khai báo dịch vụ nền + video demo |
| B7 | Chợ BIB: chuyển nhượng BIB trái điều lệ giải; lừa đảo | TB | ✅ Giá ≤ giá gốc, chuyển tên qua BTC, ẩn liên hệ, giới hạn xem, báo cáo, admin ẩn tin. RaceHub không giữ tiền. 🔴 Theo dõi báo cáo hằng tuần |

### C. Hạ tầng & vận hành

| # | Rủi ro | Mức | Trạng thái / phòng ngừa |
|---|---|---|---|
| C1 | **Email đăng ký / quên mật khẩu không tới**: SMTP mặc định của Supabase chỉ gửi **2 email/giờ** ([Supabase](https://supabase.com/docs/guides/auth/auth-smtp)) → ngày ra mắt người dùng kẹt ở bước xác nhận email | **Cao** | 🔴 **Bắt buộc trước khi mời người dùng**: cấu hình SMTP riêng (Resend / Brevo / Amazon SES) trong Supabase → Auth → SMTP, rồi nâng giới hạn ở Auth → Rate Limits. Khuyến khích đăng nhập Google / Apple (không cần email) |
| C2 | Gói Free Supabase: tạm dừng dự án khi ~7 ngày không có hoạt động; không có sao lưu tự động dùng được | Cao | 🔴 Lên gói Pro khi có người dùng thật (có sao lưu hằng ngày). Trước đó: tự `pg_dump` hằng tuần |
| C3 | Dung lượng DB tăng nhanh vì điểm GPS: ~700–1.500 điểm / bài 10 km ≈ 0,2–0,3 MB → Free 500 MB ≈ 2.000 bài; Pro 8 GB ≈ 30.000 bài | TB | 🟡 Engine đã giảm 5–10 lần so với ghi 1 điểm/giây. 🔴 Khi vượt ~20.000 bài: nén tuyến bài cũ thành polyline (việc tiếp theo) |
| C4 | Bản đồ OpenStreetMap miễn phí cấm dùng lượng lớn | TB | ✅ Cấu hình `NEXT_PUBLIC_MAP_TILES`. 🔴 Khi > vài trăm người dùng/ngày: dùng MapTiler / Stadia (có gói miễn phí, cần key) |
| C5 | Không biết app lỗi trước khi người dùng phàn nàn | TB | ✅ Có ghi lỗi phía người dùng (`client_errors`) + trang Kiểm tra hệ thống trong Quản trị. 🔴 Xem trang này mỗi ngày trong tuần đầu ra mắt |
| C6 | Cron (thử thách, league, sự kiện) không chạy | TB | ✅ Cron của Vercel có khoá bí mật. 🔴 Đặt `CRON_SECRET`; kiểm tra log cron tuần đầu |
| C7 | Realtime (chat CLB) quá giới hạn kết nối đồng thời của gói | Thấp | 🔴 Theo dõi khi > 200 người online cùng lúc |

### D. Bảo mật

| # | Rủi ro | Mức | Trạng thái / phòng ngừa |
|---|---|---|---|
| D1 | Lộ khoá bí mật (Strava secret, VAPID private key đã từng lộ) | **Cao** | ✅ Đã đổi Strava Client Secret + cặp khoá VAPID (09/2026). Tiếp tục: không chụp màn hình `.env.local`; khoá service role chỉ nằm trên Vercel |
| D2 | Người dùng tự sửa số dư / quãng đường qua API | Cao | ✅ Mọi ghi tài sản qua RPC `security definer`; RLS chặn ghi trực tiếp; máy chủ tự tính lại quãng đường; test tự động bảo mật |
| D3 | Clickjacking, XSS, nhúng iframe | TB | ✅ CSP `frame-ancestors 'none'`, X-Frame-Options, nosniff, HSTS; Markdown bài viết qua bộ phân tích an toàn |
| D4 | Webhook Strava giả mạo | TB | ✅ Kiểm tra `verify_token` + `subscription_id` |
| D5 | Admin lạm quyền | TB | ✅ Nhật ký bất biến, 2 người duyệt việc nhạy cảm, chặn tự cấp quyền |

### E. Gian lận & kinh tế

| # | Rủi ro | Mức | Trạng thái / phòng ngừa |
|---|---|---|---|
| E1 | Chạy bằng xe máy / app giả GPS / khai khống km | Cao | ✅ Luật tốc độ, cờ app giả GPS, kẹp km theo tuyến, bài nghi vấn chờ duyệt, không thưởng trước khi duyệt |
| E2 | Tạo nhiều tài khoản để lấy thưởng mời bạn | TB | ✅ Thưởng mời chỉ khi bạn mới hoàn thành bài chạy hợp lệ; giới hạn số bài/ngày |
| E3 | Chuyển khoản giả (ảnh chụp màn hình) khi mua gói VietQR | TB | ✅ Admin xác nhận thủ công. 🔴 Chỉ bấm xác nhận sau khi đối chiếu sao kê ngân hàng, không tin ảnh chụp |

### F. Uy tín khi ra mắt / chạy thử

| # | Rủi ro | Mức | Trạng thái / phòng ngừa |
|---|---|---|---|
| F1 | Trang lỗi / trắng khi dữ liệu rỗng | Cao | ✅ Quét tự động 53 trang (mất mạng, rỗng, có hồ sơ): không trang nào sập hay tràn ngang |
| F2 | Người dùng đầu tiên thấy app trống (CLB, thử thách, bài viết) | TB | 🟡 Có bài Kiến thức mẫu. 🔴 Trước khi mời: tạo sẵn 2–3 CLB, 1 thử thách tuần, 1 giải chạy ảo |
| F3 | GPS sai ở lần thử đầu, mất niềm tin | Cao | ✅ Phần 1. 🔴 Người thử đầu tiên: dùng app cài, hoặc để màn hình sáng khi dùng web |

---

## Việc chủ sản phẩm cần làm ngay (theo thứ tự)

1. ~~Đổi Strava Client Secret + cặp khoá VAPID (D1)~~ — đã làm.
2. Cấu hình SMTP riêng cho Supabase (C1).
3. Chạy `supabase/deploy/chay_tu_003700.sql` (gồm 006600–006800).
4. Quyết định về dữ liệu Strava trên BXH / bảng tin (B1): liên hệ Strava, hoặc chuyển trọng tâm sang ghi bằng app / Garmin.
5. Build lại app native (`npm install` tự vá iOS, rồi `npm run app:sync`) và nộp store với ghi chú cho người duyệt (B4, B6).
6. Lên Supabase Pro khi có người dùng thật (C2).
7. Hồ sơ đánh giá tác động dữ liệu cá nhân (B5).
8. Chạy thử 3–5 bài song song với đồng hồ Garmin để đối chiếu quãng đường (A1).
