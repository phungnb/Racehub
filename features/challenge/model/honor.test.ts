import { describe, it, expect, vi } from 'vitest'
vi.mock('qrcode', () => ({ default: { toDataURL: vi.fn() } }))
const { autoHonorCard, autoHonorPoster, freshHonor, honorData, honorPayload, honorValue, resolveHonor, HONOR_FORMATS } = await import('./honor')

const ctx = { challenge: 'Tháng 9', org: 'Hồ Tây', date: '30/09/2026', objective: 'DISTANCE', challengeUrl: 'https://x/challenges/1' }

describe('vinh danh', () => {
  it('giá trị hiển thị theo hạng mục', () => {
    expect(honorValue('KM', 312.46, null)).toBe('312,5 km')
    expect(honorValue('STREAK', 7, null)).toBe('7 ngày liên tiếp')
    expect(honorValue('BREAKTHROUGH', 40, null)).toBe('+40 km')
    expect(honorValue('CUSTOM1', null, null)).toBe('')
  })
  it('ảnh nhóm tự động: bục top 3 có khung ảnh + tên + thành tích; hạng 4..n thành danh sách; mọi khổ đều nằm trong khung', () => {
    for (const f of Object.keys(HONOR_FORMATS) as (keyof typeof HONOR_FORMATS)[]) {
      const ls = autoHonorPoster(f, 'podium', 10)
      const photos = ls.filter((l) => l.type === 'photo').map((l) => (l as { bind: string }).bind)
      expect(photos).toEqual(['r1', 'r2', 'r3'])
      const binds = ls.flatMap((l) => (l.type === 'text' ? [l.bind] : []))
      expect(binds).toEqual(expect.arrayContaining(['category', 'challenge', 'r1_name', 'r1_value', 'r4_name']))
      for (const l of ls) { expect(l.y).toBeGreaterThanOrEqual(0); expect(l.y).toBeLessThanOrEqual(1) }
    }
    expect(autoHonorPoster('portrait', 'podium', 1).filter((l) => l.type === 'photo')).toHaveLength(1)
  })
  it('ảnh cá nhân: khung ảnh "me" + tên + hạng; mẫu giấy khen có vòng nguyệt quế', () => {
    const ls = autoHonorCard('portrait', 'paper')
    expect(ls.some((l) => l.type === 'photo' && l.bind === 'me')).toBe(true)
    expect(ls.some((l) => l.type === 'shape' && l.shape === 'laurel')).toBe(true)
  })
  it('dữ liệu vẽ: ảnh runner tự chọn ưu tiên hơn ảnh đại diện; runner ẩn không có ảnh', () => {
    const d = honorData(ctx, { key: 'KM', title: 'Nhiều km nhất' }, [
      { rank: 1, display_name: 'An', value: 300, photo_url: 'https://p/1.png', avatar_url: 'https://a/1.png' },
      { rank: 2, display_name: 'VĐV ẩn danh', value: 200, photo_url: null, avatar_url: null, hidden: true },
    ], { rank: 1, display_name: 'An', value: 300, photo_url: null, avatar_url: 'https://a/1.png' })
    expect(d.values).toMatchObject({ category: 'Nhiều km nhất', r1_name: 'An', r1_value: '300 km', r2_name: 'VĐV ẩn danh', me_rank: 'Hạng 1' })
    expect(d.photos).toMatchObject({ r1: 'https://p/1.png', r2: null, me: 'https://a/1.png' })
    expect(d.qr.race).toBe('https://x/challenges/1')
  })
  it('thiết kế lưu hỏng về mặc định; gửi lên chỉ màu khác mẫu', () => {
    expect(resolveHonor({ v: 2, format: 'A3' as never, template: 'x' as never, layers: [{ type: 'photo', bind: 'r1', zoom: 99 }] }, 'poster'))
      .toMatchObject({ format: 'portrait', template: 'podium', layers: [{ type: 'photo', bind: 'r1', zoom: 4 }] })
    const p = honorPayload({ ...freshHonor('card'), colors: { bg: '#0b1020', band: '#000000' } })
    expect(p.colors).toEqual({ band: '#000000' })
  })
})
