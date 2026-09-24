import { describe, it, expect } from 'vitest'
import { evaluatePoint, haversineM, isStationary, nextSplit, rollingPace, smoothPoint, splitAnnouncement, type TrackPoint } from './tracker'

const pt = (lat: number, t: number, accuracy = 5, speed: number | null = null): TrackPoint =>
  ({ latitude: lat, longitude: 105.85, accuracy, altitude: 0, speed, recorded_at: new Date(t * 1000).toISOString() })
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
  it('ngồi yên với GPS sai số 15 m: rung 8–10 m không được cộng', () => {
    expect(evaluatePoint(pt(21, 0, 15), pt(21 + dLat(12), 3, 15))).toEqual({ accept: false, reason: 'JITTER' })
    // máy báo vận tốc 0 → điểm lệch 20 m vẫn coi là đứng yên
    expect(evaluatePoint(pt(21, 0, 15), pt(21 + dLat(25), 3, 15, 0))).toEqual({ accept: false, reason: 'STILL' })
    // máy báo đang chạy 3 m/s → nhận
    expect(evaluatePoint(pt(21, 0, 15), pt(21 + dLat(25), 8, 15, 3)).accept).toBe(true)
  })
  it('mô phỏng ngồi yên 5 phút: tổng quãng đường ≈ 0', () => {
    // GPS ngồi trong nhà: vị trí trôi chậm (±15 m) cộng rung ±4 m mỗi giây, sai số báo 12 m
    let seed = 7
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1
    let anchor: TrackPoint | null = null
    let total = 0
    let dx = 0, dy = 0
    const raw: TrackPoint[] = []
    for (let t = 0; t < 300; t++) {
      dx = Math.max(-15, Math.min(15, dx + rand() * 1.5))
      dy = Math.max(-15, Math.min(15, dy + rand() * 1.5))
      raw.push({ ...pt(21 + dLat(dy + rand() * 4), t, 12), longitude: 105.85 + dLat(dx + rand() * 4) })
      if (isStationary(raw)) continue
      const p = smoothPoint(raw)!
      const v = evaluatePoint(anchor, p)
      if (v.accept) { anchor = p; total += v.distance }
    }
    expect(total).toBeLessThan(30)
  })
  it('đi bộ chậm 1,2 m/s vẫn được tính (không bị coi là đứng yên)', () => {
    const raw = Array.from({ length: 20 }, (_, t) => pt(21 + dLat(t * 1.2), t, 8))
    expect(isStationary(raw)).toBe(false)
    expect(isStationary(Array.from({ length: 20 }, (_, t) => pt(21 + dLat((t % 3) * 2), t, 8)))).toBe(true)
  })
  it('chạy thật 3 m/s với GPS sai số 10 m: quãng đường sai lệch < 5%', () => {
    let anchor: TrackPoint | null = null
    let total = 0
    const raw: TrackPoint[] = []
    for (let t = 0; t <= 600; t++) {
      raw.push(pt(21 + dLat(t * 3 + (t % 2 ? 4 : -4)), t, 10))
      if (isStationary(raw)) continue
      const p = smoothPoint(raw)!
      const v = evaluatePoint(anchor, p)
      if (v.accept) { anchor = p; total += v.distance }
    }
    expect(Math.abs(total - 1800) / 1800).toBeLessThan(0.05)
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
