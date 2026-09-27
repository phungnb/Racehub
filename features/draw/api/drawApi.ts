// Quay thưởng dùng chung toàn app (migration 008400, sân khấu 009300): chiến dịch tổ chức, thử thách, CLB, giải chạy ảo, toàn hệ thống.
import { supabase } from '@/shared/lib/supabase'
import { systemErrorMessage } from '@/shared/lib/errors'

export type DrawScope = 'ORG_CAMPAIGN' | 'CHALLENGE' | 'CLUB' | 'RACE' | 'SYSTEM'
export type DrawRule = 'COMPLETED' | 'ACTIVE' | 'ALL' | 'PICKED'
export interface DrawWinner {
  user_id: string; name: string; avatar_url: string | null; prize: string; position: number; me: boolean
  /** 009300: suất thuộc giải thứ mấy; ABSENT = vắng mặt, suất đã quay lại cho người khác */
  prize_idx: number | null; status: 'WON' | 'ABSENT'
}
export interface DrawCandidate { user_id: string; name: string; avatar_url: string | null; completed: boolean }
export interface LuckyDraw {
  id: string; scope: DrawScope; ref_id: string | null; title: string; rule: DrawRule
  prizes: { name: string; qty: number }[]; exclude_winners: boolean; status: 'READY' | 'LIVE' | 'DONE' | 'CANCELLED'
  seed: string | null; entrant_count: number | null; entrants_hash: string | null; created_at: string; run_at: string | null
  can_manage: boolean; creator_name: string | null; winners: DrawWinner[]; eligible_now: number | null
  /** 009300: mã băm seed công bố lúc bắt đầu quay; seed chỉ hiện sau khi công bố kết quả */
  seed_hash?: string | null; started_at?: string | null; picked_count?: number; excluded_count?: number
  /** Tên chạy trong vòng quay (khi đang quay) */
  reel?: { name: string; avatar_url: string | null }[] | null
}
export interface DrawInput { title: string; rule: DrawRule; prizes: { name: string; qty: number }[]; exclude_winners: boolean; picked?: string[]; excluded?: string[] }

const call = async <T>(fn: string, args: Record<string, unknown>): Promise<T> => {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw error
  return data as T
}

export const listDraws = (scope: DrawScope, refId: string | null) => call<LuckyDraw[]>('lucky_draws_for', { p_scope: scope, p_ref: refId })
export const createDraw = (scope: DrawScope, refId: string | null, p: DrawInput) =>
  call<LuckyDraw>('create_lucky_draw', { p_scope: scope, p_ref: refId, p })
export const listCandidates = (scope: DrawScope, refId: string | null) => call<DrawCandidate[]>('lucky_draw_candidates', { p_scope: scope, p_ref: refId })
export const startDraw = (id: string) => call<LuckyDraw>('start_lucky_draw', { p_id: id })
export const drawNext = (id: string, prize: number) => call<LuckyDraw>('draw_next', { p_id: id, p_prize: prize })
export const drawAbsent = (id: string, userId: string) => call<LuckyDraw>('draw_absent', { p_id: id, p_user: userId })
export const finishDraw = (id: string) => call<LuckyDraw>('finish_lucky_draw', { p_id: id })
export const runDraw = (id: string) => call<LuckyDraw>('run_lucky_draw', { p_id: id })
export const cancelDraw = (id: string) => call<void>('cancel_lucky_draw', { p_id: id })

const MESSAGES: Record<string, string> = {
  NO_ENTRANTS: 'Chưa có ai đủ điều kiện quay (hoặc tất cả đã trúng ở lượt trước).',
  DRAW_CLOSED: 'Lượt quay này đã quay hoặc đã huỷ.',
  INVALID_PRIZES: 'Nhập 1–10 giải, tổng tối đa 200 suất.',
  TITLE_REQUIRED: 'Tên lượt quay cần 3–120 ký tự.',
  TOO_MANY_DRAWS: 'Đang có 5 lượt quay chờ. Quay hoặc huỷ bớt trước.',
  PICK_REQUIRED: 'Hãy chọn ít nhất một người thuộc chương trình.',
  TOO_MANY_PEOPLE: 'Chọn tối đa 2.000 người.',
  DRAW_NOT_LIVE: 'Lượt quay chưa bắt đầu hoặc đã kết thúc.',
  PRIZE_FULL: 'Giải này đã đủ người trúng. Chọn giải khác.',
  POOL_EXHAUSTED: 'Đã hết người trong danh sách để quay.',
  NOT_A_WINNER: 'Người này không còn trong danh sách trúng.',
  NO_WINNERS: 'Chưa có ai trúng — quay ít nhất một giải trước khi công bố.',
  DRAW_STARTED: 'Đã quay ra người trúng nên không huỷ được. Hãy quay tiếp hoặc công bố.',
  FORBIDDEN: 'Bạn không có quyền làm việc này.',
}
export function drawErrorMessage(e: unknown): string {
  const raw = (e as { message?: string } | null)?.message ?? ''
  const key = Object.keys(MESSAGES).find((k) => raw.includes(k))
  return key ? MESSAGES[key] : systemErrorMessage(e, 'Không thực hiện được. Hãy thử lại.')
}
