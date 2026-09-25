import { describe, it, expect, vi } from 'vitest'
vi.mock('qrcode', () => ({ default: { toDataURL: vi.fn() } }))
const {
  artRect, cleanLayers, distribute, duplicateLayer, hitTest, imageLayer, moveInStack, moveLayer, paint, panArt, scaleLayer, shapeLayer, textLayer, textOf,
} = await import('./design')

const size = { w: 1400, h: 1000 }
const pal = { bg: '#ffffff', band: '#1f4fd8', number: '#000000', text: '#111111', accent: '#ffc21a' }

describe('engine thiết kế theo lớp', () => {
  it('màu: khóa bảng màu hoặc hex; sai → màu chữ', () => {
    expect(paint('band', pal)).toBe('#1f4fd8')
    expect(paint('#abcdef', pal)).toBe('#abcdef')
    expect(paint('pink', pal)).toBe('#111111')
  })
  it('kéo lớp theo px, hít vào đường giữa khổ', () => {
    const l = textLayer({ x: 0.3, y: 0.3 })
    expect(moveLayer(l, 140, 100, size).layer).toMatchObject({ x: 0.4, y: 0.4 })
    const snap = moveLayer(l, 0.2 * 1400 - 5, 0.2 * 1000 + 4, size)
    expect(snap).toMatchObject({ guideX: true, guideY: true, layer: { x: 0.5, y: 0.5 } })
    expect(moveLayer(l, 99999, -99999, size).layer).toMatchObject({ x: 1.2, y: -0.2 })
  })
  it('phóng to / thu nhỏ theo loại lớp, có giới hạn', () => {
    expect(scaleLayer(textLayer({ x: 0, y: 0, size: 100, w: 0.5 }), 2)).toMatchObject({ size: 200, w: 1 })
    expect(scaleLayer(textLayer({ x: 0, y: 0, size: 100 }), 100).size).toBe(800)
    expect(scaleLayer(imageLayer({ x: 0, y: 0, w: 0.1, h: 0.1 }), 0.5)).toMatchObject({ w: 0.05, h: 0.05 })
    expect(scaleLayer(shapeLayer({ x: 0, y: 0, shape: 'line', w: 0.4, h: 0.004 }), 2)).toMatchObject({ w: 0.8, h: 0.004 })
  })
  it('chạm chọn: lớp trên cùng thắng, hiểu góc xoay, bỏ qua lớp ẩn', () => {
    const a = textLayer({ x: 0.5, y: 0.5 }), b = textLayer({ x: 0.5, y: 0.5 }), c = textLayer({ x: 0.5, y: 0.5, hidden: true })
    const layout = { [a.id]: { cx: 700, cy: 500, w: 800, h: 200, rot: 0 }, [b.id]: { cx: 700, cy: 500, w: 100, h: 400, rot: 90 }, [c.id]: { cx: 700, cy: 500, w: 1400, h: 1000, rot: 0 } }
    expect(hitTest([a, b, c], layout, 700, 500)).toBe(b.id)
    expect(hitTest([a, b, c], layout, 850, 500)).toBe(b.id)             // b xoay 90°: rộng 400 theo chiều ngang
    expect(hitTest([a, b, c], layout, 1050, 550)).toBe(a.id)
    expect(hitTest([a, b, c], layout, 20, 20)).toBeNull()
  })
  it('thứ tự lớp, nhân bản, dàn đều', () => {
    const [a, b, c] = [1, 2, 3].map(() => textLayer({ x: 0.5, y: 0.5 }))
    expect(moveInStack([a, b, c], a.id, 'top').map((l) => l.id)).toEqual([b.id, c.id, a.id])
    expect(moveInStack([a, b, c], c.id, 'down').map((l) => l.id)).toEqual([a.id, c.id, b.id])
    const dup = duplicateLayer([a, b], a.id)
    expect(dup).toHaveLength(3)
    expect(dup[1].id).not.toBe(a.id)
    expect(dup[1].x).toBeCloseTo(0.53)
    const imgs = [imageLayer({ x: 0, y: 0, w: 0.2, h: 0.1 }), imageLayer({ x: 0, y: 0, w: 0.1, h: 0.1 })]
    const out = distribute(imgs, 0, 1, 0.9, 0.05)
    expect(out.map((l) => l.x)).toEqual([0.25, 0.75])
    expect(out[0]).toMatchObject({ y: 0.9, h: 0.05, w: 0.1 })              // giữ tỉ lệ logo
  })
  it('làm sạch lớp: id trùng được cấp mới, tối đa 40 lớp, bind lạ → chữ tự nhập', () => {
    const raw = [{ id: 'a', type: 'text', bind: 'hack', text: 'x' }, { id: 'a', type: 'shape', shape: 'star' }, ...Array.from({ length: 50 }, () => ({ type: 'qr' }))]
    const ls = cleanLayers(raw, { number: { label: 'Số', sample: '1' } })
    expect(ls).toHaveLength(40)
    expect(ls[0]).toMatchObject({ id: 'a', bind: 'custom' })
    expect(ls[1].id).not.toBe('a')
    expect(ls[1]).toMatchObject({ type: 'shape', shape: 'rect' })
  })
  it('chữ theo trường: giá trị VĐV, mẫu khi đang thiết kế, IN HOA tiếng Việt', () => {
    const l = textLayer({ x: 0, y: 0, bind: 'name', upper: true })
    expect(textOf(l, { values: { name: 'Nguyễn Văn Ân' }, qr: {} }, {})).toBe('NGUYỄN VĂN ÂN')
    expect(textOf(l, { values: {}, qr: {} }, {})).toBeNull()
    expect(textOf(l, { values: {}, qr: {} }, { editing: true, binds: { name: { label: 'Tên', sample: 'An' } } })).toBe('AN')
  })
  it('ảnh khung phủ kín khổ; kéo dịch theo px, kẹp ở mép ảnh', () => {
    const fit = { zoom: 1, x: 0, y: 0 }
    expect(artRect(1400, 1000, fit, size)).toEqual({ x: 0, y: 0, w: 1400, h: 1000 })
    expect(artRect(1000, 1000, fit, size)).toMatchObject({ w: 1400, h: 1400, y: -200 })
    const moved = panArt(fit, 50, 100, 1000, 1000, size)
    expect(moved.x).toBe(0)
    expect(artRect(1000, 1000, moved, size).y).toBeCloseTo(-100)
    expect(panArt(fit, 0, 5000, 1000, 1000, size).y).toBe(1)
  })
})
