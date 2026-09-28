import { describe, expect, it } from 'vitest'
import { coachLine, persistsNow } from './coach'

describe('giọng HLV', () => {
  it('đọc mốc km, bắt đầu, đứng yên lâu; tự tạm dừng chỉ đọc khi bật', () => {
    expect(coachLine({ type: 'START' }, true)).toBe('Bắt đầu chạy')
    expect(coachLine({ type: 'SPLIT', split: { km: 1, seconds: 330 }, movingS: 330 }, true)).toContain('Hoàn thành 1 ki lô mét')
    expect(coachLine({ type: 'AUTO_PAUSE' }, false)).toBeNull()
    expect(coachLine({ type: 'AUTO_PAUSE' }, true)).toBe('Tự tạm dừng')
    expect(coachLine({ type: 'LONG_STOP', minutes: 10 }, true)).toContain('10 phút')
    expect(coachLine({ type: 'GAP', gap: { from: '', to: '', seconds: 30, meters: 90, counted: true } }, true)).toBeNull()
  })
  it('lưu ngay ở các mốc quan trọng', () => {
    expect(persistsNow({ type: 'SPLIT', split: { km: 1, seconds: 300 }, movingS: 300 })).toBe(true)
    expect(persistsNow({ type: 'AUTO_PAUSE' })).toBe(false)
    expect(persistsNow({ type: 'LONG_STOP', minutes: 10 })).toBe(false)
  })
})
