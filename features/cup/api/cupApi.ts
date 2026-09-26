// Thách đấu CLB — nhiều CLB cùng tranh tài (migration 003600)
import { supabase } from '@/shared/lib/supabase'
import { systemErrorMessage, must } from '@/shared/lib/errors'

export type CupMetric = 'TOTAL_KM' | 'AVG_KM'
export type CupStatus = 'PENDING_REVIEW' | 'OPEN' | 'REJECTED' | 'CANCELLED' | 'FINISHED'
export type CupScope = 'ACTIVE' | 'MINE' | 'DONE' | 'REVIEW'

export interface CupClub { id: string; name: string; avatar_url: string | null; accent_color: string | null }
export interface CupStanding extends CupClub {
  rank: number; club_id: string; members: number; runners: number; km: number; avg_km: number; score: number
}
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
  my_clubs: (CupClub & { staff: boolean; joined: boolean })[]
  can_manage: boolean
  can_review: boolean
  standings: CupStanding[] | null
}

export interface NewCup {
  title: string
  description: string
  prize: string
  metric: CupMetric
  start_at: string
  end_at: string
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

const MESSAGES: Record<string, string> = {
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
  INVALID_DURATION: 'Thách đấu kéo dài từ 1 ngày đến 3 tháng.',
  INVALID_REG_CLOSE: 'Hạn đăng ký phải sau hiện tại và trước khi kết thúc.',
  INVALID_MAX: 'Số CLB tối đa từ 2 đến 200.',
  REASON_REQUIRED: 'Nhập lý do từ chối (ít nhất 3 ký tự).',
  RATE_LIMITED: 'Bạn tạo quá nhiều thách đấu trong hôm nay.',
}

export function cupErrorMessage(e: unknown): string {
  const msg = (e as { message?: string } | null)?.message ?? ''
  const code = Object.keys(MESSAGES).find((k) => msg.includes(k))
  return code ? MESSAGES[code] : systemErrorMessage(e, 'Có lỗi xảy ra, thử lại sau.')
}
