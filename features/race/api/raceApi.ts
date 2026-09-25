// Giải chạy ảo (migration 002700)
import { prepareImage } from '@/shared/lib/image'
import { supabase } from '@/shared/lib/supabase'
import type { BibDesign, StoredDesign } from '../model/bib'
import { systemErrorMessage } from '@/shared/lib/errors'

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
  /** Thiết kế e-BIB của BTC (migration 002900), null = mẫu mặc định */
  bib_design: StoredDesign | null
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
export interface OrganizerRights { admin: boolean; personal: boolean; clubs: string[] }
export const getOrganizerRights = () => call<OrganizerRights>('can_organize_race')

/** Báo phí theo quy mô (như thử thách): lượt tạo miễn phí dùng trước, rồi trừ Xu ví cá nhân / quỹ CLB */
export interface CapacityQuote {
  slots: number; fee: number; custom: boolean; tier: { max: number; xu: number } | null
  payer: 'USER' | 'CLUB'; payer_balance: number; pass: { id: string; max_slots: number; remaining: number; note: string | null } | null
}
export async function quoteCapacity(slots: number, clubId: string | null): Promise<CapacityQuote> {
  const q = await call<CapacityQuote>('quote_capacity', { p_slots: slots, p_club_id: clubId })
  return { ...q, fee: Number(q.fee ?? 0), payer_balance: Number(q.payer_balance ?? 0), custom: Boolean(q.custom) }
}

export const registerRace = (id: string, km: number) => call<Race>('register_race', { p_race_id: id, p_distance_km: km })
export const withdrawRace = (id: string) => call<Race>('withdraw_race', { p_race_id: id })
export const cancelRace = (id: string, reason: string) => call<void>('cancel_virtual_race', { p_race_id: id, p_reason: reason })

export const setBibDesign = (id: string, p: unknown) => call<BibDesign>('set_race_bib_design', { p_race_id: id, p })

export interface BibCheck { bib: string; display_name: string | null; avatar_url: string | null; distance_km: number; status: MyRegistration['status']; finish_time_s: number | null; finished_at: string | null }
export const lookupBib = (id: string, bib: string) => call<BibCheck | null>('race_bib_lookup', { p_race_id: id, p_bib: bib })

/** Ảnh cho BIB (logo, nền, nhà tài trợ): kho race-media/<race_id>/<user_id>/… — chỉ BTC giải đó tải lên được */
export async function uploadRaceImage(raceId: string, file: File): Promise<string> {
  const blob = await prepareImage(file)                     // nén / đổi định dạng nếu cần (ảnh Canva lớn, HEIC…)
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('AUTH_REQUIRED')
  const ext = blob.type === 'image/png' ? 'png' : blob.type === 'image/webp' ? 'webp' : 'jpg'
  const path = `${raceId}/${user.id}/${Date.now()}.${ext}`
  const { error } = await supabase.storage.from('race-media').upload(path, blob, { contentType: blob.type, upsert: false })
  if (error) throw error
  return supabase.storage.from('race-media').getPublicUrl(path).data.publicUrl
}

const MESSAGES: Record<string, string> = {
  FORBIDDEN: 'Bạn không có quyền làm việc này.',
  RACE_ORGANIZER_REQUIRED: 'Chỉ CLB hoặc cá nhân được RaceHub cấp quyền mới tạo được giải chạy ảo. Liên hệ admin để đăng ký.',
  CAPACITY_REQUIRED: 'Chọn quy mô (số VĐV tối đa) — phí tạo giải tính theo quy mô.',
  INSUFFICIENT_BALANCE: 'Ví của bạn không đủ Xu trả phí tạo giải.',
  INSUFFICIENT_TREASURY: 'Quỹ CLB không đủ Xu trả phí tạo giải.',
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
  INVALID_BIB_DESIGN: 'Thiết kế BIB không hợp lệ.',
  INVALID_BIB_IMAGE: 'Ảnh phải được tải lên từ trình thiết kế BIB của giải này.',
  INVALID_IMAGE_TYPE: 'Chỉ nhận ảnh PNG, JPG hoặc WebP.',
  IMAGE_TOO_LARGE: 'Ảnh quá lớn, không nén được. Thử ảnh nhỏ hơn.',
  AUTH_REQUIRED: 'Phiên đăng nhập đã hết, vui lòng đăng nhập lại.',
}

// Lỗi từ kho ảnh Supabase Storage (tiếng Anh) → lời dễ hiểu, kèm cách xử lý
const STORAGE_MESSAGES: [RegExp, string][] = [
  [/bucket not found/i, 'Chưa có kho ảnh race-media — cần chạy migration 20261001002900 (và 003300) trong SQL Editor.'],
  [/row-level security|unauthorized|403/i, 'Bạn không có quyền tải ảnh cho giải này (chỉ người tạo giải, ban quản trị CLB hoặc admin).'],
  [/maximum allowed size|too large|413/i, 'Ảnh vượt giới hạn của kho ảnh. Chạy migration 003300 để nâng lên 10 MB.'],
  [/mime type|not supported/i, 'Định dạng ảnh không được hỗ trợ. Dùng PNG, JPG hoặc WebP.'],
]

export function raceErrorMessage(e: unknown): string {
  const msg = (e as { message?: string } | null)?.message ?? ''
  const code = Object.keys(MESSAGES).find((k) => msg.includes(k))
  if (code) return MESSAGES[code]
  const storage = STORAGE_MESSAGES.find(([re]) => re.test(msg))
  if (storage) return storage[1]
  return systemErrorMessage(e, 'Có lỗi xảy ra, thử lại sau.')
}
