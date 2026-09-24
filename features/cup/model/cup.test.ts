import { describe, it, expect } from 'vitest'
import { canJoin, cupPhase, scoreText, validateCup } from './cup'

const now = Date.parse('2026-10-01T00:00:00Z')
const iso = (h: number) => new Date(now + h * 3600_000).toISOString()

describe('thách đấu CLB', () => {
  it('giai đoạn theo trạng thái + thời gian', () => {
    expect(cupPhase({ status: 'PENDING_REVIEW', start_at: iso(1), end_at: iso(48) }, now)).toBe('REVIEW')
    expect(cupPhase({ status: 'OPEN', start_at: iso(1), end_at: iso(48) }, now)).toBe('REGISTRATION')
    expect(cupPhase({ status: 'OPEN', start_at: iso(-1), end_at: iso(48) }, now)).toBe('LIVE')
    expect(cupPhase({ status: 'OPEN', start_at: iso(-50), end_at: iso(-1) }, now)).toBe('SETTLING')
    expect(cupPhase({ status: 'FINISHED', start_at: iso(-50), end_at: iso(-3) }, now)).toBe('FINISHED')
  })
  it('đăng ký: đang mở, chưa quá hạn, còn chỗ', () => {
    expect(canJoin({ status: 'OPEN', reg_close_at: iso(2), clubs: 3, max_clubs: 4 }, now)).toBe(true)
    expect(canJoin({ status: 'OPEN', reg_close_at: iso(-1), clubs: 3, max_clubs: 4 }, now)).toBe(false)
    expect(canJoin({ status: 'OPEN', reg_close_at: iso(2), clubs: 4, max_clubs: 4 }, now)).toBe(false)
    expect(canJoin({ status: 'PENDING_REVIEW', reg_close_at: iso(2), clubs: 0, max_clubs: 4 }, now)).toBe(false)
  })
  it('kiểm tra biểu mẫu khớp ràng buộc máy chủ', () => {
    const ok = { title: 'Cúp Hồ Gươm', start: iso(2), end: iso(24 * 7), close: iso(2), maxClubs: 10 }
    expect(validateCup(ok, now)).toBeNull()
    expect(validateCup({ ...ok, title: 'ab' }, now)).toContain('Tên')
    expect(validateCup({ ...ok, start: iso(-2) }, now)).toContain('tương lai')
    expect(validateCup({ ...ok, end: iso(10) }, now)).toContain('1 ngày')
    expect(validateCup({ ...ok, close: iso(24 * 8) }, now)).toContain('Hạn đăng ký')
    expect(validateCup({ ...ok, maxClubs: 1 }, now)).toContain('Số CLB')
  })
  it('điểm hiển thị theo cách tính', () => {
    expect(scoreText('TOTAL_KM', { km: 1234.5, avg_km: 20 })).toBe('1.234,5 km')
    expect(scoreText('AVG_KM', { km: 40, avg_km: 20.25 })).toBe('20,25 km/người')
  })
})
