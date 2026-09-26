// Hướng B+ (migration 007000): bài từ Strava chỉ hiện cho người khác khi runner đồng ý.
import { supabase } from '@/shared/lib/supabase'

export type StravaSharePolicy = 'OPT_IN' | 'OWNER_ONLY' | 'ALL'
export interface StravaSharing {
  policy: StravaSharePolicy
  /** null = chưa trả lời */
  consent: boolean | null
  connected: boolean
  strava_runs: number
  hidden_runs: number
}
export interface StravaSharingStats { policy: StravaSharePolicy; connected: number; opted_in: number; opted_out: number; hidden_runs: number }

export async function myStravaSharing(): Promise<StravaSharing | null> {
  const { data, error } = await supabase.rpc('my_strava_sharing')
  if (error) throw error
  return (data as StravaSharing | null) ?? null
}

export async function setStravaSharing(on: boolean): Promise<StravaSharing> {
  const { data, error } = await supabase.rpc('set_strava_sharing', { p_on: on })
  if (error) throw error
  return data as StravaSharing
}

export async function adminStravaSharingStats(): Promise<StravaSharingStats | null> {
  const { data, error } = await supabase.rpc('admin_strava_sharing_stats')
  if (error) throw error
  return (data as StravaSharingStats | null) ?? null
}

export async function adminSetStravaPolicy(policy: StravaSharePolicy, reason: string) {
  const { data, error } = await supabase.rpc('admin_set_strava_policy', { p_policy: policy, p_reason: reason })
  if (error) throw error
  return data as { policy: StravaSharePolicy; changed: number }
}
