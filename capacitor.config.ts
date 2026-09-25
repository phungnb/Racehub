import type { CapacitorConfig } from '@capacitor/cli'

// App RaceHub cho App Store / Google Play: vỏ native mở chính trang web RaceHub (server.url) và thêm những gì web
// không làm được — trước hết là ghi GPS khi tắt màn hình / bỏ túi (plugin background-geolocation).
// Cập nhật giao diện chỉ cần deploy web như thường; chỉ phải nộp lại app khi đổi phần native (plugin, quyền, icon).
// Xem docs/APP_MOBILE.md.
const serverUrl = process.env.CAP_SERVER_URL || 'https://racehub-iota.vercel.app'

const config: CapacitorConfig = {
  // Mã định danh app trên cửa hàng — KHÔNG đổi được sau khi đã nộp lần đầu
  appId: 'vn.racehub.app',
  appName: 'RaceHub',
  // Trang dự phòng đóng gói sẵn trong app: chỉ hiện khi không tải được server.url (mất mạng lúc mở app)
  webDir: 'mobile/www',
  // Cho web biết đang chạy trong app (xem shared/lib/native.ts)
  appendUserAgent: 'RaceHubApp',
  server: {
    url: serverUrl,
    // Các trang được mở ngay trong app (đăng nhập Strava / Supabase); trang ngoài danh sách mở bằng trình duyệt
    allowNavigation: [new URL(serverUrl).host, 'www.strava.com', 'strava.com', '*.supabase.co'],
    errorPath: 'offline.html',
  },
  android: {
    // Plugin GPS nền: không có dòng này Android dừng cập nhật vị trí sau 5 phút chạy nền
    useLegacyBridge: true,
    adjustMarginsForEdgeToEdge: 'auto',
  },
  ios: {
    contentInset: 'never',
  },
}

export default config
