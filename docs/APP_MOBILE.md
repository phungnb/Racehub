# App RaceHub trên App Store / Google Play

App cài được dựng bằng **Capacitor**. Nó là một "vỏ" native mở chính trang web RaceHub (`https://racehub-iota.vercel.app`), rồi thêm những việc web không làm được:

| Tính năng | Web (PWA) | App cài |
|---|---|---|
| Ghi GPS khi **tắt màn hình / bỏ túi** | ❌ dừng GPS | ✅ Android: thông báo cố định "RaceHub đang ghi bài chạy"; iPhone: chấm xanh vị trí |
| Chặn điểm GPS giả (app fake GPS) | ❌ | ✅ bỏ điểm `simulated` |
| Có mặt trên cửa hàng, icon RaceHub | cài từ trình duyệt | ✅ |
| Thông báo đẩy | ✅ (web push) | ⏳ bản sau (cần APNs / FCM) |
| Giọng HLV đọc pace | ✅ | ⚠️ iPhone có thể im khi khóa màn hình; Android WebView không có giọng đọc → bản sau thêm plugin đọc chữ |

**Cập nhật giao diện / tính năng web:** chỉ cần deploy Vercel như thường. App tự mở bản mới, **không phải nộp lại app**.
**Chỉ phải dựng và nộp lại app khi** đổi phần native: plugin, quyền, icon, tên app, `capacitor.config.ts`.

> **Bản dựng tiếp theo cần nộp lại** (đã đổi phần native): thêm plugin `@capacitor/browser` (đăng nhập Google / Apple bằng trình duyệt hệ thống),
> `@capacitor/share` + `@capacitor/filesystem` (lưu BIB, chứng nhận, ảnh vinh danh, poster về máy / gửi Zalo), và scheme `vn.racehub.app://`
> (AndroidManifest + Info.plist) để app nhận lại kết quả đăng nhập. App bản cũ vẫn chạy: nút lưu ảnh chuyển sang "nhấn giữ để lưu",
> nút Google / Apple báo "hãy cập nhật app".

## Cấu trúc

| Đường dẫn | Là gì |
|---|---|
| `capacitor.config.ts` | Mã app `vn.racehub.app` (**không đổi được sau lần nộp đầu**), tên app, địa chỉ web mở trong app |
| `android/` | Dự án Android Studio (quyền vị trí, camera, dịch vụ ghi nền) |
| `ios/` | Dự án Xcode (`Info.plist`: lời xin quyền vị trí / camera, chế độ nền "location") |
| `mobile/www/` | Trang dự phòng đóng gói trong app, hiện khi mở app lúc mất mạng |
| `features/run/model/location.ts` | Chọn nguồn GPS: plugin nền (app cài) hay `navigator.geolocation` (web) |
| `shared/lib/native.ts` | `isNativeApp()`: web biết mình đang chạy trong app |
| `scripts/make-app-icons.py` | Sinh icon + màn chờ từ logo |
| `.github/workflows/mobile.yml` | GitHub tự dựng APK Android + biên dịch thử iOS |

## Dùng thử trên Android ngay (không cần Mac)

1. Vào GitHub → **Actions** → **App di động** → chọn lần chạy mới nhất có dấu ✅.
2. Cuối trang, ở mục **Artifacts**, tải `racehub-android-debug`, giải nén ra `app-debug.apk`.
3. Gửi file vào điện thoại Android và mở. Nếu máy hỏi, cho phép "Cài ứng dụng không rõ nguồn".
4. Đăng nhập → Chạy → bấm Bắt đầu → cho phép vị trí → tắt màn hình, bỏ túi, đi bộ vài phút → mở lại để xem km.

> Muốn dựng lại bằng tay: **Actions → App di động → Run workflow**.

## Việc cần chuẩn bị để lên cửa hàng

| | Google Play | App Store |
|---|---|---|
| Tài khoản | Google Play Console, **25 USD** một lần | Apple Developer Program, **99 USD/năm** |
| Máy dựng | máy bất kỳ có Android Studio (hoặc GitHub Actions) | **Mac** có Xcode 16+ |
| Chính sách quyền riêng tư | bắt buộc (một trang trên web RaceHub) | bắt buộc |
| Khai báo đặc biệt | Dịch vụ nền loại *location* (Android 14): điền form trong Play Console + video ngắn quay cảnh ghi bài chạy | Giải thích chế độ nền "location" khi gửi duyệt: ghi bài chạy lúc khóa màn hình |

### Android: dựng bản phát hành
```bash
npm ci
npx cap sync android
# Tạo khóa ký MỘT LẦN, cất kỹ file + mật khẩu. Mất khóa = không cập nhật được app.
keytool -genkey -v -keystore racehub-release.jks -keyalg RSA -keysize 2048 -validity 10000 -alias racehub
npx cap open android      # Android Studio → Build → Generate Signed App Bundle (.aab)
```
Tải file `.aab` lên Play Console. Nên phát hành ở kênh **Kiểm thử nội bộ** trước.

### iOS: dựng trên Mac
```bash
npm ci
npx cap sync ios          # tự chạy pod install
npx cap open ios          # mở Xcode
```
Trong Xcode:
1. Chọn target **App** → **Signing & Capabilities** → chọn **Team** (tài khoản Apple Developer).
2. **Product → Archive** → **Distribute App** → **App Store Connect**.
3. Vào App Store Connect → **TestFlight** để cài thử trên iPhone, rồi mới gửi duyệt.

## Checklist trước khi đóng gói

**Máy chủ & dữ liệu**
- [ ] Chạy đủ migration tới **008900** (bản vá bảo mật CLB). Quản trị → Hệ thống → Kiểm tra hệ thống phải xanh hết.
- [ ] Biến môi trường production trên Vercel đầy đủ. Mục "Kiểm tra hệ thống" hiện đúng Strava, VAPID và webhook.
- [ ] Nhập **thông tin pháp nhân** (Quản trị → Hướng dẫn & chính sách): tên công ty, MST, địa chỉ, email hỗ trợ. Hai cửa hàng đều kiểm tra thông tin này.
- [ ] Trang **Quyền riêng tư** và **Điều khoản** mở được khi chưa đăng nhập: `/privacy`, `/terms`.
- [ ] Nên dùng **tên miền riêng** thay `racehub-iota.vercel.app` trước khi nộp. Đổi sau khi đã nộp thì phải dựng lại app.

**App**
- [ ] Logo nguồn **1024×1024** (hiện là bản 512 phóng to): `python3 scripts/make-app-icons.py logo-1024.png`.
- [ ] Phiên bản: Android `versionCode` / `versionName` trong `android/app/build.gradle`; iOS `MARKETING_VERSION` / `CURRENT_PROJECT_VERSION`. Mỗi lần nộp phải **tăng** số build.
- [ ] Khoá ký Android (`.jks`) và mật khẩu: cất ở 2 nơi an toàn, **không** đưa vào git.
- [ ] Tài khoản thử cho người duyệt (email + mật khẩu), có sẵn vài bài chạy, CLB và thử thách.
- [ ] Thử trên máy thật theo 11 kịch bản **Kiểm thử GPS** (`/run?qa=1`), ít nhất 1 iPhone và 1 Android. Xem kết quả ở Quản trị → Hệ thống → Kiểm thử GPS.

**Khai báo quyền riêng tư** (App Store: *App Privacy*; Google Play: *Data safety*). Khai đúng những gì RaceHub thu thập:

| Dữ liệu | Mục đích | Gắn với tài khoản | Theo dõi quảng cáo |
|---|---|---|---|
| Vị trí chính xác (chỉ trong lúc ghi bài chạy) | Chức năng app | Có | Không |
| Email, tên hiển thị, ảnh đại diện | Tài khoản | Có | Không |
| Dữ liệu thể thao (bài chạy, quãng đường, nhịp tim từ Strava) | Chức năng app | Có | Không |
| Ảnh người dùng tải lên (CLB, bài viết) | Chức năng app | Có | Không |
| Thông tin thiết bị + chất lượng GPS của bài chạy | Chẩn đoán / chống gian lận | Có | Không |

- Không bán dữ liệu, không quảng cáo theo dõi (App Store: *Data Not Used to Track You*).
- Người dùng tự **xoá tài khoản** trong app: Cài đặt → Xoá tài khoản. Cả hai cửa hàng đều bắt buộc có chức năng này.
- iOS đã khai `ITSAppUsesNonExemptEncryption = false` (chỉ dùng HTTPS), nên không phải trả lời câu hỏi mã hoá mỗi lần nộp.
- Android đã tắt sao lưu dữ liệu app (`allowBackup=false`): phiên đăng nhập và bài chạy dở không bị sao chép sang máy khác.

## Khi đổi logo / tên miền

- **Logo:** `python3 scripts/make-app-icons.py đường-dẫn/logo-1024.png`, rồi dựng lại app. App Store yêu cầu ảnh nguồn **1024×1024**; hiện đang tạm dùng bản 512 phóng to.
- **Tên miền web:** sửa `CAP_SERVER_URL` (biến Actions hoặc biến môi trường khi chạy `npx cap sync`), sửa địa chỉ trong `mobile/www/offline.html`, rồi dựng lại app.

## Lưu ý duyệt app

- **Apple 4.2 (app chỉ là trang web):** RaceHub có tính năng native thật (ghi GPS nền, chặn GPS giả), nên cần ghi rõ điều đó trong phần *Review Notes*. Nên gửi kèm tài khoản thử để Apple đăng nhập được.
- **Lần đầu bấm Bắt đầu,** app hiện màn giải thích vì sao cần vị trí khi tắt màn hình, sau đó mới để máy hỏi quyền. Cả Google lẫn Apple đều yêu cầu bước này.
- **Chỉ ghi vị trí từ lúc Bắt đầu đến lúc Kết thúc.** App không theo dõi ngoài buổi chạy.

## Đánh giá sẵn sàng nộp App Store / Google Play (29/09/2026)

**Đã đạt**

- Vỏ Capacitor 7 cho cả iOS và Android, mã app `vn.racehub.app`, trang dự phòng khi mất mạng.
- Ghi GPS khi tắt màn hình: iOS có `UIBackgroundModes: location` và câu giải thích quyền bằng tiếng Việt; Android dùng dịch vụ nền có thông báo.
- Có màn giải thích trước khi hỏi quyền. Chỉ ghi vị trí trong lúc chạy.
- Đăng nhập Apple có cùng lúc với Google (Apple 4.8). Người dùng tự xoá tài khoản trong app (Apple 5.1.1(v), Google Play).
- Không cần khoá API cho bản đồ và tìm địa điểm. Mọi khoá bí mật chỉ nằm ở máy chủ.

**Phải xử lý trước khi nộp (có thể bị từ chối)**

| # | Vấn đề | Quy định | Việc cần làm |
|---|---|---|---|
| 1 | ~~Mua VIP, CLB Pro, nạp Xu qua VietQR trong app~~ **Đã xử lý (011100)**: trong app iOS/Android mọi chỗ giá, mua gói, nạp Xu, mã khuyến mãi tự ẩn khi công tắc **"Cho phép mua trong app"** (Quản trị → Hệ thống → Chính sách vận hành) đang TẮT. Web vẫn bán bằng VietQR. Menu có "Liên hệ hỗ trợ" (SĐT, Zalo, Telegram, email — nhập ở Thông tin công ty) nhưng không gắn với việc mua. | Apple 3.1.1 / 3.1.3; Google Play Payments | Khi làm xong thanh toán qua Apple / Google thì bật công tắc. **Không bật khi chưa có** — app sẽ hiện lại VietQR và dễ bị từ chối. |
| 2 | Bình luận, bảng tin, chat CLB **chưa có nút Báo cáo / Chặn người dùng**. | Apple 1.2 (nội dung người dùng tạo); Google UGC | Thêm "Báo cáo" (bài, bình luận, tin nhắn) và "Chặn người này", đưa vào hàng chờ trong Quản trị. Phần Quanh đây đã có. |
| 3 | Thông báo đẩy trong app native chưa có. Web Push không chạy trong WebView iOS. | Không bắt buộc, nhưng là tính năng cốt lõi | Thêm `@capacitor/push-notifications` (APNs + FCM) và bảng token thiết bị. Máy chủ gửi song song với Web Push. |
| 4 | App tải giao diện từ web (`server.url`). | Apple 4.2 / 2.5.2 | Được phép, vì có tính năng native thật. Ghi rõ trong Review Notes và gửi kèm tài khoản thử. Rủi ro còn lại ở mức trung bình. |
| 5 | Chưa có `PrivacyInfo.xcprivacy` cấp app. | Apple (từ 05/2024) | Thêm file khai báo lý do dùng API (UserDefaults, thời gian khởi động…). |
| 6 | Android đang để `targetSdkVersion = 35`. | Google Play nâng mức tối thiểu hằng năm (tháng 8) | Kiểm tra mức yêu cầu hiện tại trên Play Console. Nếu đã là 36 thì nâng lên và thử lại GPS nền. |
| 7 | Logo nguồn đang là 512 px phóng to. | App Store cần 1024×1024 | Thay bằng logo gốc 1024×1024. |
