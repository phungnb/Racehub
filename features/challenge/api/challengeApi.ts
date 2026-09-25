// Thử thách: mọi thao tác ghi đi qua RPC (migration 000600). Client chỉ đọc và hiển thị.
import { supabase } from '@/shared/lib/supabase'
import type { Audience, ChallengeDraft, ChallengeFormat, Objective, RewardSource, RewardSplit, TeamMode } from '../model/challenge'
import { draftToPayload, effectiveSlots, type pledgePayload } from '../model/challenge'
import { toPolicy, type EconomyPolicy } from '@/shared/lib/economy'
import { systemErrorMessage } from '@/shared/lib/errors'
import { prepareImage } from '@/shared/lib/image'
import type { HonorCategory, StoredHonorDesign } from '../model/honor'

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
  pledge_enabled?: boolean
  pledge_options?: number[] | null
  pledge_min_km?: number | null
  pledge_max_km?: number | null
  pledge_cap_pct?: number | null
  teams_assigned_at?: string | null
  /** Đua đội theo mục tiêu: số người mỗi đội (đội được tạo tự động khi chia) */
  pledge_team_size?: number | null
  /** Bài không có nhịp tim không được tính */
  require_hr?: boolean
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
  pledge_km?: number | null
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

export interface ChallengeQuote {
  fee: number                       // phí theo biểu phí (trước khi dùng vé)
  payer: 'USER' | 'CLUB'            // thử thách CLB trả bằng quỹ CLB
  payerBalance: number              // số dư của bên trả phí
  walletBalance: number             // ví cá nhân người tạo
  pass: { id: string; remaining: number; max_slots: number; expires_at: string | null; note?: string | null } | null
  tier: { max: number; xu: number } | null   // mức quy mô áp dụng; null = vượt mức lớn nhất
  custom: boolean                   // > mức lớn nhất: admin cấp riêng
  policy: EconomyPolicy
}

/** Báo giá tạo thử thách: phí, ai trả, vé miễn phí đang có (quote_challenge, migration 000700) */
export async function quoteChallenge(d: ChallengeDraft): Promise<ChallengeQuote> {
  const { data, error } = await supabase.rpc('quote_challenge', {
    p_max_slots: effectiveSlots(d), p_format: d.format, p_club_id: d.audience === 'CLUB_ONLY' ? d.clubId : null,
  })
  if (error) throw error
  const q = data as {
    fee: number; payer: 'USER' | 'CLUB'; payer_balance: number; wallet_balance: number; pass: ChallengeQuote['pass']
    tier: ChallengeQuote['tier']; custom: boolean; xu_vnd: number; policy: unknown
  }
  const policy = toPolicy(q.policy)
  return {
    fee: Number(q.fee ?? 0), payer: q.payer, payerBalance: Number(q.payer_balance ?? 0), walletBalance: Number(q.wallet_balance ?? 0),
    pass: q.pass, tier: q.tier ? { max: Number(q.tier.max), xu: Number(q.tier.xu) } : null, custom: Boolean(q.custom),
    policy: q.xu_vnd ? { ...policy, xuVnd: Number(q.xu_vnd) } : policy,
  }
}

/** Thử thách mình đã tạo, dùng làm mẫu (VIP2 — migration 004000) */
export interface ChallengeTemplate {
  id: string; title: string; description: string | null; format: string; objective: string | null; game_mode: string | null
  target_value: number; min_km: number | null; min_pace: number | null; max_pace: number | null; daily_cap_km: number | null
  require_hr: boolean; max_slots: number; audience: string; club_id: string | null; team_size: number | null
  reward_xu: number; reward_split: string | null; days: number; start_date: string; status: string
  pledge: { enabled: boolean; options: number[]; min_km: number | null; max_km: number | null; cap_pct: number | null; team_size: number | null }
  team_names: string[]
}
export async function getChallengeTemplates(): Promise<ChallengeTemplate[]> {
  const { data, error } = await supabase.rpc('my_challenge_templates')
  if (error) throw error
  return (data ?? []) as ChallengeTemplate[]
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

/* ---------------------- Mục tiêu tự đăng ký (migration 002000) ---------------------- */

export interface PledgeMember {
  participant_id: string
  user_id: string
  display_name: string | null
  avatar_url: string | null
  team_id: string | null
  pledge_km: number | null
  km: number
  counted_km: number
  pct: number | null
  completed: boolean
}
export interface PledgeTeam { team_id: string; name: string; color: string; members: number; pledge_total: number; counted_total: number }
export interface PledgeBoard { can_manage: boolean; missing: number; members: PledgeMember[]; teams: PledgeTeam[] | null }

const toBoard = (b: PledgeBoard): PledgeBoard => ({
  ...b,
  members: b.members.map((m) => ({ ...m, pledge_km: m.pledge_km == null ? null : Number(m.pledge_km), km: Number(m.km),
    counted_km: Number(m.counted_km), pct: m.pct == null ? null : Number(m.pct) })),
  teams: b.teams?.map((t) => ({ ...t, pledge_total: Number(t.pledge_total), counted_total: Number(t.counted_total) })) ?? null,
})

async function rpcBoard(fn: string, args: Record<string, unknown>) {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw error
  return toBoard(data as PledgeBoard)
}

export const getPledgeBoard = (id: string) => rpcBoard('challenge_pledge_board', { p_challenge_id: id })
export const assignPledgeTeams = (id: string, method: 'BALANCE' | 'RANDOM', includeMissing = false) =>
  rpcBoard('assign_pledge_teams', { p_challenge_id: id, p_method: method, p_include_missing: includeMissing })
export const movePledgeMember = (id: string, participantId: string, teamId: string) =>
  rpcBoard('move_pledge_member', { p_challenge_id: id, p_participant_id: participantId, p_team_id: teamId })

export async function setMyPledge(id: string, km: number) {
  const { error } = await supabase.rpc('set_my_pledge', { p_challenge_id: id, p_km: km })
  if (error) throw error
}

export async function setChallengeOptions(id: string, p: { require_hr: boolean }) {
  const { error } = await supabase.rpc('set_challenge_options', { p_challenge_id: id, p })
  if (error) throw error
}

export async function setChallengePledge(id: string, p: ReturnType<typeof pledgePayload>) {
  const { error } = await supabase.rpc('set_challenge_pledge', { p_challenge_id: id, p })
  if (error) throw error
}

const MESSAGES: Record<string, string> = {
  VIP_REQUIRED: 'Nhân bản thử thách cũ dành cho VIP2 trở lên.',
  REWARD_TOO_LARGE: 'Mỗi thử thách chỉ treo thưởng tối đa 50% số dư quỹ CLB.',
  REWARD_NOT_ALLOWED: 'Chỉ thử thách CLB mới treo thưởng được (trích quỹ CLB). Thử thách cá nhân không treo thưởng Xu.',
  PLEDGES_MISSING: 'Còn thành viên chưa đăng ký mục tiêu. Nhắc họ, hoặc chia đội luôn (người chưa đăng ký tính 0 km).',
  PLEDGE_LOCKED: 'Mục tiêu đã khóa (đã xuất phát hoặc đã chia đội).',
  PLEDGE_RULES_LOCKED: 'Đã có người đăng ký mục tiêu và thử thách đã bắt đầu — không đổi luật được nữa.',
  INVALID_PLEDGE: 'Mục tiêu không nằm trong các mốc cho phép.',
  INVALID_PLEDGE_OPTIONS: 'Các mốc mục tiêu không hợp lệ.',
  INVALID_PLEDGE_CAP: '% vượt mục tiêu không hợp lệ.',
  INVALID_TEAM_SIZE: 'Mỗi đội từ 2 đến 50 người.',
  PLEDGE_NOT_SUPPORTED: 'Thử thách này không dùng mục tiêu tự đăng ký.',
  NOT_ENOUGH_MEMBERS: 'Chưa đủ người để chia đội.',
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
  INSUFFICIENT_TREASURY: 'Quỹ CLB không đủ cho phí tạo và tiền treo thưởng.',
  INVALID_AMOUNT: 'Số Xu thưởng không hợp lệ.',
  FORBIDDEN: 'Bạn không có quyền làm việc này.',
  RATE_LIMITED: 'Bạn thao tác hơi nhanh, thử lại sau ít phút.',
  HONOR_PRO_REQUIRED: 'Vinh danh là tính năng của CLB Pro hoặc gói VIP (người tạo thử thách).',
  HONOR_REVIEW_PENDING: 'Chỉ công bố được sau khi thử thách kết thúc 24 giờ (thời gian duyệt bài / khiếu nại).',
  HONOR_NOT_CONFIGURED: 'Hãy bật vinh danh và chọn ít nhất một hạng mục.',
  HONOR_NOT_AVAILABLE: 'Thử thách đã hủy, không vinh danh được.',
  INVALID_HONOR_CATEGORIES: 'Hạng mục vinh danh không hợp lệ (tối đa 8, mỗi hạng mục 1–10 người).',
  INVALID_HONOR_DESIGN: 'Thiết kế ảnh vinh danh không hợp lệ.',
  INVALID_BIB_DESIGN: 'Thiết kế không hợp lệ.',
  INVALID_HONOR_IMAGE: 'Ảnh phải được tải lên từ trang vinh danh của thử thách này.',
  NOT_A_PARTICIPANT: 'Người này không tham gia thử thách.',
}

// ---------------------------------------------------------------------
// Vinh danh (migration 004900)
// ---------------------------------------------------------------------
export interface Honoree {
  category: string
  rank: number
  user_id: string
  value: number | null
  hidden: boolean
  is_me: boolean
  display_name: string
  avatar_url: string | null
  photo_url: string | null
  /** Ảnh riêng đã chọn (chỉ chính runner / BTC thấy, kể cả khi đang ẩn) */
  own_photo: string | null
}
export interface HonorState {
  enabled: boolean
  status: 'DRAFT' | 'PUBLISHED'
  published_at: string | null
  categories: HonorCategory[]
  design: StoredHonorDesign | null
  card_design: StoredHonorDesign | null
  can_manage: boolean
  allowed: boolean
  ended: boolean
  review_until: string
  honorees: Honoree[]
  preview: boolean
}
async function honorRpc(fn: string, args: Record<string, unknown>): Promise<HonorState> {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw error
  const h = data as HonorState
  return { ...h, honorees: (h.honorees ?? []).map((x) => ({ ...x, value: x.value == null ? null : Number(x.value) })) }
}
export const getHonor = (id: string) => honorRpc('challenge_honor', { p_challenge_id: id })
export const saveHonor = (id: string, p: { enabled: boolean; categories: HonorCategory[]; design: unknown; card_design: unknown }) =>
  honorRpc('save_challenge_honor', { p_challenge_id: id, p })
export const publishHonor = (id: string) => honorRpc('publish_challenge_honor', { p_challenge_id: id })
export const unpublishHonor = (id: string) => honorRpc('unpublish_challenge_honor', { p_challenge_id: id })
export const setHonorPref = (id: string, userId: string, p: { photo_url?: string | null; hidden?: boolean }) =>
  honorRpc('set_honor_pref', { p_challenge_id: id, p_user_id: userId, p })

/** Ảnh vinh danh: kho honor-media/<challenge_id>/<user_id>/… (BTC hoặc người tham gia) */
export async function uploadHonorImage(challengeId: string, file: File): Promise<string> {
  const blob = await prepareImage(file)
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('AUTH_REQUIRED')
  const ext = blob.type === 'image/png' ? 'png' : blob.type === 'image/webp' ? 'webp' : 'jpg'
  const path = `${challengeId}/${user.id}/${Date.now()}.${ext}`
  const { error } = await supabase.storage.from('honor-media').upload(path, blob, { contentType: blob.type, upsert: false })
  if (error) throw error
  return supabase.storage.from('honor-media').getPublicUrl(path).data.publicUrl
}

export function challengeErrorMessage(e: unknown): string {
  const err = e as { message?: string; code?: string } | null
  console.warn('[Thử thách] Lỗi gốc:', err?.code, err?.message)
  const raw = err?.message ?? ''
  const key = Object.keys(MESSAGES).find((k) => raw.includes(k))
  return key ? MESSAGES[key] : systemErrorMessage(e, 'Không thực hiện được. Hãy thử lại.')
}
