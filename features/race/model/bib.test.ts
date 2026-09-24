import { describe, it, expect, vi } from 'vitest'
vi.mock('qrcode', () => ({ default: { toDataURL: vi.fn() } }))
const { artRect, bibPayload, BIB_SIZE, DEFAULT_BIB, panArt, resolveBib, splitName, TEMPLATES } = await import('./bib')

describe('thiết kế BIB', () => {
  it('thiết kế trống / hỏng → mẫu cổ điển, màu theo mẫu', () => {
    const r = resolveBib(null)
    expect(r.template).toBe('classic')
    expect(r.palette).toEqual(TEMPLATES.classic.colors)
    expect(resolveBib({ template: 'lạ' as never }).template).toBe('classic')
  })
  it('màu BTC chọn đè lên màu mẫu; tối đa 4 nhà tài trợ', () => {
    const r = resolveBib({ template: 'neon', colors: { number: '#ff0000' }, sponsors: Array.from({ length: 6 }, (_, i) => ({ name: `S${i}`, logo_url: null })) })
    expect(r.palette).toMatchObject({ bg: TEMPLATES.neon.colors.bg, number: '#ff0000' })
    expect(r.sponsors).toHaveLength(4)
  })
  it('dữ liệu gửi lên: chỉ lưu màu khác mẫu, bỏ nhà tài trợ trống, cắt khoảng trắng', () => {
    const p = bibPayload({ ...DEFAULT_BIB, colors: { bg: '#FFFFFF', band: '#ff0000' }, tagline: '  ',
      sponsors: [{ name: ' A ', logo_url: null }, { name: '', logo_url: null }] })
    expect(p.colors).toEqual({ band: '#ff0000' })
    expect(p.tagline).toBeNull()
    expect(p.sponsors).toEqual([{ name: 'A', logo_url: null }])
  })
  it('bố cục số / tên + ảnh khung: thiếu → mặc định, ngoài khoảng bị kẹp, lựa chọn lạ bỏ qua', () => {
    const r = resolveBib({ text: { layout: 'diagonal', align: 'right', y: 2, scale: 0.1 } as never, art_fit: { zoom: 9, x: -3, y: 0.2 }, qr_pos: 'top' as never, use_art: true })
    expect(r.text).toEqual({ layout: 'below', align: 'right', font: 'mono', y: 0.85, scale: 0.5, name_scale: 1 })
    expect(r.art_fit).toEqual({ zoom: 3, x: -1, y: 0.2 })
    expect(r.qr_pos).toBe('right')
    expect(r.use_art).toBe(false)                                         // chưa có ảnh thì không bật khung
    expect(bibPayload({ ...DEFAULT_BIB, use_art: true }).use_art).toBe(false)
  })
  it('ảnh khung phủ kín BIB; kéo dịch theo px, kẹp ở mép ảnh', () => {
    const fit = { zoom: 1, x: 0, y: 0 }
    expect(artRect(1400, 1000, fit)).toEqual({ x: 0, y: 0, w: BIB_SIZE.w, h: BIB_SIZE.h })
    const tall = artRect(1000, 1000, fit)                               // ảnh vuông: rộng 1400, thừa 400 chiều dọc
    expect(tall).toMatchObject({ w: 1400, h: 1400, y: -200 })
    const moved = panArt(fit, 50, 100, 1000, 1000)
    expect(moved.x).toBe(0)                                              // chiều ngang vừa khít → không dịch
    expect(artRect(1000, 1000, moved).y).toBeCloseTo(-100)               // kéo xuống 100px
    expect(panArt(fit, 0, 5000, 1000, 1000).y).toBe(1)
  })
  it('tên 2 dòng cho bố cục cùng hàng', () => {
    expect(splitName('NGUYỄN VĂN AN')).toEqual(['NGUYỄN VĂN', 'AN'])
    expect(splitName(' An ')).toEqual(['An'])
  })
})
