import { describe, expect, it } from 'vitest'
import { dayLabel, daysAgo } from './nearby'

describe('nhãn ngày', () => {
  it('daysAgo', () => {
    expect(daysAgo(null)).toBeNull()
    expect(daysAgo(0)).toBe('hôm nay')
    expect(daysAgo(1)).toBe('hôm qua')
    expect(daysAgo(4)).toBe('4 ngày trước')
  })
  it('dayLabel theo giờ Việt Nam', () => {
    const now = new Date('2026-10-02T20:00:00Z')            // 03:00 ngày 03/10 giờ VN
    expect(dayLabel('2026-10-03', now)).toBe('hôm nay')
    expect(dayLabel('2026-10-02', now)).toBe('hôm qua')
    expect(dayLabel('2026-09-30', now)).toBe('T4 30/09')
  })
})
