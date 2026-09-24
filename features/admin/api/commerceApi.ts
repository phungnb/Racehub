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
