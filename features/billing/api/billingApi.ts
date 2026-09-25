// Gói VIP / CLB Pro / Nạp Xu (migration 003800). Chưa có cổng thanh toán: tạo đơn → chuyển khoản VietQR → admin xác nhận.
import { supabase } from '@/shared/lib/supabase'
import type { CapacityTier } from '@/shared/lib/economy'
import type { Sale } from '../model/sale'
import { systemErrorMessage } from '@/shared/lib/errors'

export interface PlanPrice { months: number; price_vnd: number; active: boolean }
export interface PlanCredit { capacity: number; per_month: number }
export interface Plan {
  code: string; name: string; owner_type: 'USER' | 'CLUB'; tier: number; description: string | null
  perks: string[]; active: boolean; prices: PlanPrice[]; credits: PlanCredit[]
}
export interface XuPackage { id: string; xu: number; bonus_xu: number; price_vnd: number; active: boolean; sort: number }
export interface PaymentAccount { bank_bin: string | null; account_no: string | null; account_name: string | null }
export interface Pricing { plans: Plan[]; packages: XuPackage[]; payment: PaymentAccount; xu_vnd: number; capacity_tiers: CapacityTier[] }

export type OrderStatus = 'PENDING' | 'PAID' | 'CANCELLED'
export interface Order {
  id: string; code: string; buyer_id: string; kind: 'PLAN' | 'XU'; plan_code: string | null; months: number | null
  package_id: string | null; owner_type: 'USER' | 'CLUB'; owner_id: string; amount_vnd: number; xu: number; bonus_xu: number
  status: OrderStatus; note: string | null; list_price_vnd?: number | null; promotion_id?: string | null; created_at: string; expires_at: string; paid_at: string | null
  plan_name: string | null; owner_name: string | null; buyer_name: string | null; payment: PaymentAccount
}
export interface ActivePlan { plan_code: string; name: string; tier: number; ends_at: string }
export interface Credit { id: string; capacity: number; remaining: number; total: number; expires_at: string | null; note: string | null }
export interface MyPlan { plan: ActivePlan | null; credits: Credit[]; orders: Order[] }
export interface ClubPlanStatus { plan: ActivePlan | null; pro: boolean; pro_until: string | null; credits: Credit[] }

const n = (v: unknown) => Number(v ?? 0)
export const toOrder = (o: Order): Order => ({ ...o, amount_vnd: n(o.amount_vnd), xu: n(o.xu), bonus_xu: n(o.bonus_xu), months: o.months == null ? null : n(o.months) })
const toCredit = (c: Credit): Credit => ({ ...c, capacity: n(c.capacity), remaining: n(c.remaining), total: n(c.total) })

export async function getPricing(): Promise<Pricing> {
  const { data, error } = await supabase.rpc('pricing_catalog')
  if (error) throw error
  const p = (data ?? {}) as Pricing
  return {
    plans: (p.plans ?? []).map((x) => ({
      ...x, tier: n(x.tier), perks: Array.isArray(x.perks) ? x.perks : [],
      prices: (x.prices ?? []).map((y) => ({ ...y, months: n(y.months), price_vnd: n(y.price_vnd) })),
      credits: (x.credits ?? []).map((y) => ({ capacity: n(y.capacity), per_month: n(y.per_month) })),
    })),
    packages: (p.packages ?? []).map((x) => ({ ...x, xu: n(x.xu), bonus_xu: n(x.bonus_xu), price_vnd: n(x.price_vnd), sort: n(x.sort) })),
    payment: p.payment ?? { bank_bin: null, account_no: null, account_name: null },
    xu_vnd: n(p.xu_vnd) || 100,
    capacity_tiers: (p.capacity_tiers ?? []).map((t) => ({ max: n(t.max), xu: n(t.xu) })),
  }
}

export async function getActiveSales(): Promise<Sale[]> {
  const { data, error } = await supabase.rpc('active_sales')
  if (error) throw error
  return ((data ?? []) as Sale[]).map((x) => ({ ...x, discount_pct: n(x.discount_pct), bonus_pct: n(x.bonus_pct) }))
}

export async function getMyPlan(): Promise<MyPlan> {
  const { data, error } = await supabase.rpc('my_plan')
  if (error) throw error
  const m = (data ?? {}) as MyPlan
  return { plan: m.plan ?? null, credits: (m.credits ?? []).map(toCredit), orders: (m.orders ?? []).map(toOrder) }
}

export async function getClubPlanStatus(clubId: string): Promise<ClubPlanStatus> {
  const { data, error } = await supabase.rpc('club_plan_status', { p_club_id: clubId })
  if (error) throw error
  const c = (data ?? {}) as ClubPlanStatus
  return { plan: c.plan ?? null, pro: Boolean(c.pro), pro_until: c.pro_until ?? null, credits: (c.credits ?? []).map(toCredit) }
}

export type OrderInput =
  | { kind: 'PLAN'; plan_code: string; months: number; club_id?: string | null }
  | { kind: 'XU'; package_id: string }

export async function createOrder(input: OrderInput): Promise<Order> {
  const { data, error } = await supabase.rpc('create_order', { p: input })
  if (error) throw error
  return toOrder(data as Order)
}

export async function cancelOrder(id: string): Promise<Order> {
  const { data, error } = await supabase.rpc('cancel_order', { p_order_id: id })
  if (error) throw error
  return toOrder(data as Order)
}

const MESSAGES: Record<string, string> = {
  TOO_MANY_PENDING_ORDERS: 'Bạn đang có 5 đơn chờ thanh toán. Hoàn tất hoặc hủy bớt rồi tạo đơn mới.',
  INVALID_PLAN: 'Gói không còn bán.',
  INVALID_MONTHS: 'Kỳ hạn này không còn bán.',
  INVALID_PACKAGE: 'Gói Xu không còn bán.',
  CLUB_STAFF_REQUIRED: 'Chỉ ban quản trị CLB mới mua gói cho CLB.',
  ORDER_NOT_FOUND: 'Không tìm thấy đơn hàng.',
  ORDER_NOT_PENDING: 'Đơn đã được xử lý.',
  NOT_A_MEMBER: 'Bạn không thuộc CLB này.',
  FORBIDDEN: 'Bạn không có quyền làm việc này.',
}

export function billingErrorMessage(e: unknown): string {
  const raw = (e as { message?: string } | null)?.message ?? ''
  const key = Object.keys(MESSAGES).find((k) => raw.includes(k))
  return key ? MESSAGES[key] : systemErrorMessage(e, 'Không thực hiện được. Hãy thử lại.')
}

export const MONTH_LABEL: Record<number, string> = { 1: '1 tháng', 3: '3 tháng', 6: '6 tháng', 12: '12 tháng' }
