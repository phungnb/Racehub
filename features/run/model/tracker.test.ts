import { describe, it, expect } from 'vitest'
import { evaluatePoint, haversineM, nextSplit, rollingPace, splitAnnouncement, type TrackPoint } from './tracker'

const pt = (lat: number, t: number, accuracy = 5): TrackPoint =>
  ({ latitude: lat, longitude: 105.85, accuracy, altitude: 0, speed: 0, recorded_at: new Date(t * 1000).toISOString() })
const dLat = (m: number) => m / 111320

describe('bộ lọc điểm GPS', () => {
  it('nhận điểm chạy bình thường (3 m/s)', () => {
    const r = evaluatePoint(pt(21, 0), pt(21 + dLat(30), 10))
    expect(r.accept).toBe(true)
    if (r.accept) { expect(r.distance).toBeCloseTo(30, 0); expect(r.speed).toBeCloseTo(3, 1) }
  })
  it('loại điểm sai số lớn, rung khi đứng yên, nhảy điểm, trùng thời gian', () => {
    expect(evaluatePoint(pt(21, 0), pt(21 + dLat(30), 10, 80))).toEqual({ accept: false, reason: 'INACCURATE' })
    expect(evaluatePoint(pt(21, 0), pt(21 + dLat(1), 10))).toEqual({ accept: false, reason: 'JITTER' })
    expect(evaluatePoint(pt(21, 0), pt(21 + dLat(500), 10))).toEqual({ accept: false, reason: 'TELEPORT' })
    expect(evaluatePoint(pt(21, 10), pt(21 + dLat(30), 10))).toEqual({ accept: false, reason: 'NO_TIME' })
  })
})

describe('pace & split', () => {
  it('pace trung bình 30 giây gần nhất', () => {
    const pts = Array.from({ length: 10 }, (_, i) => pt(21 + dLat(i * 25), i * 5))   // 5 m/s
    expect(rollingPace(pts)).toBeCloseTo(200, -1)                                    // 3:20/km
    expect(rollingPace([pt(21, 0)])).toBe(0)
  })
  it('split mỗi km, không lặp lại', () => {
    const s1 = nextSplit(990, 1005, 330, [])
    expect(s1).toEqual({ km: 1, seconds: 330 })
    expect(nextSplit(1005, 1500, 480, [s1!])).toBeNull()
    expect(nextSplit(1990, 2002, 650, [s1!])).toEqual({ km: 2, seconds: 320 })
  })
  it('câu đọc giọng nói', () => {
    expect(splitAnnouncement({ km: 3, seconds: 325 }, 1000)).toBe('Hoàn thành 3 ki lô mét. Pace 5 phút 25 giây. Tổng thời gian 16 phút.')
  })
  it('haversine ~111 m cho 0,001 độ vĩ', () => {
    expect(haversineM(21, 105, 21.001, 105)).toBeCloseTo(111.2, 0)
  })
})
