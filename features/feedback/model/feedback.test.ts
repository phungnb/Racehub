import { describe, it, expect } from 'vitest'
import { bubbleVisible, canSubmit, HIDE_DAYS_AFTER_SEND } from './feedback'

describe('hộp thư góp ý', () => {
  it('canSubmit: cần điểm hài lòng hoặc lời nhắn ≥ 3 ký tự', () => {
    expect(canSubmit(null, '')).toBe(false)
    expect(canSubmit(null, '  ab ')).toBe(false)
    expect(canSubmit(null, 'abc')).toBe(true)
    expect(canSubmit(4, '')).toBe(true)
  })
  it('bubbleVisible: tắt thì ẩn đến lần mở app sau; đã gửi thì ẩn một thời gian', () => {
    const now = Date.now()
    expect(bubbleVisible(now, false, null)).toBe(true)
    expect(bubbleVisible(now, true, null)).toBe(false)
    expect(bubbleVisible(now, false, now - 86_400_000)).toBe(false)
    expect(bubbleVisible(now, false, now - (HIDE_DAYS_AFTER_SEND + 1) * 86_400_000)).toBe(true)
  })
})
