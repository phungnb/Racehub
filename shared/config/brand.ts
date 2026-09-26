// Đường dẫn icon app. Tên file có tiền tố phiên bản (rh5-…) để khi đổi thiết kế, điện thoại tải icon mới
// thay vì dùng bản đã nhớ. Sinh lại bằng scripts/pwa/make-icons.py (sửa tiền tố V ở đó cùng lúc).
export const ICONS = {
  any192: '/icons/rh5-icon-192.png',
  any512: '/icons/rh5-icon-512.png',
  maskable192: '/icons/rh5-maskable-192.png',
  maskable512: '/icons/rh5-maskable-512.png',
  apple: '/icons/rh5-apple-180.png',
  badge: '/icons/rh5-badge-96.png',
  mark: '/icons/rh5-mark-256.png',
} as const
