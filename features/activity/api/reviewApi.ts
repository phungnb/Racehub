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
