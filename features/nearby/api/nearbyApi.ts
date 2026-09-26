// Runner Nearby (migration 006100, docs/RUNNER_NEARBY.md): mọi thao tác qua RPC; máy chủ chỉ lưu ô lưới ~1 km, không toạ độ gốc.
import { supabase } from '@/shared/lib/supabase'
import { must, systemErrorMessage } from '@/shared/lib/errors'

export type Visibility = 'VERIFIED' | 'SAME_GENDER' | 'CLUBS'
export type Purpose = 'BUDDY' | 'CLUB' | 'COACH'
export type Goal = '5K' | '10K' | 'HM' | 'FM' | 'TRAIL'
export type Slot = 'EARLY' | 'MORNING' | 'NOON' | 'EVENING' | 'WEEKEND'
export type Radius = 2 | 5 | 10 | 20
export type ConnectionState = 'NONE' | 'PENDING_OUT' | 'PENDING_IN' | 'CONNECTED'
export type Reason = 'PACE' | 'SLOT' | 'GOAL' | 'CLUB' | 'MUTUAL'

export interface Discovery {
  enabled: boolean
  suspended: boolean
  visible_to: Visibility
  purposes: Purpose[]
  goals: Goal[]
  time_slots: Slot[]
  share_pace: boolean
  radius_km: Radius
  bio: string | null
  consented: boolean
  valid_runs: number
  eligible: boolean
  pace_s: number | null
  presence: { source: 'DEVICE' | 'AREA'; area_label: string | null; updated_at: string; expires_at: string; moves_left: number } | null
  incoming: number
  connections: number
}
export type DiscoveryInput = Partial<Pick<Discovery, 'enabled' | 'visible_to' | 'purposes' | 'goals' | 'time_slots' | 'share_pace' | 'radius_km' | 'bio'>> & { consent?: boolean }

export interface NearbyRunner {
  id: string
  name: string
  avatar_url: string | null
  level: number | null
  km: number
  area_label: string | null
  pace_s: number | null
  goals: Goal[]
  time_slots: Slot[]
  purposes: Purpose[]
  bio: string | null
  clubs: number
  mutual: number
  score: number
  connection: ConnectionState
  reasons: Reason[]
}
export interface NearbyFilters { radius_km?: Radius; pace?: 'ALL' | 'FAST' | 'MID' | 'EASY' | 'UNKNOWN'; purpose?: Purpose | 'ALL'; goal?: Goal | 'ALL'; slot?: Slot | 'ALL' }

export interface NearbyEvent {
  id: string
  club_id: string
  club_name: string
  club_avatar: string | null
  title: string
  description: string | null
  starts_at: string
  duration_min: number
  location_name: string | null
  lat: number | null
  lng: number | null
  distance_km: number | null
  pace_text: string | null
  capacity: number | null
  going_count: number
  my_status: 'GOING' | 'MAYBE' | 'NOT_GOING' | null
  km?: number
  is_member: boolean
  status: 'SCHEDULED' | 'CANCELLED'
}
export interface NearbyClub {
  id: string; name: string; avatar_url: string | null; accent_color: string | null; member_count: number | null
  area_label: string | null; join_policy: string | null; km: number; is_member: boolean; upcoming: number
}
export interface Person {
  id: string; name: string; avatar_url: string | null; level: number | null; pace_s: number | null
  goals: Goal[]; time_slots: Slot[]; bio: string | null
  request_id?: string; message?: string | null; at?: string; since?: string
}
export interface Connections { connections: Person[]; incoming: Person[]; outgoing: Person[]; blocked: { id: string; name: string; at: string }[] }

async function call<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw error
  return data as T
}

export const getDiscovery = () => call<Discovery>('my_discovery').then(must<Discovery>('NOT_DEPLOYED'))
export const setDiscovery = (p: DiscoveryInput) => call<Discovery>('set_discovery', { p })
export const setPresence = (lat: number, lng: number, source: 'DEVICE' | 'AREA', area: string | null, hours: 24 | 168 | 720) =>
  call<Discovery>('set_presence', { p_lat: lat, p_lng: lng, p_source: source, p_area: area, p_hours: hours })
export const clearPresence = () => call<void>('clear_presence')
export const nearbyRunners = (f: NearbyFilters, offset = 0) =>
  call<{ items: NearbyRunner[]; total: number; nearby_total: number } | null>('nearby_runners', { p: { ...f, offset } }).then((x) => x ?? { items: [], total: 0, nearby_total: 0 })
export const nearbyEvents = (radius: number) => call<NearbyEvent[]>('nearby_events', { p_radius_km: radius }).then((x) => x ?? [])
export const nearbyClubs = (radius: number) => call<NearbyClub[]>('nearby_clubs', { p_radius_km: radius }).then((x) => x ?? [])
export const sendConnection = (to: string, message: string | null) => call<{ id: string; status: string }>('send_connection', { p_to: to, p_message: message })
export const respondConnection = (id: string, action: 'ACCEPT' | 'DECLINE') => call<{ status: string }>('respond_connection', { p_id: id, p_action: action })
export const cancelRequest = (id: string) => call<void>('cancel_connection_request', { p_id: id })
export const removeConnection = (user: string) => call<void>('remove_connection', { p_user: user })
export const myConnections = () => call<Connections | null>('my_connections').then((x) => x ?? { connections: [], incoming: [], outgoing: [], blocked: [] })
export const inviteToRun = (user: string, target: { eventId?: string; clubId?: string }, note: string | null) =>
  call<void>('invite_to_run', { p_user: user, p_event_id: target.eventId ?? null, p_club_id: target.clubId ?? null, p_note: note })
export const blockUser = (user: string) => call<void>('block_user', { p_user: user })
export const unblockUser = (user: string) => call<void>('unblock_user', { p_user: user })
export const reportUser = (user: string, reason: string, note: string | null) =>
  call<void>('report_user', { p_user: user, p_reason: reason, p_note: note, p_context: 'NEARBY' })
export const getPublicEvent = (id: string) => call<NearbyEvent & { attendees: unknown[]; can_manage: boolean }>('club_event', { p_event_id: id }).then(must<NearbyEvent & { attendees: unknown[]; can_manage: boolean }>('EVENT_NOT_FOUND'))
export const rsvpPublicEvent = (id: string, status: 'GOING' | 'MAYBE' | 'NOT_GOING') => call<NearbyEvent>('rsvp_public_event', { p_event_id: id, p_status: status })
export const setClubLocation = (clubId: string, lat: number | null, lng: number | null, area: string | null) =>
  call<void>('set_club_location', { p_club_id: clubId, p_lat: lat, p_lng: lng, p_area: area })
export const getClubPlace = (clubId: string) => call<{ area_label: string | null; lat: number | null; lng: number | null }>('club_place', { p_club_id: clubId })
export const setEventVisibility = (eventId: string, visibility: 'CLUB' | 'PUBLIC') =>
  call<void>('set_club_event_visibility', { p_event_id: eventId, p_visibility: visibility })

const MESSAGES: Record<string, string> = {
  CONSENT_REQUIRED: 'Cần đồng ý điều khoản chia sẻ vị trí gần đúng trước khi bật.',
  NOT_ELIGIBLE: 'Cần ít nhất 3 bài chạy hợp lệ để bật Quanh đây (chống tài khoản ảo).',
  NEARBY_SUSPENDED: 'Quanh đây của bạn đang tạm khoá do có báo cáo, chờ quản trị viên xem xét.',
  NEARBY_DISABLED: 'Bạn chưa bật Quanh đây.',
  NO_PRESENCE: 'Hãy chọn vị trí gần đúng của bạn để tìm runner quanh đây.',
  TOO_MANY_MOVES: 'Bạn đã đổi vị trí 3 lần trong 24 giờ. Thử lại sau (bảo vệ quyền riêng tư của mọi người).',
  TOO_MANY_SEARCHES: 'Bạn tìm quá nhiều lần trong 1 giờ. Nghỉ chút rồi thử lại.',
  INVALID_LOCATION: 'Vị trí không hợp lệ.',
  TARGET_UNAVAILABLE: 'Runner này hiện không nhận kết nối.',
  ALREADY_CONNECTED: 'Hai bạn đã kết nối.',
  ALREADY_REQUESTED: 'Bạn đã gửi lời mời, chờ người kia trả lời.',
  REQUEST_COOLDOWN: 'Lời mời trước bị từ chối — 30 ngày sau mới gửi lại được.',
  TOO_MANY_REQUESTS: 'Bạn đã gửi đủ số lời mời hôm nay. Mai gửi tiếp nhé.',
  NO_LINKS: 'Lời nhắn không được chứa link, số Zalo / Telegram. Kết nối xong hãy rủ nhau vào buổi chạy.',
  NOT_CONNECTED: 'Chỉ rủ được người đã kết nối.',
  REQUEST_CLOSED: 'Lời mời đã được xử lý.',
  EVENT_FULL: 'Buổi chạy đã đủ người.',
  EVENT_ENDED: 'Buổi chạy đã kết thúc.',
  EVENT_CANCELLED: 'Buổi chạy đã bị huỷ.',
  EVENT_NOT_FOUND: 'Không tìm thấy buổi chạy (có thể đã chuyển về chỉ thành viên CLB).',
  EVENT_NEEDS_LOCATION: 'Buổi chạy công khai cần toạ độ điểm hẹn (nơi công cộng).',
  EVENT_NOT_PUBLIC: 'Người này không thuộc CLB đó — chỉ rủ được vào buổi chạy công khai.',
  FORBIDDEN: 'Bạn không có quyền làm việc này.',
}

export function nearbyErrorMessage(e: unknown): string {
  const msg = (e as { message?: string } | null)?.message ?? ''
  const key = Object.keys(MESSAGES).find((k) => msg.includes(k))
  return key ? MESSAGES[key] : systemErrorMessage(e, 'Không thực hiện được. Hãy thử lại.')
}
