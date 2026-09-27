import { describe, it, expect } from 'vitest'
import { periodRange, rankUnits, rollUpUnits } from './overview'

describe('tổng quan tổ chức', () => {
  it('cộng dồn đơn vị lên cấp trên, tính bình quân và tỷ lệ tham gia', () => {
    const [kd, kt] = rollUpUnits([
      { id: 'kd', name: 'Kinh doanh', parent_id: null, members: 1, active: 1, km: 5 },
      { id: 'mb', name: 'Miền Bắc', parent_id: 'kd', members: 2, active: 1, km: 15 },
      { id: 'mn', name: 'Miền Nam', parent_id: 'kd', members: 1, active: 0, km: 0 },
      { id: 'kt', name: 'Kỹ thuật', parent_id: null, members: 1, active: 1, km: 8 },
    ])
    expect(kd).toMatchObject({ members: 4, active: 2, km: 20, avg: 5, rate: 50 })
    expect(kd.children.map((c) => c.depth)).toEqual([1, 1])
    expect(rankUnits([kd, kt], 'total').map((u) => u.id)).toEqual(['kd', 'kt'])
    expect(rankUnits([kd, kt], 'avg').map((u) => u.id)).toEqual(['kt', 'kd'])
    expect(rankUnits([kd, kt], 'rate').map((u) => u.id)).toEqual(['kt', 'kd'])
  })
  it('khoảng ngày theo giờ Việt Nam', () => {
    const now = new Date('2026-09-27T20:00:00Z')   // 03:00 ngày 28/9 giờ VN, thứ Hai
    expect(periodRange('week', now).from).toBe('2026-09-27T17:00:00.000Z')
    expect(periodRange('month', now).from).toBe('2026-08-31T17:00:00.000Z')
    expect(periodRange('month', now).to).toBe('2026-09-28T17:00:00.000Z')
  })
})
