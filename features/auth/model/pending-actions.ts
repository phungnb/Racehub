// Lời mời (CLB / giới thiệu) mở khi chưa đăng nhập được lưu lại để xử lý sau khi đăng nhập.
// Dùng localStorage (giữ 7 ngày) thay vì sessionStorage: người dùng thường xác nhận email ở tab khác,
// hoặc đăng nhập Google / Apple qua trình duyệt hệ thống rồi mới quay lại app.
const KEYS = { club: 'pending_join_code', referral: 'pending_referral_id' } as const
const TTL = 7 * 86_400_000

function put(key: string, value: string) {
  try { localStorage.setItem(key, JSON.stringify({ v: value, at: Date.now() })) } catch { /* private mode */ }
}
function get(key: string): string | null {
  try {
    const raw = localStorage.getItem(key) ?? sessionStorage.getItem(key)     // sessionStorage: bản cũ
    if (!raw) return null
    const x = raw.startsWith('{') ? (JSON.parse(raw) as { v: string; at: number }) : { v: raw, at: Date.now() }
    if (Date.now() - x.at > TTL) { take(key); return null }
    return x.v
  } catch { return null }
}
function take(key: string) {
  try { localStorage.removeItem(key); sessionStorage.removeItem(key) } catch { /* ignore */ }
}

export function savePendingClubCode(code: string) { put(KEYS.club, code) }
export function savePendingReferral(code: string) { put(KEYS.referral, code) }
/** Mã giới thiệu đang chờ (điền sẵn vào ô "Mã giới thiệu" khi đăng ký) */
export function peekPendingReferral(): string | null { return get(KEYS.referral) }
export function clearPendingReferral() { take(KEYS.referral) }

/** Trả về đường dẫn cần chuyển tới nếu có lời mời đang chờ, và xoá nó. */
export function takePendingRedirect(): string | null {
  const club = get(KEYS.club)
  if (club) { take(KEYS.club); return `/club/join/${encodeURIComponent(club)}?auto=1` }
  const ref = get(KEYS.referral)
  if (ref) { take(KEYS.referral); return `/join/${encodeURIComponent(ref)}?auto=1` }
  return null
}
