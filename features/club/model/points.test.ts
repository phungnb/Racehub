import { describe, expect, it } from 'vitest'
import { describeRule, paceText, parsePace, RULE_TEMPLATES, validateRules } from './points'

describe('luật tính điểm CLB', () => {
  it('mô tả luật bằng lời', () => {
    expect(describeRule({ name: 'x', per: 'KM', points: 1.5, min_km: 1 })).toBe('1,5 điểm mỗi km · từ 1 km')
    expect(describeRule({ name: 'x', per: 'RUN', points: 5, from_hour: 4, to_hour: 7, days: [7, 6], max_pace_s: 390, group_only: true }))
      .toBe('5 điểm mỗi buổi · pace ≤ 6:30/km · bắt đầu 4h–7h · T7, CN · buổi chạy nhóm có điểm danh')
  })
  it('pace nhập kiểu 6:30 / 6.30', () => {
    expect(parsePace('6:30')).toBe(390)
    expect(parsePace('5.05')).toBe(305)
    expect(parsePace('6:75')).toBeNull()
    expect(parsePace('abc')).toBeNull()
    expect(paceText(305)).toBe('5:05')
  })
  it('kiểm tra giống máy chủ; mẫu gợi ý đều hợp lệ', () => {
    expect(validateRules([], null)).toContain('1–12')
    expect(validateRules([{ name: 'Km', per: 'KM', points: 200 }], null)).toContain('tối đa 100')
    expect(validateRules([{ name: 'Giờ', per: 'RUN', points: 1, from_hour: 9, to_hour: 7 }], null)).toContain('trước giờ kết thúc')
    expect(validateRules([{ name: 'Ok', per: 'RUN', points: 1 }], 0)).toContain('Trần')
    for (const t of RULE_TEMPLATES) expect(validateRules(t.rules, t.daily_cap)).toBeNull()
  })
})
