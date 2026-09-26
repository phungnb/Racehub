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
  /** km thưởng ngày vàng (migration 007700) — xếp hạng theo distance_m + bonus_m */
  bonus_m: number
  run_count: number
  moving_s: number
}

export async function listInbox(): Promise<InboxClub[]> {
  const { data, error } = await supabase.rpc('my_clubs_inbox')
  if (error) throw error
  return (data ?? []) as InboxClub[]
}

export async function getLeaderboard(clubId: string, period: LeaderboardPeriod): Promise<LeaderboardRow[]> {
  // Bản có km thưởng ngày vàng; chưa chạy migration 007700 thì dùng bản cũ
  const v2 = await supabase.rpc('club_leaderboard_v2', { p_club_id: clubId, p_period: period })
  const { data, error } = v2.error && /club_leaderboard_v2|PGRST202|42883/.test(`${v2.error.code} ${v2.error.message}`)
    ? await supabase.rpc('club_leaderboard', { p_club_id: clubId, p_period: period })
    : v2
  if (error) throw error
  return ((data ?? []) as LeaderboardRow[]).map((r) => ({
    ...r, distance_m: Number(r.distance_m), bonus_m: Number(r.bonus_m ?? 0), moving_s: Number(r.moving_s),
  }))
}

/** Ngày vàng ×1,5 / ×2 / ×3 của CLB (migration 007700) */
export interface BoostDay { day: string; multiplier: number; title: string; editable: boolean }
const toBoost = (x: unknown) => ((x ?? []) as BoostDay[]).map((b) => ({ ...b, multiplier: Number(b.multiplier) }))
export async function getBoostDays(clubId: string): Promise<BoostDay[]> {
  const { data, error } = await supabase.rpc('club_boost_days', { p_club_id: clubId })
  if (error) throw error
  return toBoost(data)
}
export async function setBoostDay(clubId: string, day: string, multiplier: number, title: string): Promise<BoostDay[]> {
  const { data, error } = await supabase.rpc('set_club_boost_day', { p_club_id: clubId, p_day: day, p_multiplier: multiplier, p_title: title })
  if (error) throw error
  return toBoost(data)
}
export async function deleteBoostDay(clubId: string, day: string): Promise<BoostDay[]> {
  const { data, error } = await supabase.rpc('delete_club_boost_day', { p_club_id: clubId, p_day: day })
  if (error) throw error
  return toBoost(data)
}

/** Đại sảnh danh vọng của CLB (migration 007800) */
export interface HallPerson { user_id: string; name: string; avatar_url: string | null }
export interface HallOfFame {
  marathon: (HallPerson & { times: number; first_at: string; best_s: number | null })[]
  half: (HallPerson & { times: number; first_at: string; best_s: number | null })[]
  records: (HallPerson & { label: '5K' | '10K' | '21K' | '42K'; rank: number; best_s: number })[]
  year: (HallPerson & { rank: number; distance_m: number; runs: number })[]
  milestones: (HallPerson & { code: string; label: string; reached_at: string })[]
  year_start: string
}
export async function getHallOfFame(clubId: string): Promise<HallOfFame> {
  const { data, error } = await supabase.rpc('club_hall_of_fame', { p_club_id: clubId })
  if (error) throw error
  const h = data as HallOfFame
  return { ...h, year: h.year.map((y) => ({ ...y, distance_m: Number(y.distance_m) })) }
}
