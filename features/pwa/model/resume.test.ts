import { describe, expect, it } from 'vitest'
import { RESUME_AFTER_MS, shouldRefreshOnResume } from './resume'

describe('làm mới khi mở lại app', () => {
  it('chỉ làm mới khi đã ẩn đủ lâu', () => {
    expect(shouldRefreshOnResume(null, 1_000_000)).toBe(false)
    expect(shouldRefreshOnResume(1_000_000, 1_000_000 + RESUME_AFTER_MS - 1)).toBe(false)
    expect(shouldRefreshOnResume(1_000_000, 1_000_000 + RESUME_AFTER_MS)).toBe(true)
  })
})
