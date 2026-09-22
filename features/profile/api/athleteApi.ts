import { supabase } from '@/shared/lib/supabase'
/* ────────────────────────────────────────────────────────────
 * Hồ sơ vận động viên công khai – gọi các RPC trong athlete_profile.sql
 * Đặt tại: features/profile/api/athleteApi.ts
 * ──────────────────────────────────────────────────────────── */

export type Visibility = 'PUBLIC' | 'CLUB' | 'PRIVATE'

export interface PeriodStats {
  distance_m: number
  time_s: number
  count: number
}

export interface AthleteProfileData {
  id: string
  display_name: string | null
  avatar_url: string | null
  can_view_profile: boolean
  is_self?: boolean
  level?: number
  xp?: number
  joined_at?: string
  region?: string | null
  can_view_activities?: boolean
  stats?: { week: PeriodStats; month: PeriodStats; year: PeriodStats; all: PeriodStats } | null
  clubs?: { id: string; name: string; avatar_url: string | null }[]
}

export interface AthleteActivity {
  id: string
  title: string | null
  source: string | null
  started_at: string | null
  distance_m: number
  moving_time_s: number
  avg_pace_s: number | null
  elevation_gain_m: number | null
  has_map: boolean
}

export interface AthleteSearchResult {
  id: string
  display_name: string | null
  avatar_url: string | null
  level: number | null
  region: string | null
}

export interface AthleteSettings {
  region: string | null
  profile_visibility: Visibility
  activity_visibility: Visibility
  map_visibility: Visibility
  consented_at: string | null
}

export const DEFAULT_SETTINGS: AthleteSettings = {
  region: null,
  profile_visibility: 'PUBLIC',
  activity_visibility: 'PUBLIC',
  map_visibility: 'PRIVATE',
  consented_at: null,
}

/* ------------------------------ Gọi RPC ------------------------------ */

export async function getAthleteProfile(userId: string): Promise<AthleteProfileData | null> {
  const { data, error } = await supabase.rpc('get_athlete_profile', { p_user_id: userId })
  if (error) throw error
  return (data as AthleteProfileData | null) ?? null
}

export async function listAthleteActivities(userId: string, limit = 10, offset = 0): Promise<AthleteActivity[]> {
  const { data, error } = await supabase.rpc('list_athlete_activities', {
    p_user_id: userId,
    p_limit: limit,
    p_offset: offset,
  })
  if (error) throw error
  return (data as AthleteActivity[] | null) ?? []
}

export async function getActivityRoute(activityId: string): Promise<[number, number][] | null> {
  const { data, error } = await supabase.rpc('get_activity_route', { p_activity_id: activityId })
  if (error) throw error
  return (data as [number, number][] | null) ?? null
}

export async function searchAthletes(query: string): Promise<AthleteSearchResult[]> {
  const { data, error } = await supabase.rpc('search_athletes', { p_query: query, p_limit: 20 })
  if (error) throw error
  return (data as AthleteSearchResult[] | null) ?? []
}

/* --------------------------- Cài đặt riêng tư --------------------------- */

export async function getMySettings(userId: string): Promise<AthleteSettings> {
  const { data, error } = await supabase
    .from('profile_settings')
    .select('region, profile_visibility, activity_visibility, map_visibility, consented_at')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw error
  return (data as AthleteSettings | null) ?? DEFAULT_SETTINGS
}

export async function saveMySettings(userId: string, s: AthleteSettings): Promise<void> {
  const { error } = await supabase
    .from('profile_settings')
    .upsert(
      {
        user_id: userId,
        region: s.region?.trim() || null,
        profile_visibility: s.profile_visibility,
        activity_visibility: s.activity_visibility,
        map_visibility: s.map_visibility,
        consented_at: s.consented_at,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' },
    )
  if (error) throw error
}

/* ------------------------------ Định dạng ------------------------------ */

export const fmtKm = (m?: number | null) =>
  ((m ?? 0) / 1000).toLocaleString('vi-VN', { maximumFractionDigits: 1 })

export function fmtDuration(seconds?: number | null): string {
  const t = Math.round(seconds ?? 0)
  const h = Math.floor(t / 3600)
  const m = Math.floor((t % 3600) / 60)
  const s = t % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}

/** Giây / km → 5'15" */
export function fmtPace(secPerKm?: number | null): string {
  if (!secPerKm || !isFinite(secPerKm) || secPerKm <= 0) return '—'
  const total = Math.round(secPerKm)
  return `${Math.floor(total / 60)}'${String(total % 60).padStart(2, '0')}"`
}

export const paceOf = (distanceM: number, timeS: number): number | null =>
  distanceM > 0 && timeS > 0 ? timeS / (distanceM / 1000) : null

export function dayLabel(iso?: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  const today = new Date()
  const yesterday = new Date()
  yesterday.setDate(today.getDate() - 1)
  if (d.toDateString() === today.toDateString()) return 'Hôm nay'
  if (d.toDateString() === yesterday.toDateString()) return 'Hôm qua'
  return d.toLocaleDateString('vi-VN')
}
