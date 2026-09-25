import { supabase } from '@/shared/lib/supabase'
import { normalizeActivity, type ActivitySummary } from '../model/activity'
import type { Split, TrackPoint } from '../model/route'
import { systemErrorMessage } from '@/shared/lib/errors'

export type { ActivitySummary }

export async function listMyRecentActivities(userId: string, limit = 10): Promise<ActivitySummary[]> {
  const { data, error } = await supabase
    .from('activities')
    .select('*')
    .eq('user_id', userId)
    .neq('status', 'DELETED')
    .order('started_at', { ascending: false, nullsFirst: false })
    .limit(limit)
  if (error) throw error
  return (data ?? []).map(normalizeActivity)
}

/* ------------------------- Chi tiết bài chạy (001900) ------------------------- */

export interface ActivityDetail {
  id: string
  title: string
  source: string | null
  sport_type: string | null
  device_name: string | null
  started_at: string
  distance_m: number
  moving_s: number
  elapsed_s: number
  avg_pace_s: number | null
  elevation_gain_m: number
  avg_heartrate: number | null
  max_heartrate: number | null
  avg_cadence: number | null
  calories: number | null
  validation_status: string | null
  validation_reason: string | null
  earned_xu: number | null
  earned_xp: number | null
  is_mine: boolean
  owner: { id: string; display_name: string | null; avatar_url: string | null; level: number | null }
  map_allowed: boolean
  polyline: string | null
  points: TrackPoint[] | null
  splits: Split[] | null
  needs_detail: boolean
  challenges: { id: string; title: string; counted_m: number }[]
  cheers: { count: number; total: number }
  compare: { runs: number; avg_distance_m: number | null; avg_pace_s: number | null; longest_30d: boolean } | null
}

export async function getActivityDetail(id: string): Promise<ActivityDetail> {
  const { data, error } = await supabase.rpc('activity_detail', { p_activity_id: id })
  if (error) throw error
  const d = data as ActivityDetail
  return { ...d, distance_m: Number(d.distance_m), elevation_gain_m: Number(d.elevation_gain_m ?? 0),
    earned_xu: d.earned_xu == null ? null : Number(d.earned_xu), cheers: { count: Number(d.cheers?.count ?? 0), total: Number(d.cheers?.total ?? 0) } }
}

/** Nhờ server lấy từng km + tuyến đầy đủ từ Strava (chỉ chủ bài, một lần) */
export async function requestActivityEnrich(id: string): Promise<boolean> {
  const res = await fetch(`/api/activities/${encodeURIComponent(id)}/enrich`, { method: 'POST' })
  if (!res.ok) return false
  const j = (await res.json().catch(() => ({}))) as { result?: string }
  return j.result === 'OK'
}

export function activityErrorMessage(e: unknown): string {
  const m = (e as { message?: string } | null)?.message ?? String(e)
  if (m.includes('ACTIVITY_NOT_FOUND')) return 'Không tìm thấy bài chạy, hoặc người chạy đã để riêng tư.'
  return systemErrorMessage(e, 'Không tải được bài chạy. Thử lại sau.')
}
