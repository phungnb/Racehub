// Điểm CLB (009400), bảng điều khiển ban quản trị + tổng kết (009600)
import { supabase } from '@/shared/lib/supabase'
import type { LeaderboardPeriod } from './hubApi'

export interface PointRule {
  name: string
  per: 'RUN' | 'KM'
  points: number
  min_km?: number | null
  max_km?: number | null
  /** pace chậm nhất được tính (giây / km) */
  max_pace_s?: number | null
  from_hour?: number | null
  to_hour?: number | null
  /** 1 = Thứ Hai … 7 = Chủ nhật; trống = mọi ngày */
  days?: number[] | null
  group_only?: boolean
}
export interface PointRuleSet {
  version: number; enabled: boolean; rules: PointRule[]; daily_cap: number | null; use_boost: boolean
  valid_from: string; note: string | null; created_at: string; by: string | null
}
export interface PointRulesInfo { can_edit: boolean; current: PointRuleSet | null; history: PointRuleSet[] }
export interface PointsRow { rank: number; user_id: string; name: string; avatar_url: string | null; points: number; runs: number; me: boolean }
export interface MyPointRun {
  activity_id: string; title: string | null; started_at: string; km: number; points: number
  hits: { name: string; points: number }[]; boost: number; group: boolean; version: number; daily_cap: number | null
}
export type ApplyFrom = 'NOW' | 'WEEK' | 'MONTH' | 'ALL'
export interface PointRulesInput { enabled: boolean; rules: PointRule[]; daily_cap: number | null; use_boost: boolean; note: string }

const rpc = async <T>(fn: string, args: Record<string, unknown>): Promise<T> => {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw error
  return data as T
}
const num = (v: unknown) => Number(v ?? 0)

export const getPointRules = (clubId: string) => rpc<PointRulesInfo>('club_point_rules_get', { p_club: clubId })
export const savePointRules = (clubId: string, p: PointRulesInput, apply: ApplyFrom) =>
  rpc<number>('save_club_point_rules', { p_club: clubId, p, p_apply: apply })
export async function getPointsBoard(clubId: string, period: LeaderboardPeriod): Promise<{ has_rules: boolean; rows: PointsRow[] }> {
  const r = await rpc<{ has_rules: boolean; rows: PointsRow[] }>('club_points_board', { p_club: clubId, p_period: period })
  return { has_rules: r.has_rules, rows: r.rows.map((x) => ({ ...x, points: num(x.points) })) }
}
export async function getMyPoints(clubId: string, period: LeaderboardPeriod): Promise<MyPointRun[]> {
  const r = await rpc<MyPointRun[]>('club_points_mine', { p_club: clubId, p_period: period })
  return r.map((x) => ({ ...x, km: num(x.km), points: num(x.points), boost: num(x.boost) || 1, hits: x.hits.map((h) => ({ ...h, points: num(h.points) })) }))
}

export interface RecapMeta {
  distance_m: number; run_count: number; active_members: number; new_members: number
  top: { user_id: string; name: string; distance_m: number }[]
  points_top?: { user_id: string; name: string; points: number }[]
  events?: number; checkins?: number; milestones?: number
}
export interface ClubDashboard {
  members: number; new_30d: number
  pending: { user_id: string; name: string; avatar_url: string | null; requested_at: string }[]
  inactive: { user_id: string; name: string; avatar_url: string | null; last_run_at: string | null }[]
  this_week: RecapMeta; last_week: RecapMeta
  finance: { balance: number; claims: number; open_dues: number }
  events: { id: string; title: string; starts_at: string; going: number }[]
  challenges: { id: string; title: string; end_date: string; participants: number }[]
  draws: { ready: number; live: number }
  points: { has_rules: boolean; top: { user_id: string; name: string; points: number }[] }
  recap: { weekly: boolean; monthly: boolean }
}
export const getClubDashboard = (clubId: string) => rpc<ClubDashboard>('club_admin_dashboard', { p_club: clubId })
export const setClubRecap = (clubId: string, weekly: boolean, monthly: boolean) => rpc<void>('set_club_recap', { p_club: clubId, p_weekly: weekly, p_monthly: monthly })
export const postRecapNow = (clubId: string, period: 'WEEK' | 'MONTH') => rpc<string>('club_post_recap_now', { p_club: clubId, p_period: period })

const MESSAGES: Record<string, string> = {
  INVALID_RULES: 'Luật chưa hợp lệ: 1–12 luật, tên 2–60 ký tự, điểm theo km tối đa 100 / km, giờ bắt đầu phải trước giờ kết thúc.',
  INVALID_APPLY: 'Chọn thời điểm áp dụng hợp lệ.',
  RECAP_NOT_POSTED: 'Kỳ vừa rồi đã có tổng kết hoặc chưa ai chạy — không có gì để đăng.',
  FORBIDDEN: 'Chỉ ban quản trị CLB làm được việc này.',
  NOT_A_MEMBER: 'Bạn cần là thành viên CLB.',
}
export function pointsErrorMessage(e: unknown): string {
  const raw = (e as { message?: string } | null)?.message ?? ''
  const key = Object.keys(MESSAGES).sort((a, b) => b.length - a.length).find((k) => raw.includes(k))
  return key ? MESSAGES[key] : 'Không thực hiện được. Hãy thử lại.'
}
