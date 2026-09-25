import { describe, expect, it } from 'vitest'
import { applyScheme, contrastText, defaultKit, extractPalette, KIT_SCHEMES, kitFromRequest, kitItems, kitParts, pickPrimarySecondary } from './kit'

/** Ảnh giả: nền xám, 60% đỏ, 30% vàng, 10% trắng */
function fakeImage(w = 40, h = 40) {
  const px = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = (y * w + x) * 4
    const inside = x > 4 && x < w - 5 && y > 4 && y < h - 5
    const c = !inside ? [200, 200, 205] : x < 22 ? [220, 30, 40] : x < 32 ? [250, 204, 21] : [255, 255, 255]
    px.set([...c, 255], o)
  }
  return { px, w, h }
}

describe('Bộ đồng phục', () => {
  it('hút màu: bỏ nền, màu nhiều nhất đứng trước', () => {
    const { px, w, h } = fakeImage()
    const pal = extractPalette(px, w, h)
    expect(pal[0]).toMatch(/^#d[c-f]1[d-f]2[6-9]/)             // đỏ
    expect(pal.some((c) => c.startsWith('#f'))).toBe(true)   // vàng
    expect(pal.some((c) => c === '#c8c8cd')).toBe(false)     // nền bị bỏ
    // mép pha đỏ + nền (hồng) không được coi là màu CLB
    const px2 = new Uint8ClampedArray(px)
    for (let y = 5; y < 35; y++) { const o = (y * w + 5) * 4; px2.set([214, 118, 128, 255], o); px2.set([214, 118, 128, 255], o + 4) }
    expect(extractPalette(px2, w, h).some((c) => c.startsWith('#d6'))).toBe(false)
    const [p, s] = pickPrimarySecondary(pal)
    expect(p).toBe(pal[0])
    expect(s).not.toBe(p)
  })

  it('phối màu giữ nội dung in, chữ luôn đọc được, giữ món đã tắt', () => {
    const k = { ...defaultKit('Hà Nội Runners', '#dc2626'), shoes: null }
    const out = applyScheme(k, KIT_SCHEMES[2], '#fef08a', '#1e3a8a')
    expect(out.print.layers?.[0]).toMatchObject({ text: 'HÀ NỘI RUNNERS', color: '#1e3a8a' })   // phụ đủ tương phản trên áo vàng nhạt
    expect(out.print.layers?.[1].text).toBe('{TEN}')
    expect(out.shoes).toBeNull()
    expect(contrastText('#fef08a')).toBe('#111111')
    expect(kitItems(out).map((i) => i.slot)).toEqual(['top', 'bottom', 'socks'])
    const parts = kitParts(out)
    expect(Object.keys(parts)).toEqual(['bottom', 'socks'])
    expect(kitFromRequest({ color: out.top, print: out.print, parts }).bottom).toMatchObject(out.bottom!)
  })
})
