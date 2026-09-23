// Thử thách: mọi thao tác ghi đi qua RPC (migration 000600). Client chỉ đọc và hiển thị.
import { supabase } from '@/shared/lib/supabase'
import type { Audience, ChallengeDraft, ChallengeFormat, Objective, RewardSource, RewardSplit, TeamMode } from '../model/challenge'
import { draftToPayload } from '../model/challenge'

export type ChallengeTab = 'MINE' | 'DISCOVER' | 'CLUB' | 'ENDED'

export interface ChallengeListItem {
  id: string
  title: string
  description: string | null
  format: ChallengeFormat
  objective: Objective
  game_mode: string | null
  target_value: number
  start_date: string
  end_date: string
  status: string
  target_audience: Audience
  target_club_id: string | null
  club_name: string | null
  club_accent: string | null
  reward_xu: number
  participant_count: number
  max_slots: number | null
  my_status: string | null
  my_score: number | null
  my_rank: number | null
  total_score: number
  created_by: string | null
}

export interface Challenge {
  id: string
  title: string
  description: string | null
  format: ChallengeFormat
  objective: Objective
  game_mode: TeamMode | string | null
  target_value: number
  min_km: number
  min_pace: number
  max_pace: number
  daily_cap_km: number | null
  fixed_team_size: number
  max_slots: number
  start_date: string
  end_date: string
  status: string
  target_audience: Audience
  target_club_id: string | null
  reward_xu: number
  reward_source: RewardSource
  reward_split: RewardSplit
  created_by: string | null
  settled_at: string | null
  cancelled_reason: string | null
}

export interface ChallengeParticipant {
  id: string
  profile_id: string
  team_id: string | null
  status: string
  current_progress: number
  completed_at: string | null
  final_rank: number | null
  reward_xu: number
}

export interface TeamStanding {
  rank?: number
  team_id: string
  name: string
  color: string
  members: number
  active_members: number
  total: number
  score: number
}

export interface ChallengeDetail {
  challenge: Challenge
  club: { id: string; name: string; accent_color: string | null; avatar_url: string | null } | null
  creator: { id: string; display_name: string | null; avatar_url: string | null } | null
  invite_code: string | null
  stats: { participants: number; completed: number; total_score: number }
  me: ChallengeParticipant | null
  teams: TeamStanding[] | null
  can_manage: boolean
}

export interface LeaderboardEntry {
  rank: number
  participant_id: string
  user_id: string
  display_name: string
  avatar_url: string | null
  level: number
  team_id: string | null
  score: number
  distance_m: number
  run_count: number
  moving_s: number
  streak_days: number
  completed_at: string | null
  reward_xu: number
}

/** Postgres numeric về dạng chuỗi → đổi các cột số sang number */
function num<T extends object>(row: T, keys: (keyof T)[]): T {
  const out = { ...row } as Record<keyof T, unknown>
  for (const k of keys) if (out[k] !== null && out[k] !== undefined) out[k] = Number(out[k])
  return out as T
}

export async function listChallenges(tab: ChallengeTab, clubId?: string): Promise<ChallengeListItem[]> {
  const { data, error } = await supabase.rpc('list_challenges', { p_tab: tab, p_club_id: clubId ?? null })
  if (error) throw error
  return ((data ?? []) as ChallengeListItem[]).map((r) =>
    num(r, ['target_value', 'reward_xu', 'my_score', 'total_score', 'participant_count', 'my_rank']))
}

export async function getChallenge(id: string, code?: string | null): Promise<ChallengeDetail> {
  const { data, error } = await supabase.rpc('get_challenge', { p_challenge_id: id, p_code: code ?? null })
  if (error) throw error
  const d = data as ChallengeDetail
  d.challenge = num(d.challenge, ['target_value', 'min_km', 'min_pace', 'max_pace', 'daily_cap_km', 'reward_xu'])
  if (d.me) d.me = num(d.me, ['current_progress', 'reward_xu'])
  if (d.teams) d.teams = d.teams.map((t) => num(t, ['score', 'total']))
  return d
}

export async function getLeaderboard(id: string): Promise<LeaderboardEntry[]> {
  const { data, error } = await supabase.rpc('challenge_leaderboard', { p_challenge_id: id })
  if (error) throw error
  return ((data ?? []) as LeaderboardEntry[]).map((r) => num(r, ['score', 'distance_m', 'moving_s', 'reward_xu']))
}

export async function getTeamStandings(id: string): Promise<TeamStanding[]> {
  const { data, error } = await supabase.rpc('challenge_team_standings', { p_challenge_id: id })
  if (error) throw error
  return ((data ?? []) as TeamStanding[]).map((t) => num(t, ['score', 'total']))
}

export async function createChallenge(draft: ChallengeDraft, idempotencyKey: string) {
  const { data, error } = await supabase.rpc('create_challenge_v2', { p: draftToPayload(draft), p_idempotency_key: idempotencyKey })
  if (error) throw error
  return data as { challenge_id: string; fee: number; invite_code: string | null }
}

export async function previewFee(d: ChallengeDraft): Promise<number> {
  const { data, error } = await supabase.rpc('preview_challenge_fee', {
    p_format: d.format, p_max_slots: d.maxSlots, p_start: d.start, p_end: d.end, p_club: d.audience === 'CLUB_ONLY',
  })
  if (error) throw error
  return Number(data ?? 0)
}

export async function joinChallenge(id: string, code?: string | null, teamId?: string | null) {
  const { error } = await supabase.rpc('join_challenge', { p_challenge_id: id, p_code: code ?? null, p_team_id: teamId ?? null })
  if (error) throw error
}

export async function leaveChallenge(id: string) {
  const { error } = await supabase.rpc('leave_challenge', { p_challenge_id: id })
  if (error) throw error
}

export async function changeTeam(id: string, teamId: string) {
  const { error } = await supabase.rpc('change_challenge_team', { p_challenge_id: id, p_team_id: teamId })
  if (error) throw error
}

export async function cancelChallenge(id: string, reason?: string) {
  const { error } = await supabase.rpc('cancel_challenge', { p_challenge_id: id, p_reason: reason ?? null })
  if (error) throw error
}

export async function settleIfDue(id: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('settle_challenge_if_due', { p_challenge_id: id })
  if (error) throw error
  return Boolean(data)
}

const MESSAGES: Record<string, string> = {
  CHALLENGE_NOT_FOUND: 'Không tìm thấy thử thách, hoặc bạn cần mã mời để xem.',
  CHALLENGE_CLOSED: 'Thử thách đã kết thúc hoặc đã bị hủy.',
  CHALLENGE_FULL: 'Thử thách đã đủ người.',
  ALREADY_JOINED: 'Bạn đã tham gia thử thách này.',
  NOT_JOINED: 'Bạn chưa tham gia thử thách này.',
  INVALID_INVITE: 'Thử thách riêng tư — cần đúng mã mời.',
  CLUB_MEMBERS_ONLY: 'Chỉ thành viên CLB tổ chức mới tham gia được.',
  TEAM_ROSTER_LOCKED: 'Thử thách đội đã bắt đầu, không đổi đội hay vào thêm được.',
  TEAM_FULL: 'Đội này đã đủ người. Hãy chọn đội khác.',
  INVALID_TEAM: 'Đội không hợp lệ.',
  CANNOT_LEAVE_STARTED: 'Thử thách đội và 1-1 không rời được sau khi đã bắt đầu.',
  CANNOT_CANCEL_STARTED: 'Không hủy được khi thử thách đã bắt đầu và có người tham gia.',
  INVALID_TITLE: 'Tên thử thách cần từ 3 đến 120 ký tự.',
  DESC_TOO_LONG: 'Mô tả quá dài.',
  INVALID_TIME_RANGE: 'Thời gian không hợp lệ (kết thúc phải sau bắt đầu, tối thiểu 1 giờ, tối đa 1 năm).',
  TEAM_START_TOO_SOON: 'Thử thách đội cần bắt đầu sau ít nhất 10 phút.',
  TARGET_REQUIRED: 'Hãy đặt mục tiêu cho thử thách.',
  INVALID_STREAK: 'Chuỗi ngày cần cự ly tối thiểu mỗi ngày và không dài hơn thời gian thử thách.',
  INVALID_TEAMS: 'Cần từ 2 đến 8 đội, tên tối đa 40 ký tự.',
  INVALID_DISTANCE: 'Cự ly không hợp lệ.',
  INVALID_PACE: 'Khoảng pace không hợp lệ.',
  INVALID_MAX_SLOTS: 'Số người tối đa không hợp lệ.',
  INSUFFICIENT_BALANCE: 'Số Xu trong ví không đủ cho phí tạo và tiền treo thưởng.',
  INSUFFICIENT_TREASURY: 'Quỹ CLB không đủ để treo thưởng.',
  INVALID_AMOUNT: 'Số Xu thưởng không hợp lệ.',
  FORBIDDEN: 'Bạn không có quyền làm việc này.',
  RATE_LIMITED: 'Bạn thao tác hơi nhanh, thử lại sau ít phút.',
}

export function challengeErrorMessage(e: unknown): string {
  const err = e as { message?: string; code?: string } | null
  console.warn('[Thử thách] Lỗi gốc:', err?.code, err?.message)
  const raw = err?.message ?? ''
  const key = Object.keys(MESSAGES).find((k) => raw.includes(k))
  return key ? MESSAGES[key] : 'Không thực hiện được. Hãy thử lại.'
}
