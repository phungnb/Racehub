// Theo dõi runner + tin nhắn 1-1 (migration 011500). Mọi thao tác qua RPC — máy chủ kiểm tra quyền, chặn, riêng tư.
import { supabase } from '@/shared/lib/supabase'
import { systemErrorMessage } from '@/shared/lib/errors'

export interface FollowStatus {
  following: boolean
  followed_by: boolean
  followers: number
  following_count: number
  blocked: boolean
  blocked_by_me?: boolean
  can_message: boolean
}
export interface Runner { id: string; display_name: string | null; avatar_url: string | null; level?: number }
export interface FollowPerson extends Runner { following: boolean; is_me: boolean }
export interface Suggestion extends Runner { reason: string }
export interface FeedActivity {
  id: string
  title: string | null
  source: string | null
  started_at: string
  distance_m: number
  moving_time_s: number
  avg_pace_s: number | null
  elevation_gain_m: number | null
  is_me: boolean
  user: Runner
}
export interface DirectMessage { id: string; sender_id: string | null; mine: boolean; created_at: string; deleted: boolean; body: string | null; reactions?: DmReaction[] }
export interface DmReaction { emoji: string; count: number; mine: boolean }
export interface DirectThread { user: Runner; can_message: boolean; blocked: boolean; blocked_by_me: boolean; messages: DirectMessage[] }
export interface InboxItem { user: Runner; last_message_at: string; last: DirectMessage | null; unread: number }
export type ReportReason = 'SPAM' | 'HARASSMENT' | 'FAKE' | 'UNSAFE' | 'OTHER'

async function call<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw error
  return data as T
}

export const followRunner = (user: string) => call<FollowStatus>('follow_runner', { p_user: user })
export const unfollowRunner = (user: string) => call<FollowStatus>('unfollow_runner', { p_user: user })
export const followStatus = (user: string) => call<FollowStatus>('follow_status', { p_user: user })
export const followList = (user: string, kind: 'FOLLOWERS' | 'FOLLOWING') => call<FollowPerson[]>('follow_list', { p_user: user, p_kind: kind }).then((x) => x ?? [])
export const followingFeed = (before: string | null, limit = 20) =>
  call<FeedActivity[]>('following_feed', { p_before: before, p_limit: limit }).then((x) => x ?? [])
export const followSuggestions = () => call<Suggestion[]>('follow_suggestions').then((x) => x ?? [])

export const sendDirectMessage = (to: string, body: string) => call<DirectMessage>('send_direct_message', { p_to: to, p_body: body })
export const getDirectThread = (user: string) => call<DirectThread>('direct_thread', { p_user: user })
export const getInbox = () => call<InboxItem[]>('direct_inbox').then((x) => x ?? [])
export const getUnreadMessages = () => call<number>('direct_unread_count').then((x) => x ?? 0)
export const deleteDirectMessage = (id: string) => call<void>('delete_direct_message', { p_id: id })
/** Thả / đổi / bỏ cảm xúc cho một tin nhắn (chạm lại cùng emoji để bỏ) */
export const reactDirectMessage = (id: string, emoji: string) => call<unknown>('react_direct_message', { p_id: id, p_emoji: emoji })
export const DM_REACTIONS = ['❤️', '👍', '😂', '😮', '😢', '🔥', '👏', '🏃'] as const

export const blockRunner = (user: string) => call<void>('block_user', { p_user: user })
export const unblockRunner = (user: string) => call<void>('unblock_user', { p_user: user })
export const reportRunner = (user: string, reason: ReportReason, note: string | null, context: 'DM' | 'PROFILE' | 'COMMENT') =>
  call<void>('report_user', { p_user: user, p_reason: reason, p_note: note, p_context: context })

export const REPORT_REASONS: Record<ReportReason, string> = {
  SPAM: 'Làm phiền / spam', HARASSMENT: 'Quấy rối', FAKE: 'Tài khoản giả', UNSAFE: 'Hành vi nguy hiểm', OTHER: 'Khác',
}

const MESSAGES: Record<string, string> = {
  INVALID_TARGET: 'Không thực hiện được với chính bạn.',
  USER_NOT_FOUND: 'Không tìm thấy runner này.',
  BLOCKED: 'Hai bạn đang chặn nhau nên không làm được việc này.',
  DM_NOT_ALLOWED: 'Chỉ nhắn được khi người này theo dõi bạn, là bạn kết nối, cùng CLB hoặc đã từng nhắn cho bạn.',
  RATE_LIMITED: 'Bạn thao tác hơi nhanh. Nghỉ một chút rồi thử lại nhé.',
  EMPTY_MESSAGE: 'Tin nhắn đang trống (tối đa 2000 ký tự).',
  NOT_AUTHOR: 'Chỉ người gửi mới thu hồi được tin này.',
  NOT_FOUND: 'Tin nhắn không còn nữa.',
  INVALID_REASON: 'Hãy chọn lý do báo cáo.',
  INVALID_EMOJI: 'Cảm xúc này chưa được hỗ trợ.',
}
export function socialErrorMessage(e: unknown): string {
  const raw = (e as { message?: string } | null)?.message ?? ''
  const key = Object.keys(MESSAGES).sort((a, b) => b.length - a.length).find((k) => raw.includes(k))
  return key ? MESSAGES[key] : systemErrorMessage(e, 'Không thực hiện được. Hãy thử lại.')
}
