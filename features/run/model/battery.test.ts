import { describe, it, expect } from 'vitest'
import { androidBrand } from './battery'

describe('đoán hãng máy Android', () => {
  it('theo mã máy trong User-Agent', () => {
    const ua = (m: string) => `Mozilla/5.0 (Linux; Android 14; ${m} Build/UP1A; wv) AppleWebKit/537.36 Chrome/128 Mobile Safari/537.36 RaceHubApp`
    expect(androidBrand(ua('SM-A546E'))).toBe('samsung')
    expect(androidBrand(ua('23053RN02A'))).toBe('xiaomi')
    expect(androidBrand(ua('Redmi Note 12'))).toBe('xiaomi')
    expect(androidBrand(ua('CPH2591'))).toBe('oppo')
    expect(androidBrand(ua('RMX3710'))).toBe('realme')
    expect(androidBrand(ua('V2250'))).toBe('vivo')
    expect(androidBrand(ua('Pixel 8'))).toBe('other')
  })
})
