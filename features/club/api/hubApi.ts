// Hộp thư CLB (các CLB của tôi + tin chưa đọc) và BXH CLB.
import { supabase } from '@/shared/lib/supabase'
import type { ClubRole, MemberStatus } from '../model/roles'

export interface InboxClub {
  club_id: string
  name: string
  avatar_url: string | null
  accent_color: string | null
  role: ClubRole
  member_status: MemberStatus
  member_count: number
  unread_count: number
  last_message_body: string | null
  last_message_author: string | null
  last_message_at: string | null
  pinned_title: string | null
}

export type LeaderboardPeriod = 'WEEK' | 'MONTH' | 'ALL'

export interface LeaderboardRow {
  rank: number
  user_id: string
  display_name: string
  avatar_url: string | null
  level: number
  role: ClubRole
  distance_m: number
  run_count: number
  moving_s: number
}

export async function listInbox(): Promise<InboxClub[]> {
  const { data, error } = await supabase.rpc('my_clubs_inbox')
  if (error) throw error
  return (data ?? []) as InboxClub[]
}

export async function getLeaderboard(clubId: string, period: LeaderboardPeriod): Promise<LeaderboardRow[]> {
  const { data, error } = await supabase.rpc('club_leaderboard', { p_club_id: clubId, p_period: period })
  if (error) throw error
  return ((data ?? []) as LeaderboardRow[]).map((r) => ({ ...r, distance_m: Number(r.distance_m), moving_s: Number(r.moving_s) }))
}
