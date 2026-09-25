// Quản trị gói / đơn hàng / quyền tổ chức giải / kho quà (migration 003800, 003900). Máy chủ kiểm tra quyền admin.
import { supabase } from '@/shared/lib/supabase'
import { toOrder, type Order, type OrderStatus } from '@/features/billing'
import type { AccountKind } from './adminApi'
import type { MetricsMonth } from '../model/metrics'

async function call<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw error
  return data as T
}

export const listOrders = async (status: OrderStatus | 'ALL') =>
  ((await call<Order[]>('admin_list_orders', { p_status: status })) ?? []).map(toOrder)
export const confirmOrder = async (id: string, note: string) => toOrder(await call<Order>('admin_confirm_order', { p_order_id: id, p_note: note || null }))
export const cancelOrderAdmin = async (id: string) => toOrder(await call<Order>('cancel_order', { p_order_id: id }))

export const grantPlan = (input: { kind: AccountKind; id: string; plan: string; months: number; reason: string }) =>
  call<unknown>('admin_grant_plan', { p_owner_type: input.kind, p_owner_id: input.id, p_plan: input.plan, p_months: input.months, p_reason: input.reason })

export interface PlanInput {
  code: string; name?: string; description?: string | null; perks?: string[]; active?: boolean
  prices?: { months: number; price_vnd: number; active: boolean }[]
  credits?: { capacity: number; per_month: number }[]
}
export const savePlan = (p: PlanInput) => call<void>('admin_save_plan', { p })
export const saveXuPackage = (p: { id?: string; xu: number; bonus_xu: number; price_vnd: number; active: boolean; sort: number }) =>
  call<string>('admin_save_xu_package', { p })
export const setPaymentAccount = (bin: string, no: string, name: string) =>
  call<unknown>('admin_set_payment_account', { p_bank_bin: bin, p_account_no: no, p_account_name: name })

export interface OrganizerGrant { owner_type: AccountKind; owner_id: string; note: string | null; created_at: string; name: string | null }
export const listOrganizers = async () => (await call<OrganizerGrant[]>('admin_list_race_organizers')) ?? []
export const setOrganizer = (kind: AccountKind, id: string, allow: boolean, note: string | null) =>
  call<void>('admin_set_race_organizer', { p_owner_type: kind, p_owner_id: id, p_allow: allow, p_note: note })

export interface AdminGift {
  code: string; name: string; emoji: string; price_xu: number; tier: 'CHEER' | 'BOOST' | 'HYPE' | 'LEGEND'; description: string | null
  vip_tier: number; season_from: string | null; season_to: string | null; is_active: boolean; sort: number; sent_30d: number; burn_30d: number
}
export const listGifts = async () => ((await call<AdminGift[]>('admin_list_gifts')) ?? []).map((g) => ({
  ...g, price_xu: Number(g.price_xu), vip_tier: Number(g.vip_tier), sort: Number(g.sort), sent_30d: Number(g.sent_30d ?? 0), burn_30d: Number(g.burn_30d ?? 0),
}))
export const saveGift = (g: Omit<AdminGift, 'sent_30d' | 'burn_30d'>) => call<void>('admin_save_gift', { p: g })


export interface EconomyMetrics { months: MetricsMonth[]; snapshot: { supply: number; holders: number; median_balance: number; p90_balance: number } }
export async function getEconomyMetrics(months: number): Promise<EconomyMetrics> {
  const r = await call<{ months: Record<string, unknown>[]; snapshot: Record<string, unknown> }>('admin_economy_metrics', { p_months: months })
  const num = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, k === 'month' ? v : v === null ? null : Number(v)]))
  return { months: (r.months ?? []).map((m) => num(m) as unknown as MetricsMonth), snapshot: num(r.snapshot ?? {}) as unknown as EconomyMetrics['snapshot'] }
}

/* ---------------- Nhiệm vụ do admin tạo (migration 004300, v2: 004600) ---------------- */
export type QuestPeriod = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'EVENT' | 'ONCE'
export type QuestMetric = 'TOTAL_KM' | 'RUN_COUNT' | 'RUN_KM' | 'CHECKIN' | 'WEEK_KM' | 'WEEK_RUN_DAYS' | 'CHALLENGE_JOINS'
  | 'ACTIVE_DAYS' | 'WEEKEND_RUNS' | 'EARLY_RUNS' | 'CHALLENGE_FINISHES' | 'COMMUNITY_KM'
export type QuestCategory = 'RUN' | 'CONSISTENCY' | 'CHALLENGE' | 'COMMUNITY' | 'NEWBIE' | 'SOCIAL'
export interface QuestTier { target: number; xu: number }
export interface QuestParams { min_km?: number; before_hour?: number }
export interface QuestPasses { qty: number; max_slots: number; days: number }
export interface AdminQuest {
  id?: string; code?: string; title: string; description: string | null; period: QuestPeriod; metric: QuestMetric; target: number
  reward_xu: number; icon?: string; sort?: number; is_active: boolean; starts_at: string | null; ends_at: string | null; min_vip_tier: number
  category?: QuestCategory; params?: QuestParams; tiers?: QuestTier[] | null
  reward_item?: string | null; reward_badge?: { title: string; icon?: string } | null; reward_passes?: QuestPasses | null
  completions?: number; participants?: number; xu_paid?: number
}
export const listQuests = async () => ((await call<AdminQuest[]>('admin_list_quests')) ?? []).map((q) => ({
  ...q, target: Number(q.target), reward_xu: Number(q.reward_xu), completions: Number(q.completions ?? 0), participants: Number(q.participants ?? 0),
  xu_paid: Number(q.xu_paid ?? 0), params: q.params ?? {}, tiers: q.tiers?.length ? q.tiers.map((t) => ({ target: Number(t.target), xu: Number(t.xu) })) : null,
}))
export const saveQuest = (q: AdminQuest) => call<string>('admin_save_quest', { p: q })

export interface QuestLimits { dailyXuCap: number; weeklyXuCap: number; maxDaily: number; maxWeekly: number; maxMonthly: number; maxEvent: number; maxOnce: number }
type Pct = { p40?: number; p50?: number; p75?: number; p90?: number; n?: number }
export interface QuestInsights {
  users_total: number; new_users_14d: number; runners_7d: number; runners_30d: number; inactive_14_60: number
  week_km: Pct; week_days: Pct; month_km: Pct; month_days: Pct; run_km: Pct
  early_share: number; weekend_share: number; community_km_30d: number; quest_xu_30d: number; run_xu_30d: number; limits: QuestLimits
}
const numObj = <T,>(o: unknown): T => Object.fromEntries(Object.entries((o ?? {}) as Record<string, unknown>)
  .map(([k, v]) => [k, v === null ? 0 : typeof v === 'object' ? numObj(v) : Number(v)])) as T
export const getQuestInsights = async () => numObj<QuestInsights>(await call('admin_quest_insights'))
export const setQuestLimits = async (p: Partial<QuestLimits>) => numObj<QuestLimits>(await call('admin_set_quest_limits', { p }))

export interface QuestEstimate {
  supported: boolean; samples: number; active_runners: number; tiers: { target: number; xu: number; completers: number; rate: number }[]
  xu_per_period: number; periods: number; xu_total: number; open_ended: boolean; limits: QuestLimits
}
export async function estimateQuest(q: Pick<AdminQuest, 'period' | 'metric' | 'target' | 'reward_xu' | 'tiers' | 'params' | 'starts_at' | 'ends_at'>): Promise<QuestEstimate> {
  const r = await call<Record<string, unknown>>('admin_quest_estimate', { p: q })
  if (!r?.supported) return { supported: false } as QuestEstimate
  return { ...numObj<QuestEstimate>({ ...r, tiers: undefined, limits: undefined, supported: undefined, open_ended: undefined }),
    supported: true, open_ended: Boolean(r.open_ended), limits: numObj<QuestLimits>(r.limits),
    tiers: ((r.tiers ?? []) as Record<string, unknown>[]).map((t) => numObj(t)) } as QuestEstimate
}

/* ---------------- Khuyến mãi (migration 004300) ---------------- */
export type SegmentType = 'ALL' | 'ACTIVE' | 'INACTIVE' | 'NEW' | 'VIP' | 'FREE' | 'CLUB' | 'LEVEL' | 'USERS'
export interface Segment { type: SegmentType; days?: number; min_tier?: number; min_level?: number; club_id?: string; ids?: string[] }
export interface Reward { xu?: number; passes?: { qty: number; max_slots: number; days: number } | null; plan?: { code: string; months: number } | null }
export interface Promotion {
  id: string; kind: 'GRANT' | 'CODE' | 'SALE'; title: string; message: string | null; reward: Reward; segment: Segment | null; code: string | null
  max_uses: number | null; discount_pct: number; bonus_pct: number; applies_to: 'ALL' | 'PLAN' | 'XU'; plan_code: string | null
  starts_at: string; ends_at: string | null; is_active: boolean; recipients: number; created_at: string; creator: string | null; orders: number
}
export const previewSegment = (seg: Segment) => call<{ count: number; sample: string[] }>('admin_preview_segment', { p_segment: seg })
export const runGrant = (p: { title: string; message: string; segment: Segment; reward: Reward }) =>
  call<{ promotion_id: string; recipients: number }>('admin_run_grant', { p })
export const savePromo = (p: Partial<Promotion> & { kind: 'CODE' | 'SALE' }) => call<string>('admin_save_promo', { p })
export const listPromotions = async () => (await call<Promotion[]>('admin_list_promotions')) ?? []

/* ---------------- Ví Tỏa sáng (migration 004700) ---------------- */
export type ShineKind = 'PASS' | 'SHIELD' | 'COSMETIC'
export interface ShineItem {
  code: string; name: string; description: string | null; kind: ShineKind; cost: number; period_limit: number | null
  limit_period: 'WEEK' | 'MONTH'; min_senders: number; is_active: boolean; sort: number
  params: { max_slots?: number; days?: number; item_code?: string; xu_value?: number }
  redeemed_30d?: number; item_name?: string | null
}
export interface ShineConfig { tiers: number[]; perSenderWeeklyCap: number; minSenderAgeDays: number; minSenderRuns: number; thanksPerDay: number }
export interface ShineOverview {
  config: ShineConfig; items: ShineItem[]; gifted_30d: number; countable_30d: number; spent_30d: number; xu_equiv_30d: number
  tiers_count: { tier: number; users: number }[] | null
}
export async function getShineOverview(): Promise<ShineOverview> {
  const r = await call<ShineOverview>('admin_shine_overview')
  const num = (v: unknown) => Number(v ?? 0)
  return {
    ...r, gifted_30d: num(r.gifted_30d), countable_30d: num(r.countable_30d), spent_30d: num(r.spent_30d), xu_equiv_30d: num(r.xu_equiv_30d),
    config: { ...r.config, tiers: (r.config.tiers ?? []).map(num), perSenderWeeklyCap: num(r.config.perSenderWeeklyCap),
      minSenderAgeDays: num(r.config.minSenderAgeDays), minSenderRuns: num(r.config.minSenderRuns), thanksPerDay: num(r.config.thanksPerDay) },
    items: (r.items ?? []).map((i) => ({ ...i, cost: num(i.cost), min_senders: num(i.min_senders), sort: num(i.sort), redeemed_30d: num(i.redeemed_30d),
      period_limit: i.period_limit == null ? null : num(i.period_limit) })),
    tiers_count: (r.tiers_count ?? []).map((t) => ({ tier: num(t.tier), users: num(t.users) })),
  }
}
export const saveShineItem = (i: ShineItem) => call<string>('admin_save_shine_item', { p: i })
export const setShineConfig = (p: Partial<ShineConfig>) => call<ShineConfig>('admin_set_shine_config', { p })
