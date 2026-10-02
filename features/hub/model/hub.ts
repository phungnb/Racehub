// Nhãn + hàm thuần cho Hội quán runner
import type { HubReason, PostKind, PrKey } from '../api/hubApi'

export const POST_KINDS: Record<PostKind, { label: string; emoji: string; hint: string; placeholder: string }> = {
  BUDDY: { label: 'Tìm bạn chạy', emoji: '🏃', hint: 'Rủ chạy cùng một buổi / chạy đều hằng tuần', placeholder: 'Sáng thứ 7 chạy 10K quanh Hồ Tây, pace 6:00, ai đi cùng?' },
  RACE: { label: 'Đi giải cùng', emoji: '🏅', hint: 'Tìm bạn cùng đăng ký, đi chung, ở chung', placeholder: 'Mình đăng ký HM VnExpress Hà Nội, tìm bạn đi chung xe + tập cùng trước giải.' },
  PACER: { label: 'Pacer', emoji: '⏱️', hint: 'Cần pacer hoặc nhận kèm pace', placeholder: 'Cần pacer 2:00 cho HM tháng sau / Mình nhận kèm pace 5:30 cho 10K.' },
  SHARE: { label: 'Khoe thành tích', emoji: '🔥', hint: 'PR mới, cột mốc, buổi chạy đáng nhớ', placeholder: 'Vừa phá PR 10K: 49:30 sau 3 tháng tập!' },
  ASK: { label: 'Hỏi đáp', emoji: '💬', hint: 'Giày, giáo án, chấn thương, cung đường…', placeholder: 'Giày nào êm cho long run 25 km?' },
}

export const PR_LABEL: Record<PrKey, string> = { '5K': '5K', '10K': '10K', HM: 'Half', FM: 'Full' }
export const HUB_REASONS: Record<HubReason, string> = {
  PACE: 'Cùng pace', PROVINCE: 'Cùng tỉnh', GOAL: 'Cùng mục tiêu', SLOT: 'Cùng khung giờ', ACTIVE: 'Chạy đều tuần này',
}

/** 1530 → "25:30" · 7200 → "2:00:00" */
export function formatDuration(s: number | null | undefined): string | null {
  if (s == null || !Number.isFinite(s) || s <= 0) return null
  const t = Math.round(s)
  const h = Math.floor(t / 3600)
  const m = Math.floor((t % 3600) / 60)
  const sec = t % 60
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`
}

/** "5:30" → 330 giây; sai định dạng → null */
export function parsePace(v: string): number | null {
  const m = /^\s*(\d{1,2})[:.'](\d{2})\s*$/.exec(v)
  if (!m) return null
  const s = Number(m[1]) * 60 + Number(m[2])
  return Number(m[2]) < 60 && s >= 150 && s <= 1200 ? s : null
}

/** Giống máy chủ (private.has_contact_or_link): báo sớm trước khi gửi */
export function hasContactOrLink(text: string): boolean {
  if (/(https?:\/\/|www\.|\.com|\.vn|\.net|zalo|telegram|t\.me|fb\.com|facebook)/i.test(text)) return true
  return /(\+?84|0)\d{9}/.test(text.replace(/[\s.-]/g, ''))
}
