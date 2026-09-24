import { describe, it, expect } from 'vitest'
import { formatCoin, formatDuration, formatKm, formatPace, formatRelative, paceFrom } from './format'

describe('format', () => {
  it('km & Xu theo kiểu Việt Nam', () => {
    expect(formatKm(5200)).toBe('5,20')
    expect(formatCoin(1250)).toBe('1.250')
    expect(formatCoin('10.2')).toBe('10,2')
  })
  it('thời gian', () => {
    expect(formatDuration(1950)).toBe('32:30')
    expect(formatDuration(3725)).toBe('1:02:05')
    expect(formatDuration(-5)).toBe('0:00')
  })
  it('pace', () => {
    expect(formatPace(315)).toBe('5:15')
    expect(formatPace(359.7)).toBe('6:00')
    expect(formatPace(0)).toBe('--:--')
    expect(formatPace(paceFrom(10000, 3000))).toBe('5:00')
  })
  it('thời gian tương đối', () => {
    const now = new Date('2026-10-01T10:00:00Z')
    expect(formatRelative('2026-10-01T09:58:00Z', now)).toBe('2 phút trước')
    expect(formatRelative('2026-10-01T07:00:00Z', now)).toBe('3 giờ trước')
    expect(formatRelative('2026-09-30T08:00:00Z', now)).toBe('Hôm qua')
  })
})
