// Sự kiện, điểm danh, bình chọn, thu chi CLB — mọi thao tác qua RPC (migration 001500).
import { supabase } from '@/shared/lib/supabase'
import type { CashEntry } from '../model/finance'
import { systemErrorMessage } from '@/shared/lib/errors'
import { listInbox } from './hubApi'

export type RsvpStatus = 'GOING' | 'MAYBE' | 'NOT_GOING'

export interface EventRoute { km: number | null; pace: string | null }

/** Cự ly của sự kiện: ưu tiên danh sách mới, không có thì dựng từ cột cũ */
export const eventRoutes = (e: Pick<ClubEvent, 'routes' | 'distance_km' | 'pace_text'>): EventRoute[] =>
  e.routes?.length ? e.routes : e.distance_km || e.pace_text ? [{ km: e.distance_km, pace: e.pace_text }] : []

export interface ClubEvent {
  id: string
  club_id: string
  title: string
  description: string | null
  starts_at: string
  ends_at: string
  duration_min: number
  location_name: string | null
  lat: number | null
  lng: number | null
  distance_km: number | null
  pace_text: string | null
  /** Các cự ly của buổi chạy (migration 010600); bản cũ chỉ có distance_km / pace_text */
  routes?: EventRoute[]
  capacity: number | null
  status: 'SCHEDULED' | 'CANCELLED'
  cancel_reason: string | null
  creator_name: string | null
  going_count: number
  maybe_count: number
  checked_in_count: number
  my_status: RsvpStatus | null
  my_checked_in_at: string | null
  /** CLB = chỉ thành viên; PUBLIC = hiện ở Quanh đây (migration 006100) */
  visibility?: 'CLUB' | 'PUBLIC'
}

export interface EventAttendee {
  user_id: string
  display_name: string | null
  avatar_url: string | null
  status: RsvpStatus
  checked_in_at: string | null
  checkin_method: 'QR' | 'AUTO' | 'STAFF' | 'GPS' | null
}

export interface ClubEventDetail extends ClubEvent {
  can_manage: boolean
  /** Khung điểm danh: từ 30 phút trước giờ hẹn đến khi kết thúc (migration 014800) */
  checkin_open: boolean
  /** Ban quản trị chỉ tích tay được khi sự kiện đã bắt đầu; bản cũ chưa có trường này */
  staff_can_mark?: boolean
  attendees: EventAttendee[]
}

export interface EventInput {
  title: string
  description?: string | null
  starts_at: string
  duration_min: number
  location_name?: string | null
  lat?: number | null
  lng?: number | null
  distance_km?: number | null
  pace_text?: string | null
  routes?: EventRoute[]
  capacity?: number | null
}

const rpc = async <T>(fn: string, args: Record<string, unknown>) => {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw error
  return data as T
}

export const listEvents = (clubId: string, scope: 'UPCOMING' | 'PAST') => rpc<ClubEvent[]>('club_events', { p_club_id: clubId, p_scope: scope })
export type UpcomingEvent = ClubEvent & { club_name: string | null; club_accent: string | null }

/** Lịch sắp tới của mọi CLB tôi tham gia, gần nhất trước (migration 015300); chưa chạy migration thì gom từng CLB */
export async function myUpcomingEvents(limit = 5): Promise<UpcomingEvent[]> {
  const r = await supabase.rpc('my_upcoming_events', { p_limit: limit })
  if (!r.error) return (r.data ?? []) as UpcomingEvent[]
  if (!/my_upcoming_events|PGRST202|42883/.test(`${r.error.code} ${r.error.message}`)) throw r.error
  const clubs = (await listInbox()).filter((c) => c.member_status === 'APPROVED').slice(0, 8)
  const lists = await Promise.all(clubs.map((c) =>
    listEvents(c.club_id, 'UPCOMING').then((es) => es.map((e) => ({ ...e, club_name: c.name, club_accent: c.accent_color }))).catch(() => [])))
  return lists.flat().filter((e) => e.status === 'SCHEDULED').sort((a, b) => a.starts_at.localeCompare(b.starts_at)).slice(0, limit)
}
export const getEvent = (eventId: string) => rpc<ClubEventDetail>('club_event', { p_event_id: eventId })
export const createEvent = (clubId: string, input: EventInput) => rpc<ClubEvent>('create_club_event', { p_club_id: clubId, p: input })
export const updateEvent = (eventId: string, input: EventInput) => rpc<ClubEvent>('update_club_event', { p_event_id: eventId, p: input })
export const cancelEvent = (eventId: string, reason: string) => rpc<void>('cancel_club_event', { p_event_id: eventId, p_reason: reason })
export const rsvpEvent = (eventId: string, status: RsvpStatus) => rpc<ClubEvent>('rsvp_club_event', { p_event_id: eventId, p_status: status })
export const checkinToken = (eventId: string) => rpc<{ token: string; expires_at: string }>('event_checkin_token', { p_event_id: eventId })
export const checkinEvent = (token: string) =>
  rpc<{ new: boolean; event_id: string; club_id: string; title: string }>('checkin_club_event', { p_token: token })
export const gpsCheckin = (eventId: string, lat: number, lng: number, accuracyM: number | null) =>
  rpc<{ new: boolean; distance_m: number }>('gps_checkin_club_event', { p_event_id: eventId, p_lat: lat, p_lng: lng, p_accuracy_m: accuracyM })
export const staffCheckin = (eventId: string, userId: string, checked: boolean) =>
  rpc<void>('staff_checkin', { p_event_id: eventId, p_user_id: userId, p_checked: checked })

/* ------------------------------- Bình chọn ------------------------------- */

export interface ClubPoll {
  id: string
  question: string
  options: string[]
  multi: boolean
  hide_results: boolean
  closes_at: string | null
  closed: boolean
  created_at: string
  creator_name: string | null
  can_close: boolean
  voters: number
  my_choices: number[] | null
  counts: number[] | null
}

export const listPolls = (clubId: string) => rpc<ClubPoll[]>('club_polls', { p_club_id: clubId })
export const createPoll = (clubId: string, p: { question: string; options: string[]; multi: boolean; closesAt: string | null; hideResults: boolean }) =>
  rpc<string>('create_club_poll', {
    p_club_id: clubId, p_question: p.question, p_options: p.options, p_multi: p.multi, p_closes_at: p.closesAt, p_hide_results: p.hideResults,
  })
export const votePoll = (pollId: string, choices: number[]) => rpc<void>('vote_club_poll', { p_poll_id: pollId, p_choices: choices })
export const closePoll = (pollId: string) => rpc<void>('close_club_poll', { p_poll_id: pollId })

/* ------------------------------- Thu chi VND ------------------------------ */

export type DueStatus = 'UNPAID' | 'CLAIMED' | 'CONFIRMED' | 'EXEMPT'

export interface ClubDue {
  id: string
  title: string
  amount_vnd: number
  due_date: string | null
  note: string | null
  closed: boolean
  created_at: string
  reminded_at: string | null
  total: number
  confirmed: number
  claimed: number
  my_status: DueStatus | null
}

export interface ClubFinance {
  can_manage: boolean
  bank: { bin: string; account_no: string; account_name: string } | null
  /** Ảnh QR nhận tiền ban quản trị tự tải lên (ưu tiên hơn VietQR tự tạo) */
  bank_qr_url: string | null
  balance: number
  income_30d: number
  expense_30d: number
  dues: ClubDue[]
  entries: CashEntry[]
}

export interface DueDetail {
  id: string
  club_id: string
  title: string
  amount_vnd: number
  due_date: string | null
  note: string | null
  closed: boolean
  reminded_at: string | null
  my_status: DueStatus | null
  members: { user_id: string; display_name: string | null; avatar_url: string | null; status: DueStatus; claimed_at: string | null; confirmed_at: string | null }[]
}

export async function getFinance(clubId: string): Promise<ClubFinance> {
  const f = await rpc<ClubFinance>('club_finance', { p_club_id: clubId })
  return { ...f, balance: Number(f.balance), income_30d: Number(f.income_30d), expense_30d: Number(f.expense_30d),
    entries: f.entries.map((e) => ({ ...e, amount_vnd: Number(e.amount_vnd) })) }
}
export const getDue = (dueId: string) => rpc<DueDetail>('club_due_detail', { p_due_id: dueId })
export const setBank = (clubId: string, bank: { bin: string; account: string; name: string } | null) =>
  rpc<void>('set_club_bank', { p_club_id: clubId, p_bin: bank?.bin ?? null, p_account: bank?.account ?? null, p_name: bank?.name ?? null })
export const setBankQr = (clubId: string, url: string | null) => rpc<void>('set_club_bank_qr', { p_club_id: clubId, p_url: url })
export const createDue = (clubId: string, d: { title: string; amount: number; dueDate: string | null; note: string | null }) =>
  rpc<string>('create_club_due', { p_club_id: clubId, p_title: d.title, p_amount: d.amount, p_due_date: d.dueDate, p_note: d.note })
export const claimDue = (dueId: string) => rpc<void>('claim_due_paid', { p_due_id: dueId })
export const setDuePayment = (dueId: string, userId: string, status: Exclude<DueStatus, 'CLAIMED'>) =>
  rpc<void>('set_due_payment', { p_due_id: dueId, p_user_id: userId, p_status: status })
export const remindDue = (dueId: string) => rpc<number>('remind_due', { p_due_id: dueId })
export const closeDue = (dueId: string, closed: boolean) => rpc<void>('close_club_due', { p_due_id: dueId, p_closed: closed })
export const addCashEntry = (clubId: string, e: { kind: 'INCOME' | 'EXPENSE'; amount: number; title: string; note: string | null; receiptUrl: string | null }) =>
  rpc<string>('add_cash_entry', { p_club_id: clubId, p_kind: e.kind, p_amount: e.amount, p_title: e.title, p_note: e.note, p_receipt_url: e.receiptUrl })
export const voidCashEntry = (entryId: string, reason: string) => rpc<void>('void_cash_entry', { p_entry_id: entryId, p_reason: reason })

/** Ảnh hóa đơn / ảnh QR nhận tiền: bucket club-media, thư mục <club_id>/<user_id>/ (quy tắc sẵn có của ảnh bài đăng) */
export async function uploadReceipt(clubId: string, userId: string, file: File, prefix: 'receipt' | 'bankqr' = 'receipt'): Promise<string> {
  const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg'
  const path = `${clubId}/${userId}/${prefix}-${Date.now()}.${ext}`
  const { error } = await supabase.storage.from('club-media').upload(path, file, { contentType: file.type, upsert: false })
  if (error) throw error
  return supabase.storage.from('club-media').getPublicUrl(path).data.publicUrl
}

const MESSAGES: Record<string, string> = {
  NOT_A_MEMBER: 'Bạn cần là thành viên CLB để làm việc này.',
  FORBIDDEN: 'Chỉ ban quản trị CLB làm được việc này.',
  EVENT_NOT_FOUND: 'Sự kiện không còn tồn tại.',
  EVENT_CANCELLED: 'Sự kiện đã bị hủy.',
  EVENT_ENDED: 'Sự kiện đã kết thúc.',
  EVENT_FULL: 'Sự kiện đã đủ người.',
  INVALID_TITLE: 'Tên cần từ 3 đến 80 ký tự.',
  INVALID_TIME: 'Thời gian không hợp lệ.',
  INVALID_LOCATION: 'Tọa độ điểm hẹn không hợp lệ.',
  INVALID_EVENT: 'Thông tin sự kiện không hợp lệ.',
  REASON_REQUIRED: 'Hãy ghi lý do.',
  INVALID_TOKEN: 'Mã QR không đúng. Hãy quét lại mã trên máy ban tổ chức.',
  TOKEN_EXPIRED: 'Mã QR đã hết hạn. Nhờ ban tổ chức mở mã mới.',
  CHECKIN_CLOSED: 'Điểm danh chỉ mở từ 30 phút trước giờ hẹn đến khi buổi chạy kết thúc.',
  EVENT_NOT_STARTED: 'Sự kiện chưa bắt đầu nên chưa điểm danh được.',
  TOO_FAR: 'Bạn đang cách điểm hẹn quá 300 m. Hãy tới điểm hẹn rồi thử lại.',
  LOW_ACCURACY: 'GPS chưa đủ chính xác. Ra chỗ thoáng, bật vị trí chính xác rồi thử lại.',
  NO_EVENT_LOCATION: 'Sự kiện này chưa có tọa độ điểm hẹn. Hãy quét QR của ban tổ chức.',
  INVALID_BANK: 'Thông tin tài khoản ngân hàng chưa đúng.',
  INVALID_QR: 'Ảnh QR không hợp lệ. Hãy tải lại ảnh.',
  INVALID_AMOUNT: 'Số tiền không hợp lệ.',
  DUE_NOT_FOUND: 'Không tìm thấy kỳ thu phí.',
  DUE_CLOSED: 'Kỳ thu phí đã đóng.',
  REMIND_TOO_SOON: 'Vừa nhắc rồi. Mỗi kỳ chỉ nhắc 1 lần / 12 giờ.',
  INVALID_RECEIPT: 'Ảnh hóa đơn không hợp lệ.',
  ENTRY_VOIDED: 'Khoản này đã hủy.',
  INVALID_QUESTION: 'Câu hỏi cần từ 3 đến 200 ký tự.',
  INVALID_OPTIONS: 'Cần 2–10 lựa chọn, mỗi lựa chọn tối đa 80 ký tự.',
  INVALID_CHOICES: 'Lựa chọn không hợp lệ.',
  POLL_CLOSED: 'Bình chọn đã đóng.',
  RATE_LIMITED: 'Bạn tạo hơi nhiều bình chọn. Thử lại sau ít phút.',
}

export function eventsErrorMessage(e: unknown): string {
  const err = e as { message?: string } | null
  console.warn('[CLB] Lỗi gốc:', err?.message)
  const key = Object.keys(MESSAGES).sort((a, b) => b.length - a.length).find((k) => (err?.message ?? '').includes(k))
  return key ? MESSAGES[key] : systemErrorMessage(e, 'Không thực hiện được. Hãy thử lại.')
}
