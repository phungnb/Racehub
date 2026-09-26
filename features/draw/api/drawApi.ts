// Quay thưởng dùng chung toàn app (migration 008400): chiến dịch tổ chức, thử thách, CLB, giải chạy ảo, toàn hệ thống.
import { supabase } from '@/shared/lib/supabase'
import { systemErrorMessage } from '@/shared/lib/errors'

export type DrawScope = 'ORG_CAMPAIGN' | 'CHALLENGE' | 'CLUB' | 'RACE' | 'SYSTEM'
export type DrawRule = 'COMPLETED' | 'ACTIVE' | 'ALL'
export interface DrawWinner { user_id: string; name: string; avatar_url: string | null; prize: string; position: number; me: boolean }
export interface LuckyDraw {
  id: string; scope: DrawScope; ref_id: string | null; title: string; rule: DrawRule
  prizes: { name: string; qty: number }[]; exclude_winners: boolean; status: 'READY' | 'DONE' | 'CANCELLED'
  seed: string | null; entrant_count: number | null; entrants_hash: string | null; created_at: string; run_at: string | null
  can_manage: boolean; creator_name: string | null; winners: DrawWinner[]; eligible_now: number | null
}

const call = async <T>(fn: string, args: Record<string, unknown>): Promise<T> => {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw error
  return data as T
}

export const listDraws = (scope: DrawScope, refId: string | null) => call<LuckyDraw[]>('lucky_draws_for', { p_scope: scope, p_ref: refId })
export const createDraw = (scope: DrawScope, refId: string | null, p: { title: string; rule: DrawRule; prizes: { name: string; qty: number }[]; exclude_winners: boolean }) =>
  call<LuckyDraw>('create_lucky_draw', { p_scope: scope, p_ref: refId, p })
export const runDraw = (id: string) => call<LuckyDraw>('run_lucky_draw', { p_id: id })
export const cancelDraw = (id: string) => call<void>('cancel_lucky_draw', { p_id: id })

const MESSAGES: Record<string, string> = {
  NO_ENTRANTS: 'Chưa có ai đủ điều kiện quay (hoặc tất cả đã trúng ở lượt trước).',
  DRAW_CLOSED: 'Lượt quay này đã quay hoặc đã huỷ.',
  INVALID_PRIZES: 'Nhập 1–10 giải, tổng tối đa 200 suất.',
  TITLE_REQUIRED: 'Tên lượt quay cần 3–120 ký tự.',
  TOO_MANY_DRAWS: 'Đang có 5 lượt quay chờ. Quay hoặc huỷ bớt trước.',
  FORBIDDEN: 'Bạn không có quyền làm việc này.',
}
export function drawErrorMessage(e: unknown): string {
  const raw = (e as { message?: string } | null)?.message ?? ''
  const key = Object.keys(MESSAGES).find((k) => raw.includes(k))
  return key ? MESSAGES[key] : systemErrorMessage(e, 'Không thực hiện được. Hãy thử lại.')
}
