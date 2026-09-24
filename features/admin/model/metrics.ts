// Chỉ số kinh tế theo tháng (admin_economy_metrics — migration 004000)
export interface MetricsMonth {
  month: string; earn_run: number; earn_game: number; earn_referral: number; earn_level: number; admin_net: number; purchased: number
  burn_fee: number; burn_gift: number; burn_shop: number; revenue_vnd: number; revenue_plan_vnd: number; orders_paid: number
  orders_created: number; orders_expired: number; confirm_hours: number | null; active_runners: number; runs: number; runs_review: number
  credits_issued: number; credits_used: number; subs_active: number
}

/** Chỉ số dẫn xuất + ngưỡng cảnh báo (đặc tả kinh tế v1.2, mục 11) */
export function deriveMetrics(m: MetricsMonth) {
  const earned = m.earn_run + m.earn_game + m.earn_referral + m.earn_level
  const burned = m.burn_fee + m.burn_gift + m.burn_shop
  const ratio = earned > 0 ? burned / earned : null
  return {
    earned, burned, ratio,
    perRunner: m.active_runners > 0 ? earned / m.active_runners : null,
    creditUse: m.credits_issued > 0 ? m.credits_used / m.credits_issued : null,
    expiredShare: m.orders_created > 0 ? m.orders_expired / m.orders_created : null,
    reviewShare: m.runs > 0 ? m.runs_review / m.runs : null,
  }
}
