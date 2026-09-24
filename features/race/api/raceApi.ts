// Giải chạy ảo (migration 002700)
import { supabase } from '@/shared/lib/supabase'

export type RaceScope = 'UPCOMING' | 'MINE' | 'PAST'

export interface MyRegistration {
  id: string
  bib: string
  display_name: string | null
  distance_km: number
  status: 'REGISTERED' | 'FINISHED' | 'WITHDRAWN'
  finish_time_s: number | null
  finish_distance_m: number | null
  finish_moving_s: number | null
  finished_at: string | null
  finish_activity_id: string | null
  registered_at: string
  rank: number | null
}

export interface Race {
  id: string
  title: string
  description: string | null
  start_at: string
  end_at: string
  reg_close_at: string
  distances: number[]
  audience: 'PUBLIC' | 'CLUB_ONLY'
  status: 'PUBLISHED' | 'CANCELLED'
  cancelled_reason: string | null
  max_participants: number | null
  bib_prefix: string
  club: { id: string; name: string; avatar_url: string | null; accent_color: string | null } | null
  organizer: { id: string; display_name: string | null; avatar_url: string | null } | null
  registered: number
  finished: number
  me: MyRegistration | null
  can_manage: boolean
  per_distance?: { distance_km: number; registered: number; finished: number }[]
}

export interface RaceResult {
  rank: number
  user_id: string
  display_name: string | null
  avatar_url: string | null
  bib: string
  finish_time_s: number
  pace_s: number
  finished_at: string
  is_me: boolean
}

export interface DashboardRow {
  bib: string
  display_name: string | null
  user_id: string
  distance_km: number
  status: MyRegistration['status']
  registered_at: string
  finish_time_s: number | null
  finish_distance_m: number | null
  finished_at: string | null
  activity_id: string | null
}

export interface NewRace {
  title: string
  description: string
  start_at: string
  end_at: string
  reg_close_at: string
  distances: number[]
  audience: 'PUBLIC' | 'CLUB_ONLY'
  club_id: string | null
  max_participants: number | null
  bib_prefix: string
}

async function call<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw error
  return data as T
}

export const listRaces = (scope: RaceScope) => call<Race[]>('list_races', { p_scope: scope })
export const getRace = (id: string) => call<Race>('race_detail', { p_race_id: id })
export const getRaceResults = (id: string, km: number) => call<RaceResult[]>('race_results', { p_race_id: id, p_distance_km: km })
export const getRaceDashboard = (id: string) => call<DashboardRow[]>('race_dashboard', { p_race_id: id })
export const createRace = (p: NewRace) => call<string>('create_virtual_race', { p })
export const registerRace = (id: string, km: number) => call<Race>('register_race', { p_race_id: id, p_distance_km: km })
export const withdrawRace = (id: string) => call<Race>('withdraw_race', { p_race_id: id })
export const cancelRace = (id: string, reason: string) => call<void>('cancel_virtual_race', { p_race_id: id, p_reason: reason })

const MESSAGES: Record<string, string> = {
  FORBIDDEN: 'Bạn không có quyền làm việc này.',
  RACE_NOT_FOUND: 'Không tìm thấy giải (hoặc giải chỉ dành cho thành viên CLB).',
  RACE_CANCELLED: 'Giải đã bị hủy.',
  REGISTRATION_CLOSED: 'Đã hết hạn đăng ký.',
  RACE_FULL: 'Giải đã đủ số VĐV.',
  INVALID_DISTANCE: 'Cự ly không có trong giải.',
  RACE_STARTED: 'Giải đã bắt đầu, không rút tên được nữa.',
  NOT_REGISTERED: 'Bạn chưa đăng ký giải này.',
  INVALID_TITLE: 'Tên giải cần từ 3 đến 120 ký tự.',
  INVALID_TIME_RANGE: 'Thời gian kết thúc phải sau thời gian bắt đầu.',
  INVALID_DURATION: 'Giải kéo dài tối đa 3 tháng và chưa kết thúc.',
  INVALID_REG_CLOSE: 'Hạn đăng ký phải trước khi giải kết thúc.',
  INVALID_AUDIENCE: 'Giải nội bộ cần chọn CLB.',
  INVALID_MAX: 'Số VĐV tối đa từ 2 đến 100.000.',
  INVALID_BIB_PREFIX: 'Tiền tố BIB chỉ gồm chữ và số, tối đa 6 ký tự.',
  INVALID_DISTANCES: 'Chọn 1–6 cự ly, mỗi cự ly từ 1 đến 250 km.',
}

export function raceErrorMessage(e: unknown): string {
  const msg = (e as { message?: string } | null)?.message ?? ''
  const code = Object.keys(MESSAGES).find((k) => msg.includes(k))
  return code ? MESSAGES[code] : 'Có lỗi xảy ra, thử lại sau.'
}
