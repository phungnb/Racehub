// CLB đấu CLB + bảng xếp hạng CLB (migration 002600)
import { supabase } from '@/shared/lib/supabase'

export type BattleMetric = 'TOTAL_KM' | 'AVG_KM'
export type BattleStatus = 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'CANCELLED' | 'FINISHED'

export interface BattleSide {
  club_id: string
  name: string
  avatar_url: string | null
  accent_color: string | null
  members: number
  runners: number
  km: number
  avg_km: number
  top: { user_id: string; display_name: string; avatar_url: string | null; km: number; runs: number }[]
}

export interface ClubBattle {
  id: string
  metric: BattleMetric
  start_at: string
  end_at: string
  status: BattleStatus
  message: string | null
  created_at: string
  winner_id: string | null
  leader_id: string | null
  score_key: 'km' | 'avg_km'
  challenger: BattleSide
  opponent: BattleSide
  can_respond: boolean
  can_cancel: boolean
}

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

export async function listClubBattles(clubId: string): Promise<ClubBattle[]> {
  const { data, error } = await supabase.rpc('club_battles_of', { p_club_id: clubId })
  if (error) throw error
  return (data ?? []) as ClubBattle[]
}

export async function createClubBattle(p: { clubId: string; opponentId: string; metric: BattleMetric; start: string; end: string; message?: string }) {
  const { data, error } = await supabase.rpc('create_club_battle', {
    p_club_id: p.clubId, p_opponent_id: p.opponentId, p_metric: p.metric, p_start: p.start, p_end: p.end, p_message: p.message ?? null,
  })
  if (error) throw error
  return data as ClubBattle
}

export async function respondClubBattle(id: string, accept: boolean) {
  const { data, error } = await supabase.rpc('respond_club_battle', { p_battle_id: id, p_accept: accept })
  if (error) throw error
  return data as ClubBattle
}

export async function cancelClubBattle(id: string) {
  const { data, error } = await supabase.rpc('cancel_club_battle', { p_battle_id: id })
  if (error) throw error
  return data as ClubBattle
}

/** Tất toán các trận đã hết giờ (idempotent; cron cũng chạy hằng ngày) */
export async function settleDueBattles() {
  await supabase.rpc('settle_due_club_battles')
}

export async function getClubRankings(period: 'WEEK' | 'MONTH'): Promise<ClubRank[]> {
  const { data, error } = await supabase.rpc('club_rankings', { p_period: period })
  if (error) throw error
  return (data ?? []) as ClubRank[]
}
