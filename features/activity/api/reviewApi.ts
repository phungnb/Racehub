// Bài chạy chờ xác minh (009700): lựa chọn của người chạy + "chỉ tính phần có GPS"
import { supabase } from '@/shared/lib/supabase'

export interface ReviewInfo { status: string; reason: string | null; can_accept_verified: boolean; gap_distance_m: number; verified_distance_m: number }
export interface AcceptResult { status: 'APPROVED' | 'REJECTED' | 'PENDING'; reason: string | null; distance_m: number; earned_xu: number; earned_xp: number }

export async function getReviewInfo(activityId: string): Promise<ReviewInfo> {
  const { data, error } = await supabase.rpc('activity_review_info', { p_activity: activityId })
  if (error) throw error
  const r = data as ReviewInfo
  return { ...r, gap_distance_m: Number(r.gap_distance_m ?? 0), verified_distance_m: Number(r.verified_distance_m ?? 0) }
}
export async function acceptVerifiedDistance(activityId: string): Promise<AcceptResult> {
  const { data, error } = await supabase.rpc('accept_verified_distance', { p_activity: activityId })
  if (error) throw error
  const r = data as AcceptResult
  return { ...r, distance_m: Number(r.distance_m ?? 0), earned_xu: Number(r.earned_xu ?? 0), earned_xp: Number(r.earned_xp ?? 0) }
}

// ---------------------------------------------------------------------
// 012500: bài đã loại, khôi phục bài loại nhầm, tỷ lệ báo nhầm
// ---------------------------------------------------------------------
import type { PendingRun } from '../components/PendingRunCard'

const RESTORE_ERRORS: Record<string, string> = {
  NOTE_REQUIRED: 'Hãy ghi lý do khôi phục (ít nhất 5 ký tự).',
  OVERLAPS_COUNTED_RUN: 'Bài trùng giờ với một bài khác đang được tính — khôi phục sẽ tính 2 lần.',
  ACTIVITY_NOT_REJECTED: 'Bài này không còn ở trạng thái bị loại.',
  FORBIDDEN: 'Bạn không có quyền xem lại bài này (không tự khôi phục bài của mình).',
}
export function restoreErrorMessage(e: unknown): string {
  const m = (e as { message?: string })?.message ?? ''
  const code = Object.keys(RESTORE_ERRORS).find((k) => m.includes(k))
  return code ? RESTORE_ERRORS[code] : 'Không khôi phục được bài chạy. Thử lại sau.'
}

/** Bài bị loại trong N ngày (clubId = null: toàn hệ thống, chỉ admin) */
export async function listRejectedRuns(clubId: string | null, days = 30): Promise<PendingRun[]> {
  const { data, error } = await supabase.rpc('rejected_activities', { p_club_id: clubId, p_days: days })
  if (error) throw error
  return (data ?? []) as PendingRun[]
}
export async function restoreRun(activityId: string, note: string) {
  const { error } = await supabase.rpc('restore_activity', { p_activity_id: activityId, p_note: note })
  if (error) throw error
}

export interface FraudReviewStats {
  days: number; held: number; still_pending: number; approved_after_review: number; rejected: number; restored: number
  false_positive_rate: number | null; by_rule: { code: string; held: number; approved: number }[]
}
export async function getFraudReviewStats(days = 90): Promise<FraudReviewStats> {
  const { data, error } = await supabase.rpc('fraud_review_stats', { p_days: days })
  if (error) throw error
  return data as FraudReviewStats
}
