import { describe, it, expect, vi } from 'vitest'
vi.mock('qrcode', () => ({ default: { toDataURL: vi.fn() } }))
const { arrangeSponsors, autoBib, bibNumber, bibPayload, freshBib, fromV1, keepAssets, resolveBib, STRIP_H, TEMPLATES } = await import('./bib')
const { imageLayer, qrLayer, textLayer } = await import('./design')

const texts = (ls: { type: string }[]) => ls.filter((l): l is ReturnType<typeof textLayer> => l.type === 'text')

describe('thiết kế BIB bản 2 (lớp)', () => {
  it('số BIB in lên bỏ tiền tố chữ viết tắt', () => {
    expect(bibNumber('HT-0421')).toBe('0421')
    expect(bibNumber('A-B-0007')).toBe('0007')
    expect(bibNumber('0421')).toBe('0421')
  })
  it('chưa có thiết kế → bố cục tự động mẫu cổ điển: số, tên, giải, cự ly, QR xác thực, ô logo', () => {
    const r = resolveBib(null)
    expect(r.template).toBe('classic')
    expect(r.palette).toEqual(TEMPLATES.classic.colors)
    const binds = texts(r.layers).map((l) => l.bind)
    expect(binds).toEqual(expect.arrayContaining(['number', 'name', 'race', 'distance', 'org', 'dates']))
    expect(r.layers.some((l) => l.type === 'qr' && l.source === 'verify')).toBe(true)
    expect(r.layers.some((l) => l.type === 'image' && l.role === 'logo')).toBe(true)
  })
  it('bố cục tự động giữ logo / QR / nhà tài trợ BTC đã thêm; logo tài trợ dàn đều trong dải dưới', () => {
    const logo = imageLayer({ x: 0.3, y: 0.3, role: 'logo', src: 'https://a/logo.png' })
    const fee = qrLayer({ x: 0.1, y: 0.1, source: 'fee', src: 'https://a/qr.png' })
    const club = qrLayer({ x: 0.1, y: 0.1, source: 'club' })
    const sp = [1, 2, 3].map((i) => imageLayer({ x: 0, y: 0, role: 'sponsor', name: `S${i}` }))
    const ls = autoBib('marathon', keepAssets([logo, fee, club, ...sp]), { strip: true })
    expect(ls.find((l) => l.id === logo.id)).toMatchObject({ src: 'https://a/logo.png' })
    const qrs = ls.filter((l) => l.type === 'qr')
    expect(qrs.map((q) => q.id)).toEqual([fee.id, club.id])
    expect(qrs[0].y).toBeLessThan(qrs[1].y)                              // xếp dọc, không chồng
    const placed = ls.filter((l) => l.type === 'image' && l.role === 'sponsor')
    expect(placed.map((l) => l.y)).toEqual([1 - STRIP_H / 2, 1 - STRIP_H / 2, 1 - STRIP_H / 2])
    expect(placed[0].x).toBeLessThan(placed[1].x)
    expect(placed[1].x).toBeCloseTo(0.5)
    // Kéo lệch rồi “Xếp đều” đưa về dải
    const moved = placed.map((l, i) => ({ ...l, x: 0.1 * i, y: 0.2 }))
    expect(arrangeSponsors(moved).every((l) => l.y === 1 - STRIP_H / 2)).toBe(true)
  })
  it('thiết kế bản 1 (3 khung chữ + đầu BIB + QR cố định) vẫn hiển thị: đổi sang lớp giữ vị trí, font, ẩn / hiện', () => {
    const v1 = { template: 'neon', logo_url: 'https://a/logo.png', tagline: 'No Beer No Run', qr_pos: 'left', org_text: 'BTC Hồ Tây',
      sponsors: [{ name: 'A', logo_url: null }], boxes: { number: { x: 0.6, y: 0.5, font: 'impact', size: 1.2, outline: true }, name: { show: false } } }
    const d = fromV1(v1)
    expect(d.template).toBe('neon')
    const t = texts(d.layers)
    expect(t.find((l) => l.bind === 'number')).toMatchObject({ x: 0.6, y: 0.5, font: 'impact', size: 360, fx: 'outline' })
    expect(t.find((l) => l.bind === 'name')?.hidden).toBe(true)
    expect(t.find((l) => l.text === 'BTC Hồ Tây')).toBeTruthy()          // chữ Đơn vị tổ chức riêng
    expect(t.find((l) => l.text === 'No Beer No Run')).toBeTruthy()
    expect(d.layers.find((l) => l.type === 'qr')?.x).toBeLessThan(0.3)
    expect(d.strip).toBe(true)
    expect(resolveBib(v1).layers.length).toBe(d.layers.length)           // resolveBib nhận ra bản 1
  })
  it('dữ liệu lưu hỏng: mẫu lạ về cổ điển, màu sai bị bỏ, lớp lạ bị bỏ, giá trị bị kẹp', () => {
    const r = resolveBib({ v: 2, template: 'lạ' as never, colors: { bg: 'red', band: '#ABCDEF' }, layers: [
      { type: 'text', bind: 'number', size: 5000, x: 9, font: 'comic' }, { type: 'video' }, null] })
    expect(r.template).toBe('classic')
    expect(r.colors).toEqual({ band: '#abcdef' })
    expect(r.layers).toHaveLength(1)
    expect(r.layers[0]).toMatchObject({ type: 'text', bind: 'number', size: 800, x: 1.2, font: 'sans' })
  })
  it('dữ liệu gửi lên: chỉ lưu màu khác mẫu, bỏ chữ tự nhập trống, không bật ảnh khung khi chưa có ảnh', () => {
    const d = freshBib()
    const p = bibPayload({ ...d, colors: { bg: '#FFFFFF', band: '#ff0000' }, use_art: true,
      layers: [...d.layers, textLayer({ x: 0.5, y: 0.5, text: '   ' }), textLayer({ x: 0.5, y: 0.5, text: ' Hi ' })] })
    expect(p.colors).toEqual({ band: '#ff0000' })
    expect(p.use_art).toBe(false)
    expect(p.layers).toHaveLength(d.layers.length + 1)
    expect(texts(p.layers).at(-1)?.text).toBe('Hi')
    expect(p.v).toBe(2)
  })
})
