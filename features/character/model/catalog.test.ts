import { describe, expect, it } from 'vitest'
import { hexToRgb, itemStatus, layerUrl, outfitDiff, resolveOutfit, tintPixel, type CharacterItem } from './catalog'

const it0 = (p: Partial<CharacterItem>): CharacterItem => ({ code: 'top_x', name: 'x', description: null, slot: 'top', rarity: 'common',
  render_kind: 'TINT', layer_urls: null, color: '#e11d48', price_xu: 20, unlock_level: 1, is_default: false, ...p })

describe('nhân vật 2D — hàm thuần', () => {
  it('đọc mã màu', () => {
    expect(hexToRgb('#ff8000')).toEqual([255, 128, 0])
    expect(hexToRgb('red')).toBeNull()
  })

  it('đổi màu giữ độ sáng tương đối (nếp vải) và trộn theo mặt nạ', () => {
    const red = [200, 20, 40] as const
    // điểm có độ sáng bằng trung bình vùng → đúng màu đích
    const mid = tintPixel(100, 100, 100, 1, red, 100)
    expect(mid.map(Math.round)).toEqual([200, 20, 40])
    // điểm tối hơn (nếp gấp) → màu đích tối hơn theo tỉ lệ
    const dark = tintPixel(50, 50, 50, 1, red, 100)
    expect(dark.map(Math.round)).toEqual([100, 10, 20])
    // ngoài mặt nạ → giữ nguyên
    expect(tintPixel(10, 20, 30, 0, red, 100)).toEqual([10, 20, 30])
    // màu đen vẫn còn chi tiết (không thành một mảng đen phẳng)
    const a = tintPixel(60, 60, 60, 1, [0, 0, 0], 100)
    const b = tintPixel(140, 140, 140, 1, [0, 0, 0], 100)
    expect(b[0]).toBeGreaterThan(a[0] + 20)
  })

  it('ảnh lớp theo giới tính, thiếu thì mượn bản còn lại; món TINT không có lớp', () => {
    const layer = it0({ render_kind: 'LAYER', slot: 'hat', layer_urls: { male: '/l/m.png' } })
    expect(layerUrl(layer, 'male')).toBe('/l/m.png')
    expect(layerUrl(layer, 'female')).toBe('/l/m.png')
    expect(layerUrl(it0({}), 'male')).toBeNull()
  })

  it('bộ đồ → món cần vẽ theo thứ tự lớp, bỏ mã lạ hoặc sai ô', () => {
    const items = [it0({ code: 'hat', slot: 'hat' }), it0({ code: 'top' }), it0({ code: 'shoes', slot: 'shoes' }), it0({ code: 'tights', slot: 'bottom' })]
    expect(resolveOutfit(items, { hat: 'hat', top: 'top', shoes: 'shoes', socks: 'khong_co', bottom: 'tights' }).map((i) => i.code))
      .toEqual(['tights', 'shoes', 'top', 'hat'])                 // áo nằm trên quần
    expect(resolveOutfit(items, { bottom: 'top' })).toEqual([])  // sai ô thì bỏ
  })

  it('trạng thái vật phẩm và phần thay đổi của bộ đồ', () => {
    expect(itemStatus(it0({ owned: true }), 1, { top: 'top_x' })).toBe('EQUIPPED')
    expect(itemStatus(it0({ owned: true }), 1, {})).toBe('OWNED')
    expect(itemStatus(it0({ unlock_level: 3 }), 2, {})).toBe('LOCKED')
    expect(itemStatus(it0({}), 2, {})).toBe('BUY')
    expect(outfitDiff({ top: 'a', hat: 'h' }, { top: 'b' })).toEqual({ top: 'b', hat: null })
    expect(outfitDiff({ top: 'a' }, { top: 'a' })).toEqual({})
  })
})
