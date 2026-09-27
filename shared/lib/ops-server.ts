import 'server-only'
import { cache } from 'react'
import { createSupabaseServerClient } from './supabase-server'
import { DEFAULT_OPS, toOps, type OpsPolicy } from './ops'

/** Chính sách vận hành phía máy chủ (trang công khai: Doanh nghiệp…); lỗi / chưa chạy 009100 → mặc định */
export const loadOps = cache(async (): Promise<OpsPolicy> => {
  try {
    const supabase = await createSupabaseServerClient()
    const { data, error } = await supabase.rpc('ops_policy')
    return error ? DEFAULT_OPS : toOps(data)
  } catch {
    return DEFAULT_OPS
  }
})

export interface PlanFacts { freeMaxMembers: number; freeMaxOpen: number; freeMaxSlots: number; proMaxOpen: number; proMaxSlots: number; proFromMonthly: number | null }

/** Số liệu gói CLB đang áp dụng (Quản trị → Kinh tế / Gói & giá) — trang giới thiệu không ghi cứng giá / hạn mức */
export const loadPlanFacts = cache(async (): Promise<PlanFacts> => {
  const d: PlanFacts = { freeMaxMembers: 50, freeMaxOpen: 2, freeMaxSlots: 50, proMaxOpen: 20, proMaxSlots: 1000, proFromMonthly: null }
  try {
    const supabase = await createSupabaseServerClient()
    const { data, error } = await supabase.rpc('plan_compare')
    if (error || !data) return d
    const c = (data as { club?: Record<string, number>; plans?: { owner_type: string; prices: { months: number; price_vnd: number }[] }[] })
    const club = c.club ?? {}
    const monthly = (c.plans ?? []).filter((p) => p.owner_type === 'CLUB')
      .flatMap((p) => p.prices.map((x) => x.price_vnd / Math.max(1, x.months))).filter((x) => x > 0)
    return {
      freeMaxMembers: Number(club.freeMaxMembers ?? d.freeMaxMembers), freeMaxOpen: Number(club.freeMaxOpen ?? d.freeMaxOpen),
      freeMaxSlots: Number(club.freeMaxSlots ?? d.freeMaxSlots), proMaxOpen: Number(club.proMaxOpen ?? d.proMaxOpen),
      proMaxSlots: Number(club.proMaxSlots ?? d.proMaxSlots), proFromMonthly: monthly.length ? Math.min(...monthly) : null,
    }
  } catch {
    return d
  }
})
