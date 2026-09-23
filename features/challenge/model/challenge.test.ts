import { describe, it, expect } from 'vitest'
import { challengePhase, timeLabel, timeProgress } from './challenge'

const now = new Date('2026-10-10T00:00:00Z')
const c = (s: string, e: string) => ({ start_date: s, end_date: e })

describe('trạng thái thử thách', () => {
  it('sắp diễn ra / đang diễn ra / đã kết thúc', () => {
    expect(challengePhase(c('2026-10-12T00:00:00Z', '2026-10-20T00:00:00Z'), now)).toBe('UPCOMING')
    expect(challengePhase(c('2026-10-01T00:00:00Z', '2026-10-20T00:00:00Z'), now)).toBe('LIVE')
    expect(challengePhase(c('2026-09-01T00:00:00Z', '2026-09-20T00:00:00Z'), now)).toBe('ENDED')
  })
  it('nhãn thời gian', () => {
    expect(timeLabel(c('2026-10-01T00:00:00Z', '2026-10-15T00:00:00Z'), now)).toBe('Còn 5 ngày')
    expect(timeLabel(c('2026-10-01T00:00:00Z', '2026-10-10T03:00:00Z'), now)).toBe('Còn 3 giờ')
    expect(timeLabel(c('2026-10-12T00:00:00Z', '2026-10-20T00:00:00Z'), now)).toBe('Bắt đầu sau 2 ngày')
    expect(timeLabel(c('2026-09-01T00:00:00Z', '2026-09-20T00:00:00Z'), now)).toBe('Đã kết thúc')
  })
  it('tiến độ thời gian', () => {
    expect(timeProgress(c('2026-10-05T00:00:00Z', '2026-10-15T00:00:00Z'), now)).toBeCloseTo(0.5)
  })
})
