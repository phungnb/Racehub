// Bậc Tỏa sáng (tổng giá trị quà đã nhận — danh tiếng, không giảm khi đổi quà). Ngưỡng mặc định; máy chủ có thể trả ngưỡng khác.
export const SHINE_THRESHOLDS = [500, 2000, 10000, 50000] as const
export const SHINE_NAMES = ['', 'Lấp lánh', 'Rạng rỡ', 'Chói sáng', 'Huyền thoại'] as const
export type ShineTier = 0 | 1 | 2 | 3 | 4

export function shineTier(total: number | null | undefined, thresholds: readonly number[] = SHINE_THRESHOLDS): ShineTier {
  return thresholds.filter((t) => (total ?? 0) >= t).length as ShineTier
}

/** Tiến độ tới bậc kế tiếp (null = đã cao nhất) */
export function shineProgress(total: number, thresholds: readonly number[] = SHINE_THRESHOLDS) {
  const tier = shineTier(total, thresholds)
  if (tier >= thresholds.length) return null
  const from = tier === 0 ? 0 : thresholds[tier - 1]
  const to = thresholds[tier]
  return { tier, next: (tier + 1) as ShineTier, from, to, remaining: to - total, value: total - from, span: to - from }
}
