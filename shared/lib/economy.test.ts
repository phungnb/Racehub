import { describe, expect, it } from 'vitest'
import { DEFAULT_POLICY, capacityTier, creationFee, runPolicyText, feePolicyText, levelFor, levelProgress, runReward, runXuForKm, toPolicy, validatePolicy, xuToVnd } from './economy'

describe('kinh tế v2 (khớp migration 003700)', () => {
  it('Xu chạy theo bậc km trong ngày: km 1–2 = 0, km 3–10 = 2, km 11–20 = 1, trần 20', () => {
    expect([2, 3, 5, 10, 20, 30].map((km) => Math.min(runXuForKm(km), 20))).toEqual([0, 2, 6, 16, 20, 20])
    expect(runReward(3.5)).toBe(3)
    expect(runReward(7, DEFAULT_POLICY, 5)).toBe(12)          // tổng 12 km trong ngày
    expect(runReward(10, DEFAULT_POLICY, 12, 18)).toBe(2)     // chạm trần
    expect(runReward(0.8)).toBe(0)
    expect(runPolicyText(DEFAULT_POLICY.run)).toBe('km 1–2: 0 · km 3–10: 2 Xu/km · km 11–20: 1 Xu/km · từ km 21: 0 · tối đa 20 Xu/ngày')
  })
  it('phí theo quy mô, không theo thời gian; > 1.000 người: liên hệ admin', () => {
    expect([1, 5, 6, 20, 21, 50, 100, 101, 500, 1000].map((s) => creationFee(s))).toEqual([0, 0, 150, 150, 400, 400, 800, 1500, 3500, 7000])
    expect(creationFee(1001)).toBeNull()
    expect(capacityTier(60)).toEqual({ max: 100, xu: 800 })
    expect(feePolicyText(DEFAULT_POLICY.capacityTiers.slice(0, 3))).toBe('≤5 người miễn phí · ≤20: 150 Xu · ≤50: 400 Xu')
  })
  it('8 cấp độ theo XP', () => {
    expect([0, 999, 1000, 34999, 35000, 200000].map((x) => levelFor(x).level)).toEqual([1, 1, 2, 4, 5, 8])
    expect(levelProgress(3000)).toMatchObject({ pct: 50, need: 2000, next: { level: 3 } })
    expect(levelProgress(250000)).toMatchObject({ pct: 100, next: null })
  })
  it('đọc cấu hình thiếu khóa, quy đổi 1 Xu = 100đ, kiểm tra', () => {
    expect(toPolicy({ xuVnd: '200', run: { dailyCap: 30 } })).toMatchObject({ xuVnd: 200, run: { freeKm: 2, dailyCap: 30 }, checkinXu: 1 })
    expect(xuToVnd(150)).toBe('≈ 15.000đ')
    expect(validatePolicy(DEFAULT_POLICY)).toBeNull()
    expect(validatePolicy({ ...DEFAULT_POLICY, capacityTiers: [{ max: 5, xu: 0 }, { max: 5, xu: 10 }] })).toMatch(/trùng/)
  })
})
