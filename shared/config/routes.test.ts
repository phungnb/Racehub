import { describe, it, expect } from 'vitest'
import { safeNext } from './routes'

describe('safeNext', () => {
  it('chỉ nhận đường dẫn nội bộ', () => {
    expect(safeNext('/challenges')).toBe('/challenges')
    expect(safeNext('https://evil.com')).toBe('/feed')
    expect(safeNext('//evil.com')).toBe('/feed')
    expect(safeNext('/\\evil.com')).toBe('/feed')
    expect(safeNext(null)).toBe('/feed')
  })
})
