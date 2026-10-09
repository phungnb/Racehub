// Hộp thư góp ý (migration 015000): loại góp ý, điểm hài lòng và luật hiện / ẩn bong bóng
export type FeedbackKind = 'IDEA' | 'BUG' | 'LOVE' | 'OTHER'

export const FEEDBACK_KINDS: { value: FeedbackKind; label: string }[] = [
  { value: 'IDEA', label: 'Ý tưởng' },
  { value: 'BUG', label: 'Báo lỗi' },
  { value: 'LOVE', label: 'Khen' },
  { value: 'OTHER', label: 'Khác' },
]
export const RATINGS = [
  { value: 1, emoji: '😞', label: 'Rất tệ' }, { value: 2, emoji: '🙁', label: 'Tệ' }, { value: 3, emoji: '😐', label: 'Tạm được' },
  { value: 4, emoji: '🙂', label: 'Tốt' }, { value: 5, emoji: '😍', label: 'Rất tốt' },
]
export const MAX_BODY = 1000
export const MIN_BODY = 3

/** Gửi được khi có điểm hài lòng hoặc lời nhắn đủ dài (khớp luật của máy chủ) */
export const canSubmit = (rating: number | null, body: string) => rating !== null || body.trim().length >= MIN_BODY

/** Sau khi gửi, ẩn bong bóng bao nhiêu ngày */
export const HIDE_DAYS_AFTER_SEND = 14
/** Chờ bao lâu sau khi mở app thì bong bóng mới hiện (ms) */
export const SHOW_DELAY_MS = 2500

/**
 * Bong bóng hiện khi: chưa tắt trong lần mở app này và chưa gửi góp ý trong HIDE_DAYS_AFTER_SEND ngày qua.
 * `sentAt` là mốc (ms) gửi gần nhất, null nếu chưa gửi.
 */
export function bubbleVisible(now: number, dismissed: boolean, sentAt: number | null): boolean {
  if (dismissed) return false
  if (sentAt !== null && now - sentAt < HIDE_DAYS_AFTER_SEND * 86_400_000) return false
  return true
}
