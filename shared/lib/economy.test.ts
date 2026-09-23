import { describe, expect, it } from 'vitest'
import { DEFAULT_POLICY, creationFee, feePolicyText, runReward, toPolicy, validatePolicy, xuToVnd } from './economy'

describe('chính sách Xu', () => {
  it('phí tạo thử thách theo số người (khớp private.challenge_creation_fee)', () => {
    expect([2, 5, 6, 10, 11, 20, 100].map((s) => creationFee(s))).toEqual([0, 0, 18, 30, 55, 100, 500])
  })
  it('thưởng chạy: 1 Xu km đầu + 0,2 Xu/km tiếp, trần 10 Xu/ngày', () => {
    expect(runReward(0.8)).toBe(0)
    expect(runReward(1)).toBe(1)
    expect(runReward(5)).toBe(1.8)
    expect(runReward(21.1)).toBe(5)
    expect(runReward(5, DEFAULT_POLICY, 9.5)).toBe(0.5)
  })
  it('đọc cấu hình thiếu khóa, mô tả, quy đổi, kiểm tra', () => {
    expect(toPolicy({ xuVnd: '2000', challengeFee: { ratePerSlot: 4 } })).toMatchObject({ xuVnd: 2000, firstKmXu: 1, challengeFee: { freeMaxSlots: 5, ratePerSlot: 4 } })
    expect(feePolicyText(DEFAULT_POLICY.challengeFee)).toBe('≤ 5 người miễn phí · 6–10 người 3 Xu/người · trên 10 người 5 Xu/người')
    expect(xuToVnd(30)).toBe('≈ 30.000đ')
    expect(validatePolicy(DEFAULT_POLICY)).toBeNull()
    expect(validatePolicy({ ...DEFAULT_POLICY, challengeFee: { ...DEFAULT_POLICY.challengeFee, midMaxSlots: 3 } })).toMatch(/Mốc giữa/)
  })
})
