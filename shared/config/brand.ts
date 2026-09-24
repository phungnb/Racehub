// Đường dẫn icon app. Tên file có tiền tố phiên bản (rh4-…) để khi đổi thiết kế, điện thoại tải icon mới
// thay vì dùng bản đã nhớ. Sinh lại bằng scripts/pwa/make-icons.py (sửa tiền tố V ở đó cùng lúc).
export const ICONS = {
  any192: '/icons/rh4-icon-192.png',
  any512: '/icons/rh4-icon-512.png',
  maskable192: '/icons/rh4-maskable-192.png',
  maskable512: '/icons/rh4-maskable-512.png',
  apple: '/icons/rh4-apple-180.png',
  badge: '/icons/rh4-badge-96.png',
  mark: '/icons/rh4-mark-256.png',
} as const
