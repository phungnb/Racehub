// Lời mời (CLB / giới thiệu) mở khi chưa đăng nhập được lưu lại để xử lý sau khi đăng nhập.
const KEYS = { club: 'pending_join_code', referral: 'pending_referral_id' } as const

export function savePendingClubCode(code: string) {
  try { sessionStorage.setItem(KEYS.club, code) } catch { /* private mode */ }
}
export function savePendingReferral(id: string) {
  try { sessionStorage.setItem(KEYS.referral, id) } catch { /* private mode */ }
}

/** Trả về đường dẫn cần chuyển tới nếu có lời mời đang chờ, và xoá nó. */
export function takePendingRedirect(): string | null {
  try {
    const club = sessionStorage.getItem(KEYS.club)
    if (club) { sessionStorage.removeItem(KEYS.club); return `/club/join/${encodeURIComponent(club)}` }
    const ref = sessionStorage.getItem(KEYS.referral)
    if (ref) { sessionStorage.removeItem(KEYS.referral); return `/join/${encodeURIComponent(ref)}` }
  } catch { /* ignore */ }
  return null
}
