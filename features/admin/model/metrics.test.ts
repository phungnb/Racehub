import { describe, expect, it } from 'vitest'
import { niceMax } from '@/shared/ui/BarChart'
import { deriveMetrics, type MetricsMonth } from './metrics'

describe('chỉ số kinh tế', () => {
  it('tính tỉ lệ đốt / phát ra, Xu mỗi người chạy, tỉ lệ dùng lượt; thiếu dữ liệu thì null', () => {
    const m = { earn_run: 800, earn_game: 150, earn_referral: 30, earn_level: 20, burn_fee: 400, burn_gift: 250, burn_shop: 50,
      active_runners: 10, credits_issued: 20, credits_used: 5, orders_created: 4, orders_expired: 2, runs: 100, runs_review: 3 } as MetricsMonth
    expect(deriveMetrics(m)).toMatchObject({ earned: 1000, burned: 700, ratio: 0.7, perRunner: 100, creditUse: 0.25, expiredShare: 0.5, reviewShare: 0.03 })
    expect(deriveMetrics({ ...m, earn_run: 0, earn_game: 0, earn_referral: 0, earn_level: 0, active_runners: 0 }).ratio).toBeNull()
  })
  it('đỉnh trục làm tròn số đẹp', () => {
    expect([0, 0.7, 13, 23, 180, 4100].map(niceMax)).toEqual([1, 1, 20, 25, 200, 5000])
  })
})
