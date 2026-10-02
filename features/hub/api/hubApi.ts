// Hội quán runner (migration 012800, docs/QUANH_DAY_HOI_QUAN.md): runner toàn quốc tự tham gia — hồ sơ, thành tích ước tính,
// bài đăng rủ chạy / đi giải / pacer / khoe thành tích / hỏi đáp. Mọi đọc / ghi qua RPC.
import { supabase } from '@/shared/lib/supabase'
import { systemErrorMessage } from '@/shared/lib/errors'
import { nearbyErrorMessage, type ConnectionState, type Goal, type Purpose, type Slot } from '@/features/nearby'

export type PostKind = 'BUDDY' | 'RACE' | 'PACER' | 'SHARE' | 'ASK'
export type PrKey = '5K' | '10K' | 'HM' | 'FM'
export type HubReason = 'PACE' | 'PROVINCE' | 'GOAL' | 'SLOT' | 'ACTIVE'
export interface RunnerStats { km_30d: number; runs_30d: number; km_year: number; longest_km: number; last_run_at: string | null }

export interface HubRunner {
  id: string; name: string; avatar_url: string | null; level: number | null
  province: string | null; headline: string | null; bio: string | null
  goals: Goal[]; time_slots: Slot[]; purposes: Purpose[]
  pace_s: number | null; score: number; last_run_days: number | null
  stats: RunnerStats; prs: Partial<Record<PrKey, number>>
  connection: ConnectionState; following: boolean; reasons: HubReason[]
}
export interface HubFilters {
  province?: string; goal?: Goal | 'ALL'; purpose?: Purpose | 'ALL'; slot?: Slot | 'ALL'
  pace?: 'ALL' | 'FAST' | 'MID' | 'EASY'; q?: string; sort?: 'MATCH' | 'ACTIVE' | 'NEW'
}

export interface HubPost {
  id: string; kind: PostKind; body: string; province: string | null; area_label: string | null; near: boolean
  goal: Goal | null; pace_s: number | null; meet_at: string | null; race_name: string | null
  status: 'ACTIVE' | 'CLOSED' | 'HIDDEN'; expires_at: string; created_at: string
  interest_count: number; interested: boolean; is_mine: boolean; km?: number | null
  author: { id: string; name: string; avatar_url: string | null; level: number | null; province: string | null }
  activity: { distance_m: number; moving_time_s: number; day: string } | null
}
export interface FeedFilters { kind?: PostKind | 'ALL'; province?: string; scope?: 'ALL' | 'NEAR' | 'MINE'; id?: string }
export interface NewPost {
  kind: PostKind; body: string; near?: boolean; province?: string | null; goal?: Goal | null; pace_s?: number | null
  meet_at?: string | null; race_name?: string | null; activity_id?: string | null
}
export interface Interested { id: string; name: string; avatar_url: string | null; level: number | null; pace_s: number | null; province: string | null; at: string }

export interface MyHub {
  listed: boolean; eligible: boolean; valid_runs: number; suspended: boolean
  province: string | null; headline: string | null; bio: string | null
  goals: Goal[]; time_slots: Slot[]; purposes: Purpose[]; share_pace: boolean
  pace_s: number | null; stats: RunnerStats; prs: Partial<Record<PrKey, number>>
  located: boolean; interests_in: number; posts: HubPost[]
}

async function call<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw error
  return data as T
}

const page = <T>(x: { items: T[]; total: number } | null) => x ?? { items: [] as T[], total: 0 }
export const myHub = () => call<MyHub>('my_hub')
export const hubRunners = (f: HubFilters, offset = 0) => call<{ items: HubRunner[]; total: number } | null>('hub_runners', { p: { ...f, offset } }).then(page)
export const hubFeed = (f: FeedFilters, offset = 0) => call<{ items: HubPost[]; total: number } | null>('hub_feed', { p: { ...f, offset } }).then(page)
export const createHubPost = (p: NewPost) => call<HubPost>('create_hub_post', { p })
export const closeHubPost = (id: string) => call<void>('close_hub_post', { p_id: id })
export const toggleHubInterest = (id: string) => call<HubPost>('toggle_hub_interest', { p_id: id })
export const hubInterested = (id: string) => call<Interested[] | null>('hub_interested', { p_id: id }).then((x) => x ?? [])
export const reportHubPost = (id: string, reason: string) => call<void>('report_hub_post', { p_id: id, p_reason: reason })

const MESSAGES: Record<string, string> = {
  HUB_NOT_JOINED: 'Tham gia Hội quán (tạo hồ sơ) để đăng bài.',
  INVALID_POST: 'Bài đăng chưa hợp lệ: nội dung 5–500 ký tự, ngày hẹn trong 4 tháng tới.',
  RACE_NAME_REQUIRED: 'Ghi tên giải bạn định chạy.',
  TOO_MANY_POSTS: 'Tối đa 5 bài / ngày. Mai đăng tiếp nhé.',
  POST_NOT_FOUND: 'Bài đăng không còn (đã đóng, hết hạn hoặc bị ẩn).',
  ACTIVITY_NOT_FOUND: 'Không tìm thấy bài chạy (cần là bài hợp lệ, đã chia sẻ).',
  INVALID_TARGET: 'Không thực hiện được với bài của chính bạn.',
  RATE_LIMITED: 'Bạn thao tác hơi nhiều. Nghỉ chút rồi thử lại.',
  INVALID_REASON: 'Chọn lý do báo cáo.',
}

export function hubErrorMessage(e: unknown): string {
  const msg = (e as { message?: string } | null)?.message ?? ''
  const key = Object.keys(MESSAGES).sort((a, b) => b.length - a.length).find((k) => msg.includes(k))
  if (key) return MESSAGES[key]
  const n = nearbyErrorMessage(e)
  return n || systemErrorMessage(e, 'Không thực hiện được. Hãy thử lại.')
}
