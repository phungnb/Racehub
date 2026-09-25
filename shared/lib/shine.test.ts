import { describe, expect, it } from 'vitest'
import { shineProgress, shineTier } from './shine'

describe('bậc Tỏa sáng', () => {
  it('ngưỡng 500 / 2.000 / 10.000 / 50.000', () => {
    expect([0, 499, 500, 1999, 2000, 10000, 49999, 50000].map((t) => shineTier(t))).toEqual([0, 0, 1, 1, 2, 3, 3, 4])
    expect(shineTier(null)).toBe(0)
  })
  it('tiến độ tới bậc kế', () => {
    expect(shineProgress(1200)).toMatchObject({ tier: 1, next: 2, remaining: 800, value: 700, span: 1500 })
    expect(shineProgress(60000)).toBeNull()
  })
})
