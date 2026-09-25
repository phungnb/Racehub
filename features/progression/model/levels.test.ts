import { describe, it, expect } from 'vitest'
import { levelProgress } from './levels'

describe('levelProgress', () => {
  it('Lv1 → Lv2 cần 1.000 XP', () => {
    const p = levelProgress(250, 1)
    expect(p.span).toBe(1000)
    expect(p.value).toBe(250)
    expect(p.remaining).toBe(750)
    expect(p.next?.name).toBe('Runner Triển Vọng')
  })
  it('Lv3 (5.000 → 15.000)', () => {
    const p = levelProgress(7000, 3)
    expect(p.value).toBe(2000)
    expect(p.span).toBe(10000)
  })
  it('bị hạ cấp: XP cao hơn ngưỡng cấp hiện tại vẫn hiển thị đầy thanh, không vượt', () => {
    const p = levelProgress(20000, 3)
    expect(p.value).toBe(p.span)
    expect(p.remaining).toBe(0)
  })
  it('8 cấp: Lv8 là cao nhất (từ 200.000 XP); dữ liệu thiếu thì mặc định Lv1', () => {
    expect(levelProgress(40000, 5).next?.level).toBe(6)
    expect(levelProgress(250000, 8).next).toBeNull()
    expect(levelProgress(null, null).current.level).toBe(1)
  })
})
