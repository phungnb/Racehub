import { describe, expect, it } from 'vitest'
import { DEFAULT_PLAN_CONTENT, renderPerks, toOps, toPlanContent, validatePlanContent } from './ops'

describe('thẻ gói do admin soạn (009200)', () => {
  const vars = { freeSlots: 5, clubMaxMembers: 1500, clubCaptains: 2, clubMaxOpen: 2, clubMaxSlots: 50, clubMinActive: 5, activeDays: 30 }

  it('thay biến bằng số đang áp dụng, có dấu chấm hàng nghìn', () => {
    expect(renderPerks(['Tạo thử thách tới {freeSlots} người', 'Tối đa {clubMaxMembers} thành viên'], vars))
      .toEqual(['Tạo thử thách tới 5 người', 'Tối đa 1.500 thành viên'])
  })

  it('biến = 0 (không có / không giới hạn) thì ẩn cả dòng; biến lạ giữ nguyên', () => {
    expect(renderPerks(['Tối đa {clubMaxMembers} thành viên', 'Chat, lịch', 'Cần ≥ {clubMinActive} người'], { ...vars, clubMaxMembers: 0, clubMinActive: 0 }))
      .toEqual(['Chat, lịch', 'Cần ≥ 0 người'])
    expect(renderPerks(['Giữ {abc}'], vars)).toEqual(['Giữ {abc}'])
  })

  it('thiếu / sai dữ liệu từ máy chủ → mẫu gốc; bản mặc định hợp lệ', () => {
    expect(toPlanContent(undefined)).toEqual(DEFAULT_PLAN_CONTENT)
    expect(toPlanContent({ free: { title: 'Free', perks: [1, 'Ghi bài'] } }).free).toMatchObject({ title: 'Free', perks: ['Ghi bài'] })
    expect(toOps({}).content.plans).toEqual(DEFAULT_PLAN_CONTENT)
    expect(validatePlanContent(DEFAULT_PLAN_CONTENT)).toBeNull()
    expect(validatePlanContent({ ...DEFAULT_PLAN_CONTENT, org: { ...DEFAULT_PLAN_CONTENT.org, perks: [] } })).toContain('Doanh nghiệp')
  })
})
