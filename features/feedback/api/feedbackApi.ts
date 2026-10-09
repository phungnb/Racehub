// Hộp thư góp ý (migration 015000). Chỉ ghi qua RPC.
import { supabase } from '@/shared/lib/supabase'
import { errorMessage } from '@/shared/lib/errors'
import type { FeedbackKind } from '../model/feedback'

export async function submitFeedback(p: { kind: FeedbackKind; rating: number | null; body: string; platform: string; page: string }) {
  const { error } = await supabase.rpc('submit_feedback', { p_kind: p.kind, p_rating: p.rating, p_body: p.body.trim() || null, p_platform: p.platform, p_page: p.page })
  if (error) throw error
}

const MESSAGES: Record<string, string> = {
  FEEDBACK_EMPTY: 'Hãy chọn mức hài lòng hoặc viết vài chữ (ít nhất 3 ký tự).',
  FEEDBACK_TOO_LONG: 'Góp ý tối đa 1.000 ký tự.',
  FEEDBACK_RATE_LIMIT: 'Bạn đã gửi nhiều góp ý hôm nay rồi — cảm ơn bạn! Thử lại vào ngày mai nhé.',
  INVALID_FEEDBACK_KIND: 'Loại góp ý không hợp lệ.',
  INVALID_FEEDBACK_RATING: 'Mức hài lòng không hợp lệ.',
}
export function feedbackErrorMessage(e: unknown): string {
  const raw = (e as { message?: string } | null)?.message ?? ''
  const k = Object.keys(MESSAGES).find((x) => raw.includes(x))
  return k ? MESSAGES[k] : errorMessage(e)
}
