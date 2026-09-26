// Android: nhiều hãng (Xiaomi, OPPO, realme, vivo, Samsung…) tự "dọn" app chạy nền để tiết kiệm pin — kể cả dịch vụ GPS
// có thông báo cố định — làm bài chạy bị đứt đoạn khi tắt màn hình. Không app nào tự tắt được việc này (Strava, Garmin
// Connect, Grab đều hướng dẫn người dùng). Nguồn tổng hợp theo hãng: dontkillmyapp.com.

export type Brand = 'xiaomi' | 'samsung' | 'oppo' | 'realme' | 'vivo' | 'huawei' | 'other'

/** Đoán hãng máy từ User-Agent của WebView Android (mã máy trong ngoặc) */
export function androidBrand(ua: string): Brand {
  const u = ua.toLowerCase()
  if (/xiaomi|redmi|poco|; m\d{4}|; \d{4,5}[a-z0-9]{2,}\b|mi \d/.test(u)) return 'xiaomi'
  if (/samsung|; sm-/.test(u)) return 'samsung'
  if (/realme|; rmx/.test(u)) return 'realme'
  if (/oppo|; cph|oneplus/.test(u)) return 'oppo'
  if (/vivo|; v\d{4}/.test(u)) return 'vivo'
  if (/huawei|honor/.test(u)) return 'huawei'
  return 'other'
}

export const BRAND_STEPS: Record<Brand, { name: string; steps: string[]; link: string }> = {
  xiaomi: { name: 'Xiaomi / Redmi / POCO', link: 'https://dontkillmyapp.com/xiaomi', steps: [
    'Cài đặt → Ứng dụng → Quản lý ứng dụng → RaceHub → Tiết kiệm pin → chọn “Không hạn chế”.',
    'Cùng trang đó: bật “Tự khởi chạy” (Autostart).',
    'Mở đa nhiệm, kéo thẻ RaceHub xuống → bấm biểu tượng ổ khoá để khoá app.',
  ] },
  samsung: { name: 'Samsung', link: 'https://dontkillmyapp.com/samsung', steps: [
    'Cài đặt → Ứng dụng → RaceHub → Pin → chọn “Không hạn chế”.',
    'Cài đặt → Chăm sóc thiết bị → Pin → Giới hạn sử dụng nền: bỏ RaceHub khỏi “Ứng dụng ngủ” / “Ngủ sâu”.',
  ] },
  oppo: { name: 'OPPO / OnePlus', link: 'https://dontkillmyapp.com/oppo', steps: [
    'Cài đặt → Pin → Mức sử dụng pin của ứng dụng → RaceHub → bật “Cho phép hoạt động nền”, tắt tối ưu hoá.',
    'Cài đặt → Ứng dụng → Quản lý ứng dụng → RaceHub → bật “Cho phép tự khởi động”.',
    'Mở đa nhiệm, bấm ⋮ trên thẻ RaceHub → “Khoá”.',
  ] },
  realme: { name: 'realme', link: 'https://dontkillmyapp.com/realme', steps: [
    'Cài đặt → Pin → RaceHub → bật “Cho phép hoạt động nền”, tắt “Tối ưu hoá sử dụng pin”.',
    'Cài đặt → Ứng dụng → RaceHub → bật “Cho phép tự khởi động”.',
  ] },
  vivo: { name: 'vivo', link: 'https://dontkillmyapp.com/vivo', steps: [
    'Cài đặt → Pin → Tiêu thụ năng lượng nền cao → bật cho RaceHub.',
    'i Manager → Quản lý ứng dụng → Tự khởi động → bật RaceHub.',
  ] },
  huawei: { name: 'Huawei / Honor', link: 'https://dontkillmyapp.com/huawei', steps: [
    'Cài đặt → Pin → Khởi chạy ứng dụng → RaceHub → tắt “Quản lý tự động”, bật cả 3 mục chạy nền.',
  ] },
  other: { name: 'Android', link: 'https://dontkillmyapp.com', steps: [
    'Cài đặt → Ứng dụng → RaceHub → Pin → chọn “Không hạn chế” (hoặc tắt “Tối ưu hoá pin”).',
  ] },
}
