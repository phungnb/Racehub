// Thách đấu CLB — nhiều CLB cùng tranh tài (migration 003600)
import { supabase } from '@/shared/lib/supabase'
import { systemErrorMessage, must } from '@/shared/lib/errors'

export type CupMetric = 'TOTAL_KM' | 'AVG_KM'
export type CupStatus = 'PENDING_REVIEW' | 'INVITED' | 'OPEN' | 'PROVISIONAL' | 'FINISHED' | 'REJECTED' | 'DECLINED' | 'EXPIRED' | 'CANCELLED'
/** Hình thức tính (012700): tổng · trung bình mỗi VĐV đăng ký · cộng top X VĐV */
export type MatchFormat = 'TOTAL' | 'AVG' | 'TOP'
/** Đo bằng: km · thời gian chạy · pace đội (thấp thắng) */
export type MatchMeasure = 'KM' | 'TIME' | 'PACE'
export type MatchTiebreak = 'PARTICIPANTS' | 'DAYS' | 'NONE'
export type MatchPhase = 'PENDING_REVIEW' | 'INVITED' | 'REJECTED' | 'DECLINED' | 'EXPIRED' | 'CANCELLED' | 'REGISTRATION' | 'LOCKED' | 'LIVE' | 'SETTLING' | 'PROVISIONAL' | 'FINISHED'
export type CupScope = 'ACTIVE' | 'MINE' | 'DONE' | 'REVIEW'

export interface CupClub { id: string; name: string; avatar_url: string | null; accent_color: string | null }
export interface CupContributor { user_id: string; display_name: string | null; avatar_url: string | null; km: number; time_s: number; pace_s: number | null; value: number }
export interface CupStanding extends CupClub {
  rank: number; club_id: string; members: number; runners: number; km: number; avg_km: number; score: number | null
  time_s?: number; days?: number; forfeited?: boolean; top?: CupContributor[]
}
/** Điều khoản trận (gửi khi tạo / đề xuất lại) */
export interface MatchTerms {
  format: MatchFormat
  measure: MatchMeasure
  top_n: number | null
  min_roster: number
  max_roster: number | null
  daily_cap_km: number | null
  share_cap_pct: number | null
  pace_min_km: number
  tiebreak: MatchTiebreak
  lock_hours: number
  forfeit_rule: 'FORFEIT' | 'CANCEL'
  start_at: string
  end_at: string
}
export interface NegotiationStep { v: number; club_id: string; by: string; at: string; action: 'PROPOSE' | 'COUNTER' | 'ACCEPT' | 'DECLINE'; note: string | null; terms?: MatchTerms }
export interface Cup {
  id: string
  title: string
  description: string | null
  prize: string | null
  metric: CupMetric
  start_at: string
  end_at: string
  reg_close_at: string
  max_clubs: number
  status: CupStatus
  review_note: string | null
  created_at: string
  settled_at: string | null
  host: CupClub | null
  creator: { id: string; display_name: string | null; avatar_url: string | null } | null
  clubs: number
  my_clubs: (CupClub & { staff: boolean; joined: boolean; signed_up?: boolean; eligible?: boolean; forfeited?: boolean; roster?: number })[]
  /** Từ 011700: thành viên phải tự đăng ký thi đấu mới được tính */
  require_signup?: boolean
  my_signup?: string | null
  can_manage: boolean
  can_review: boolean
  standings: CupStanding[] | null
  // 012700 — thi đấu CLB v2
  kind: 'CUP' | 'DUEL'
  rules_version: number | null
  opponent: CupClub | null
  format: MatchFormat
  measure: MatchMeasure
  top_n: number | null
  min_roster: number
  max_roster: number | null
  daily_cap_km: number | null
  share_cap_pct: number | null
  pace_min_km: number
  tiebreak: MatchTiebreak
  lock_hours: number
  roster_close_at: string
  forfeit_rule: 'FORFEIT' | 'CANCEL'
  final_after: string
  final_delay_hours: number
  phase: MatchPhase
  terms_version: number
  awaiting_club_id: string | null
  decline_reason: string | null
  cancel_reason: string | null
  negotiation: NegotiationStep[] | null
  can_respond: boolean
  can_cancel: boolean
  winner_id: string | null
  mvp: (CupContributor & { club_id: string }) | null
  pending_runs: number | null
  my_strava_hidden: boolean
}

export interface NewCup extends Omit<MatchTerms, 'forfeit_rule'> {
  title: string
  description: string
  prize: string
  reg_close_at: string
  max_clubs: number
  host_club_id: string | null
}

async function call<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw error
  return data as T
}

export const listCups = (scope: CupScope) => call<Cup[]>('list_club_cups', { p_scope: scope }).then((x) => x ?? [])
export const getCup = (id: string) => call<Cup>('club_cup', { p_cup_id: id }).then(must<Cup>('CUP_NOT_FOUND'))
export const createCup = (p: NewCup) => call<Cup>('create_club_cup', { p })
export const reviewCup = (id: string, approve: boolean, note?: string) => call<Cup>('review_club_cup', { p_cup_id: id, p_approve: approve, p_note: note ?? null })
export const cancelCup = (id: string) => call<Cup>('cancel_club_cup', { p_cup_id: id })
export const joinCup = (id: string, clubId: string) => call<Cup>('join_club_cup', { p_cup_id: id, p_club_id: clubId })
export const leaveCup = (id: string, clubId: string) => call<Cup>('leave_club_cup', { p_cup_id: id, p_club_id: clubId })

export const joinCupAsMember = (id: string, clubId: string) => call<Cup>('join_cup_as_member', { p_cup_id: id, p_club_id: clubId })
export const leaveCupAsMember = (id: string) => call<Cup>('leave_cup_as_member', { p_cup_id: id })
export interface ClubBoardRow {
  rank: number; user_id: string; display_name: string | null; avatar_url: string | null; km: number; raw_km?: number; runs: number; days: number
  moving_s: number; pace_s: number | null; qualified?: boolean; value?: number; counted?: boolean
}
export const getClubBoard = (id: string, clubId: string) =>
  call<{ club: CupClub; rows: ClubBoardRow[]; measure?: MatchMeasure; format?: MatchFormat; top_n?: number | null; pace_min_km?: number; daily_cap_km?: number | null }>(
    'club_cup_club_board', { p_cup_id: id, p_club_id: clubId })

// Trận 1–1 (012700)
export const createDuel = (clubId: string, opponentId: string, terms: MatchTerms, message?: string) =>
  call<Cup>('create_club_duel', { p: { ...terms, club_id: clubId, opponent_id: opponentId, message: message ?? null } })
export const respondDuel = (id: string, action: 'ACCEPT' | 'DECLINE' | 'COUNTER', p: Partial<MatchTerms> & { note?: string } = {}) =>
  call<Cup>('respond_club_duel', { p_cup_id: id, p_action: action, p })

export interface ClubRating { rating: number; played: number; wins: number; draws: number; losses: number; streak: number; best_streak: number }
export interface ClubMatchSummary {
  can_challenge: boolean
  rating: ClubRating | null
  rank: number
  champion: { cup_id: string; title: string; kind: 'CUP' | 'DUEL'; final_at: string; until: string } | null
  active: Cup[]
  recent: Cup[]
}
export const getClubMatchSummary = (clubId: string) => call<ClubMatchSummary>('club_match_summary', { p_club_id: clubId })
export const myClubMatches = () => call<Cup[]>('my_club_matches', {}).then((x) => x ?? [])
export interface LadderRow extends CupClub { rank: number; club_id: string; rating: number; played: number; wins: number; draws: number; losses: number; streak: number; is_mine: boolean }
export const getDuelLadder = () => call<LadderRow[]>('club_duel_ladder', {}).then((x) => x ?? [])

const MESSAGES: Record<string, string> = {
  JOINED_CLUB_TOO_LATE: 'Bạn vào CLB sau khi trận được tạo nên không đăng ký được (luật chống "chiêu mộ" giữa trận).',
  ROSTER_LOCKED: 'Đã chốt danh sách thi đấu — không đăng ký / rút được nữa.',
  ROSTER_FULL: 'CLB đã đủ số VĐV tối đa.',
  BATTLE_EXISTS: 'Hai CLB đang có một trận chưa kết thúc.',
  BATTLE_NOT_PENDING: 'Lời thách đấu này đã được trả lời hoặc hết hạn.',
  INVALID_OPPONENT: 'Chọn một CLB khác làm đối thủ.',
  TOO_MANY_COUNTERS: 'Đã đề xuất lại quá nhiều lần — hãy Nhận lời hoặc Từ chối.',
  INVALID_FORMAT: 'Hình thức tính không hợp lệ.',
  INVALID_MEASURE: 'Cách đo không hợp lệ.',
  INVALID_TOP_N: 'Chọn số VĐV top từ 1 đến 50.',
  INVALID_ROSTER: 'Số VĐV tối thiểu 1–100, tối đa không nhỏ hơn tối thiểu.',
  INVALID_DAILY_CAP: 'Trần mỗi ngày từ 5 đến 100 km.',
  INVALID_SHARE_CAP: 'Trần đóng góp từ 20% đến 60%.',
  INVALID_PACE_MIN: 'Số km tối thiểu để xét pace từ 1 đến 42 km.',
  LOCK_TOO_SOON: 'Giờ chốt danh sách phải sau hiện tại ít nhất 30 phút — dời giờ bắt đầu muộn hơn.',
  NOT_A_CUP: 'Trận 1–1 đã có sẵn hai CLB.',
  FEATURE_MOVED: 'Tính năng đã được nâng cấp — tải lại trang.',
  INVALID_ACTION: 'Thao tác không hợp lệ.',
  ALREADY_SIGNED_UP: 'Bạn đã đăng ký thi đấu cho một CLB khác trong giải này.',
  CLUB_NOT_IN_CUP: 'CLB chưa được ban quản trị đăng ký vào thách đấu.',
  NOT_A_MEMBER: 'Bạn chưa là thành viên CLB này.',
  FORBIDDEN: 'Bạn không có quyền làm việc này.',
  CUP_NOT_FOUND: 'Không tìm thấy thách đấu (hoặc đang chờ duyệt).',
  CLUB_STAFF_REQUIRED: 'Chỉ Chủ nhiệm / Quản trị viên của CLB mới đăng ký CLB vào thách đấu.',
  CUP_NOT_OPEN: 'Thách đấu chưa mở hoặc đã đóng.',
  CUP_NOT_PENDING: 'Thách đấu này đã được xử lý.',
  REGISTRATION_CLOSED: 'Đã hết hạn đăng ký.',
  ALREADY_JOINED: 'CLB đã có trong thách đấu.',
  CUP_FULL: 'Thách đấu đã đủ số CLB.',
  CUP_STARTED: 'Thách đấu đã bắt đầu.',
  INVALID_TITLE: 'Tên thách đấu cần từ 3 đến 120 ký tự.',
  INVALID_METRIC: 'Cách tính điểm không hợp lệ.',
  INVALID_TIME_RANGE: 'Thời gian kết thúc phải sau thời gian bắt đầu.',
  START_IN_PAST: 'Thời gian bắt đầu phải ở tương lai.',
  INVALID_DURATION: 'Thời gian thi đấu từ 1 ngày đến 2 tháng (1–1) / 3 tháng (nhiều CLB).',
  INVALID_REG_CLOSE: 'Hạn đăng ký phải sau hiện tại và trước khi kết thúc.',
  INVALID_MAX: 'Số CLB tối đa từ 2 đến 200.',
  REASON_REQUIRED: 'Nhập lý do từ chối (ít nhất 3 ký tự).',
  RATE_LIMITED: 'Bạn tạo quá nhiều thách đấu trong hôm nay.',
}

export function cupErrorMessage(e: unknown): string {
  const msg = (e as { message?: string } | null)?.message ?? ''
  const code = Object.keys(MESSAGES).sort((a, b) => b.length - a.length).find((k) => msg.includes(k))
  return code ? MESSAGES[code] : systemErrorMessage(e, 'Có lỗi xảy ra, thử lại sau.')
}
