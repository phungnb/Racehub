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

## Khi đổi logo / tên miền

- **Logo:** `python3 scripts/make-app-icons.py đường-dẫn/logo-1024.png`, rồi dựng lại app. App Store yêu cầu ảnh nguồn **1024×1024**; hiện đang tạm dùng bản 512 phóng to.
- **Tên miền web:** sửa `CAP_SERVER_URL` (biến Actions hoặc biến môi trường khi chạy `npx cap sync`), sửa địa chỉ trong `mobile/www/offline.html`, rồi dựng lại app.

## Lưu ý duyệt app

- **Apple 4.2 (app chỉ là trang web):** RaceHub có tính năng native thật (ghi GPS nền, chặn GPS giả), nên cần ghi rõ điều đó trong phần *Review Notes*. Nên gửi kèm tài khoản thử để Apple đăng nhập được.
- **Lần đầu bấm Bắt đầu,** app hiện màn giải thích vì sao cần vị trí khi tắt màn hình, sau đó mới để máy hỏi quyền. Cả Google lẫn Apple đều yêu cầu bước này.
- **Chỉ ghi vị trí từ lúc Bắt đầu đến lúc Kết thúc.** App không theo dõi ngoài buổi chạy.
