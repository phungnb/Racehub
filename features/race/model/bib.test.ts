import { describe, it, expect, vi } from 'vitest'
vi.mock('qrcode', () => ({ default: { toDataURL: vi.fn() } }))
const { bibPayload, DEFAULT_BIB, resolveBib, TEMPLATES } = await import('./bib')

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
})
