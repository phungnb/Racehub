// Đăng ký bằng số điện thoại: tài khoản dùng email nội bộ <số>@phone.racehub.vn (không gửi thư, không SMS).
export const PHONE_EMAIL_DOMAIN = 'phone.racehub.vn'

/** Chuẩn hóa số di động Việt Nam về dạng 0xxxxxxxxx; trả null nếu không phải số hợp lệ. */
export function normalizeVnPhone(input: string): string | null {
  const s = input.replace(/[\s.\-()]/g, '')
  if (!/^\+?[0-9]+$/.test(s)) return null
  const local = s.startsWith('+84') ? `0${s.slice(3)}` : s.startsWith('84') && s.length === 11 ? `0${s.slice(2)}` : s
  return /^0[35789][0-9]{8}$/.test(local) ? local : null
}

/** Ô nhập chỉ toàn số (có thể có +, khoảng trắng, dấu chấm) → coi là số điện thoại. */
export function looksLikePhone(input: string): boolean {
  return /^\+?[0-9\s.\-()]+$/.test(input.trim())
}

export const phoneEmail = (phone: string) => `${phone}@${PHONE_EMAIL_DOMAIN}`
