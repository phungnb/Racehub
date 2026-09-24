import { describe, it, expect, vi } from 'vitest'
vi.mock('qrcode', () => ({ default: { toDataURL: vi.fn() } }))
const { applyPreset, artRect, bibPayload, BIB_SIZE, DEFAULT_BIB, DEFAULT_BOXES, hitBox, moveBox, panArt, resolveBib, TEMPLATES } = await import('./bib')

describe('thiết kế BIB', () => {
  it('thiết kế trống / hỏng → mẫu cổ điển, màu theo mẫu, 3 khung chữ mặc định', () => {
    const r = resolveBib(null)
    expect(r.template).toBe('classic')
    expect(r.palette).toEqual(TEMPLATES.classic.colors)
    expect(r.boxes).toEqual(DEFAULT_BOXES)
    expect(resolveBib({ template: 'lạ' as never }).template).toBe('classic')
  })
  it('màu BTC chọn đè lên màu mẫu; tối đa 4 nhà tài trợ', () => {
    const r = resolveBib({ template: 'neon', colors: { number: '#ff0000' }, sponsors: Array.from({ length: 6 }, (_, i) => ({ name: `S${i}`, logo_url: null })) })
    expect(r.palette).toMatchObject({ bg: TEMPLATES.neon.colors.bg, number: '#ff0000' })
    expect(r.sponsors).toHaveLength(4)
  })
  it('dữ liệu gửi lên: chỉ lưu màu khác mẫu, bỏ nhà tài trợ trống, cắt khoảng trắng', () => {
    const p = bibPayload({ ...DEFAULT_BIB, colors: { bg: '#FFFFFF', band: '#ff0000' }, tagline: '  ', org_text: '  ', use_art: true,
      sponsors: [{ name: ' A ', logo_url: null }, { name: '', logo_url: null }] })
    expect(p.colors).toEqual({ band: '#ff0000' })
    expect(p.tagline).toBeNull()
    expect(p.org_text).toBeNull()
    expect(p.use_art).toBe(false)                                          // chưa có ảnh thì không bật khung
    expect(p.sponsors).toEqual([{ name: 'A', logo_url: null }])
  })
  it('khung chữ: giá trị lạ về mặc định, ngoài khoảng bị kẹp', () => {
    const r = resolveBib({ boxes: { number: { x: 2, y: -1, font: 'comic' as never, size: 9, color: 'pink' as never, italic: true }, name: { show: false } } })
    expect(r.boxes.number).toMatchObject({ x: 1, y: 0, font: 'mono', size: 2.5, color: 'number', italic: true })
    expect(r.boxes.name.show).toBe(false)
    expect(r.show_name).toBe(false)
    expect(r.boxes.org).toEqual(DEFAULT_BOXES.org)
  })
  it('thiết kế bản 003000 (text.layout) vẫn hiển thị: đổi sang 3 khung', () => {
    const r = resolveBib({ text: { layout: 'above', font: 'outline', scale: 1.2 } as never })
    expect(r.boxes.name.y).toBeLessThan(r.boxes.number.y)
    expect(r.boxes.number).toMatchObject({ outline: true, font: 'sans', size: 1.2 })
  })
  it('bố cục nhanh giữ font / màu, chừa chỗ QR', () => {
    const b = applyPreset({ ...DEFAULT_BOXES, number: { ...DEFAULT_BOXES.number, font: 'impact', color: 'accent' } }, 'inline', 'right')
    expect(b.number).toMatchObject({ font: 'impact', color: 'accent', align: 'right' })
    expect(b.name.align).toBe('left')
    expect(b.name.y).toBe(b.number.y)
    expect(applyPreset(DEFAULT_BOXES, 'left', 'left').number.x).toBeGreaterThan(0.2)
  })
  it('kéo khung chữ theo px, kẹp trong BIB; chạm chọn khung', () => {
    expect(moveBox(DEFAULT_BOXES.number, 140, 100)).toMatchObject({ x: DEFAULT_BOXES.number.x + 0.1, y: DEFAULT_BOXES.number.y + 0.1 })
    expect(moveBox(DEFAULT_BOXES.number, 99999, -99999)).toMatchObject({ x: 1, y: 0 })
    const layout = { boxes: { number: { x: 100, y: 400, w: 800, h: 200 }, name: { x: 300, y: 560, w: 300, h: 50 } } }
    expect(hitBox(layout, 400, 570)).toBe('name')                         // khung nhỏ ưu tiên khi chồng
    expect(hitBox(layout, 150, 450)).toBe('number')
    expect(hitBox(layout, 1300, 100)).toBeNull()
  })
  it('ảnh khung phủ kín BIB; kéo dịch theo px, kẹp ở mép ảnh', () => {
    const fit = { zoom: 1, x: 0, y: 0 }
    expect(artRect(1400, 1000, fit)).toEqual({ x: 0, y: 0, w: BIB_SIZE.w, h: BIB_SIZE.h })
    expect(artRect(1000, 1000, fit)).toMatchObject({ w: 1400, h: 1400, y: -200 })
    const moved = panArt(fit, 50, 100, 1000, 1000)
    expect(moved.x).toBe(0)
    expect(artRect(1000, 1000, moved).y).toBeCloseTo(-100)
    expect(panArt(fit, 0, 5000, 1000, 1000).y).toBe(1)
  })
})
