// Bảng xếp hạng CLB (migration 002600). Đấu CLB 1–1 đã chuyển sang module cup (012700).
import { supabase } from '@/shared/lib/supabase'

export type ClubTier = 'BRONZE' | 'SILVER' | 'GOLD' | 'PLATINUM' | 'DIAMOND'

export interface ClubRank {
  rank: number
  club_id: string
  name: string
  avatar_url: string | null
  accent_color: string | null
  members: number
  runners: number
  km: number
  avg_km: number
  tier: ClubTier
  is_mine: boolean
}

export async function getClubRankings(period: 'WEEK' | 'MONTH'): Promise<ClubRank[]> {
  const { data, error } = await supabase.rpc('club_rankings', { p_period: period })
  if (error) throw error
  return (data ?? []) as ClubRank[]
}
