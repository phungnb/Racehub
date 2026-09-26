import { describe, it, expect } from 'vitest'
import { compareNotes, decodePolyline, fastestSplit, fitRoute, haversine, splitsFromPoints, thin, type TrackPoint } from './route'

describe('route: polyline & khoảng cách', () => {
  it('giải mã polyline mẫu của Google', () => {
    expect(decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@')).toEqual([[38.5, -120.2], [40.7, -120.95], [43.252, -126.453]])
    expect(decodePolyline(null)).toEqual([])
  })
  it('haversine: 0,001° vĩ độ ≈ 111 m', () => {
    expect(haversine([21, 105], [21.001, 105])).toBeCloseTo(111.2, 0)
  })
})

describe('route: từng km từ GPS trong app', () => {
  // Chạy thẳng lên bắc, mỗi 3 s đi ~11,1 m (≈ 4:30/km), tổng ~2,5 km
  const pts: TrackPoint[] = Array.from({ length: 226 }, (_, i) => [21 + i * 0.0001, 105.85, i * 3, 10 + i * 0.1])
  it('chia km đủ + km lẻ cuối, pace đúng', () => {
    const s = splitsFromPoints(pts)
    expect(s).toHaveLength(3)
    expect(s[0].distance_m).toBe(1000)
    expect(s[0].moving_s).toBeGreaterThan(265)
    expect(s[0].moving_s).toBeLessThan(275)
    expect(s[2].distance_m).toBeGreaterThan(400)
    expect(s[0].elev_m).toBeGreaterThan(8)
  })
  it('bỏ thời gian đứng nghỉ (> 30 s giữa hai điểm)', () => {
    const paused = pts.map((p, i): TrackPoint => (i >= 50 ? [p[0], p[1], p[2] + 600, p[3]] : p))
    expect(splitsFromPoints(paused)[0].moving_s).toBeLessThan(280)
  })
  it('km nhanh nhất bỏ qua km lẻ ngắn', () => {
    expect(fastestSplit([{ distance_m: 1000, moving_s: 300, elev_m: null, hr: null }, { distance_m: 1000, moving_s: 290, elev_m: null, hr: null },
      { distance_m: 200, moving_s: 40, elev_m: null, hr: null }])).toBe(1)
  })
})

describe('route: vẽ & so sánh', () => {
  it('chiếu tuyến vào khung, giữ tỉ lệ và căn giữa', () => {
    const p = fitRoute([[21, 105], [21.01, 105]], 100, 100, 10)
    expect(p[0][0]).toBeCloseTo(50)
    expect(p[0][1]).toBeCloseTo(90)
    expect(p[1][1]).toBeCloseTo(10)
    expect(fitRoute([[21, 105]], 10, 10)).toEqual([])
  })
  it('rút gọn điểm giữ điểm cuối', () => {
    const t = thin(Array.from({ length: 1000 }, (_, i) => i), 100)
    expect(t).toHaveLength(101)
    expect(t.at(-1)).toBe(999)
  })
  it('câu so sánh chỉ hiện khi đủ ≥ 3 bài trước', () => {
    expect(compareNotes({ runs: 2, avg_distance_m: 5000, avg_pace_s: 360, longest_30d: true }, 10000, 330)).toEqual([])
    expect(compareNotes({ runs: 10, avg_distance_m: 5000, avg_pace_s: 360, longest_30d: true }, 10000, 330))
      .toEqual(['Bài dài nhất 30 ngày qua', 'Dài hơn 5 km so với thường lệ', 'Nhanh hơn 30 giây/km so với thường lệ'])
  })
})

describe('từng km qua đoạn mất tín hiệu', () => {
  it('một đoạn thẳng 3,15 km trong 1100 giây (tuyến chỉ có 2 điểm): đủ 3 km + phần lẻ, pace hợp lý', async () => {
    const { splitsFromPoints, splitPace } = await import('./route')
    const lat = (m: number) => 21 + m / 111_195
    const s = splitsFromPoints([[21, 105.85, 0, 10], [lat(3150), 105.85, 1100, 10]])
    expect(s.map((x) => x.distance_m)).toEqual([1000, 1000, 1000, 150])
    // đoạn dài hơn 30 giây: chỉ tính phần di chuyển ước lượng (≥ 1,5 m/s) → không ra pace 0:06
    for (const x of s.slice(0, 3)) expect(splitPace(x)).toBeGreaterThan(300)
  })
})
