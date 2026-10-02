import { describe, expect, it } from 'vitest'
import { formatDuration, hasContactOrLink, parsePace } from './hub'

describe('Hội quán — hàm thuần', () => {
  it('formatDuration', () => {
    expect(formatDuration(1530)).toBe('25:30')
    expect(formatDuration(6962)).toBe('1:56:02')
    expect(formatDuration(0)).toBeNull()
    expect(formatDuration(null)).toBeNull()
  })
  it('parsePace', () => {
    expect(parsePace('5:30')).toBe(330)
    expect(parsePace("6'05")).toBe(365)
    expect(parsePace('5:75')).toBeNull()
    expect(parsePace('1:00')).toBeNull()
    expect(parsePace('abc')).toBeNull()
  })
  it('chặn link / số điện thoại giống máy chủ, không chặn số liệu chạy', () => {
    expect(hasContactOrLink('Gọi 0905.123.456')).toBe(true)
    expect(hasContactOrLink('+84 905 123 456')).toBe(true)
    expect(hasContactOrLink('vào nhóm facebook nhé')).toBe(true)
    expect(hasContactOrLink('PR 10K 49:30, pace 4:57, chạy 2026 km năm nay')).toBe(false)
  })
})
