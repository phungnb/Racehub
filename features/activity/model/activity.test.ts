import { describe, it, expect } from 'vitest'
import { normalizeActivity } from './activity'

describe('normalizeActivity', () => {
  it('đọc được cả tên cột cũ và mới', () => {
    expect(normalizeActivity({ id: 1, name: 'A', start_date: '2026-01-01', distance: 5000, time_s: 1500 }))
      .toMatchObject({ id: '1', title: 'A', startedAt: '2026-01-01', distanceM: 5000, movingS: 1500 })
    expect(normalizeActivity({ id: 2, title: 'B', start_time: '2026-02-01', distance_m: 10000, moving_time_s: 3000, validation_status: 'PENDING' }))
      .toMatchObject({ title: 'B', distanceM: 10000, movingS: 3000, status: 'PENDING' })
  })
  it('giá trị thiếu có mặc định an toàn', () => {
    expect(normalizeActivity({ id: 3 })).toMatchObject({ title: 'Chạy bộ', distanceM: 0, movingS: 0, status: null })
  })
})
