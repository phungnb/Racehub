import { describe, it, expect, vi } from 'vitest'
vi.mock('qrcode', () => ({ default: { toDataURL: vi.fn() } }))
const { autoCert, certPayload, certValues, freshCert, keepCertAssets, resolveCert } = await import('./certificate')
const { imageLayer } = await import('./design')

describe('giấy chứng nhận do BTC thiết kế', () => {
  it('mặc định: khổ dọc, mẫu Đêm xanh, đủ tên / cự ly / thành tích / QR xác thực / ô chữ ký', () => {
    const d = resolveCert(null)
    expect(d).toMatchObject({ format: 'portrait', template: 'midnight' })
    const binds = d.layers.flatMap((l) => (l.type === 'text' ? [l.bind] : []))
    expect(binds).toEqual(expect.arrayContaining(['name', 'race', 'distance', 'time', 'pace', 'rank', 'date', 'bib']))
    expect(d.layers.some((l) => l.type === 'qr' && l.source === 'verify')).toBe(true)
    expect(d.layers.some((l) => l.type === 'image' && l.role === 'signature')).toBe(true)
  })
  it('đổi khổ / mẫu giữ logo + chữ ký đã tải; mẫu cổ điển có vòng nguyệt quế', () => {
    const logo = imageLayer({ x: 0, y: 0, role: 'logo', src: 'https://a/l.png' })
    const sign = imageLayer({ x: 0, y: 0, role: 'signature', src: 'https://a/k.png' })
    const ls = autoCert('landscape', 'ivory', keepCertAssets([...freshCert().layers.filter((l) => l.type !== 'image'), logo, sign]))
    expect(ls.find((l) => l.id === logo.id)).toMatchObject({ src: 'https://a/l.png', x: 0.5 })
    expect(ls.find((l) => l.id === sign.id)).toMatchObject({ src: 'https://a/k.png' })
    expect(ls.some((l) => l.type === 'shape' && l.shape === 'laurel')).toBe(true)
  })
  it('giá trị điền: thành tích, pace, hạng, BIB không tiền tố', () => {
    const v = certValues({ race: 'G', organizer: 'O', name: 'An', bib: 'HT-0042', distanceKm: 10, timeS: 3000, rank: 3, finishers: 50, date: 'd' })
    expect(v).toMatchObject({ time: '50:00', pace: '5:00/km', rank: '3/50', bib: 'BIB 0042', distance: '10 km' })
    expect(certValues({ race: 'G', organizer: 'O', name: 'An', bib: 'X', distanceKm: 5, timeS: 0, rank: null, finishers: 0, date: '' }).rank).toBe('—')
  })
  it('dữ liệu lưu: khổ / mẫu lạ về mặc định; gửi lên chỉ màu khác mẫu', () => {
    expect(resolveCert({ v: 2, format: 'A3' as never, template: 'x' as never, layers: [] })).toMatchObject({ format: 'portrait', template: 'midnight', layers: [] })
    const p = certPayload({ ...freshCert('portrait', 'ivory'), colors: { bg: '#fbf7ee', band: '#000000' } })
    expect(p.colors).toEqual({ band: '#000000' })
  })
})
