import { describe, it, expect } from 'vitest'
import { mapStravaActivity, summarize, syncWindowStart, tokenNeedsRefresh } from './mapping'

describe('mapStravaActivity', () => {
  it('bài chạy Garmin qua Strava', () => {
    expect(mapStravaActivity({
      id: 1, name: ' Morning Run ', sport_type: 'Run', start_date: '2026-09-20T23:00:00Z', elapsed_time: 1900,
      moving_time: 1800.4, distance: 5012.3, total_elevation_gain: 12, average_speed: 2.78, max_speed: 4.1,
      average_heartrate: 152, manual: false, device_name: 'Garmin Forerunner 255', map: { summary_polyline: 'abc' },
    })).toEqual({
      title: 'Morning Run', sport_type: 'Run', started_at: '2026-09-20T23:00:00Z', elapsed_s: 1900, moving_s: 1800,
      distance_m: 5012.3, elevation_gain_m: 12, avg_speed_mps: 2.78, max_speed_mps: 4.1, avg_heartrate: 152,
      manual: false, has_gps: true, device_name: 'Garmin Forerunner 255',
    })
  })
  it('chạy máy → VirtualRun; không bản đồ → has_gps false; thiếu trường không làm hỏng', () => {
    const m = mapStravaActivity({ id: 2, type: 'Run', trainer: true, map: { summary_polyline: '' } })
    expect(m.sport_type).toBe('VirtualRun')
    expect(m.has_gps).toBe(false)
    expect(m.title).toBe('Buổi chạy')
    expect(m.avg_heartrate).toBeNull()
  })
})

describe('tiện ích đồng bộ', () => {
  const now = new Date('2026-10-01T00:00:00Z')
  it('làm mới token khi sắp hết hạn', () => {
    expect(tokenNeedsRefresh('2026-10-01T00:01:00Z', now)).toBe(true)
    expect(tokenNeedsRefresh('2026-10-01T06:00:00Z', now)).toBe(false)
    expect(tokenNeedsRefresh(null, now)).toBe(true)
  })
  it('cửa sổ đồng bộ tối đa 30 ngày, lùi 1 ngày so với lần trước', () => {
    expect(syncWindowStart(null, now).toISOString()).toBe('2026-09-01T00:00:00.000Z')
    expect(syncWindowStart('2026-09-30T12:00:00Z', now).toISOString()).toBe('2026-09-29T12:00:00.000Z')
    expect(syncWindowStart('2025-01-01T00:00:00Z', now).toISOString()).toBe('2026-09-01T00:00:00.000Z')
  })
  it('tổng hợp kết quả', () => {
    expect(summarize([
      { result: 'IMPORTED', validation_status: 'APPROVED', earned_xu: 5 },
      { result: 'IMPORTED', validation_status: 'PENDING', earned_xu: 0 },
      { result: 'SKIPPED' }, { result: 'DUPLICATE' }, { result: 'UPDATED' },
    ])).toEqual({ imported: 2, pending: 1, skipped: 1, duplicates: 2, earned_xu: 5 })
  })
})

describe('mapStravaDetail', () => {
  it('bản chi tiết: polyline đầy đủ, từng km, cadence nhân đôi, bỏ đoạn lẻ quá ngắn', async () => {
    const { mapStravaDetail } = await import('./mapping')
    const d = mapStravaDetail({
      id: 1, map: { polyline: 'FULL', summary_polyline: 'SUM' }, start_latlng: [21.03, 105.85], average_cadence: 86.4, max_heartrate: 181,
      splits_metric: [
        { distance: 1000.4, moving_time: 330, elevation_difference: 3.2, average_heartrate: 148.6 },
        { distance: 1000, moving_time: 325 },
        { distance: 20, moving_time: 7 },
      ],
    }, true)
    expect(d).toMatchObject({ polyline: 'FULL', avg_cadence: 173, max_heartrate: 181, start_lat: 21.03, start_lng: 105.85, detailed: true })
    expect(d!.splits).toEqual([
      { distance_m: 1000, moving_s: 330, elev_m: 3.2, hr: 149 },
      { distance_m: 1000, moving_s: 325, elev_m: null, hr: null },
    ])
  })
  it('bản tóm tắt: chỉ polyline rút gọn; không có gì thì bỏ qua', async () => {
    const { mapStravaDetail } = await import('./mapping')
    expect(mapStravaDetail({ id: 1, map: { polyline: 'FULL', summary_polyline: 'SUM' } }, false)).toMatchObject({ polyline: 'SUM', splits: null, detailed: false })
    expect(mapStravaDetail({ id: 1, map: { summary_polyline: '' } }, false)).toBeNull()
  })
})
