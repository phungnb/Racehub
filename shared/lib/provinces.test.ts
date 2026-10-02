import { describe, expect, it } from 'vitest'
import { guessProvince } from './provinces'

describe('guessProvince', () => {
  it('lấy tỉnh / thành đứng cuối địa chỉ, không phân biệt dấu', () => {
    expect(guessProvince('Hồ Tây, Tây Hồ, Hà Nội')).toBe('Hà Nội')
    expect(guessProvince('Đường Hà Nội, Thủ Đức, Thành phố Hồ Chí Minh')).toBe('TP. Hồ Chí Minh')
    expect(guessProvince('Bien Da Nang, da nang')).toBe('Đà Nẵng')
    expect(guessProvince('Vientiane')).toBeNull()
    expect(guessProvince(null)).toBeNull()
  })
})
