import { describe, it, expect } from 'vitest'
import { evaluatePoint, haversineM, isStationary, nextSplit, rollingPace, segmentMovingS, smoothPoint, splitAnnouncement, type TrackPoint } from './tracker'

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
    // đứng yên quá 10 giây → không hiện pace cũ
    expect(rollingPace(pts, 30, Date.parse(pts[9].recorded_at) + 15_000)).toBe(0)
  })
  it('thời gian di chuyển: đoạn ngắn tính đủ, đoạn có đứng chờ chỉ tính phần di chuyển', () => {
    expect(segmentMovingS(4, 12, 3)).toBe(4)
    expect(segmentMovingS(60, 30, 3)).toBe(10)            // đứng 50 s rồi chạy 30 m
    expect(segmentMovingS(20, 0, 3)).toBe(0)
  })
  it('pace trung bình khớp thực tế: chạy 5:00/km, dừng đèn đỏ 60 giây giữa chừng', () => {
    let anchor: TrackPoint | null = null
    let dist = 0, moving = 0, speed = 3.33
    const raw: TrackPoint[] = []
    for (let t = 0; t <= 420; t++) {
      const m = t < 180 ? t * 3.333 : t < 240 ? 600 : 600 + (t - 240) * 3.333   // 180 s chạy, 60 s đứng, 180 s chạy
      raw.push(pt(21 + dLat(m), t, 6))
      if (isStationary(raw)) continue
      const p = smoothPoint(raw)!
      const v = evaluatePoint(anchor, p)
      if (!v.accept) continue
      if (anchor) {
        const dt = (Date.parse(p.recorded_at) - Date.parse(anchor.recorded_at)) / 1000
        moving += segmentMovingS(dt, v.distance, speed)
        if (dt <= 15) speed = 0.7 * speed + 0.3 * v.speed
      }
      anchor = p
      dist += v.distance
    }
    const pace = moving / (dist / 1000)
    expect(pace).toBeGreaterThan(290)
    expect(pace).toBeLessThan(310)
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

// ---------------------------------------------------------------------------------------------
// Bộ máy GPS v2: mô phỏng chạy thật (vòng sân 400 m, đường phố có góc cua), nhiễu GPS, đứng chờ, mất tín hiệu
// ---------------------------------------------------------------------------------------------
import { TrackEngine } from './tracker'

function noise(seed: number) {
  let s = seed
  const u = () => ((s = (s * 16807) % 2147483647) / 2147483647)
  return () => { const a = Math.max(u(), 1e-9), b = u(); return Math.sqrt(-2 * Math.log(a)) * Math.cos(2 * Math.PI * b) }
}
/** Chạy theo đường (danh sách toạ độ mét), tốc độ v m/s, GPS mỗi giây, nhiễu sigma m, trôi chậm (multipath) */
function simulate(path: [number, number][], v: number, sigma: number, acc: number, opts: { stopAt?: number; stopS?: number; stopT?: number; gapAt?: number; gapS?: number; harsh?: boolean; noSpeed?: boolean } = {}) {
  const g = noise(11)
  const eng = new TrackEngine()
  const seg: number[] = [0]
  for (let i = 1; i < path.length; i++) seg.push(seg[i - 1] + Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]))
  const total = seg[seg.length - 1]
  const at = (s: number): [number, number] => {
    let i = 1
    while (i < seg.length - 1 && seg[i] < s) i++
    const f = (s - seg[i - 1]) / (seg[i] - seg[i - 1] || 1)
    return [path[i - 1][0] + f * (path[i][0] - path[i - 1][0]), path[i - 1][1] + f * (path[i][1] - path[i - 1][1])]
  }
  let s = 0, t = 0, dist = 0, moving = 0, driftX = 0, driftY = 0
  const pts = []
  while (s < total) {
    t++
    const stopping = opts.stopAt !== undefined && s >= opts.stopAt && t < (opts.stopT ??= t) + (opts.stopS ?? 0)
    if (!stopping) s = Math.min(total, s + v)
    const devSpeed = opts.noSpeed ? null : Math.max(0, (stopping ? 0 : v) + g() * 0.2)
    if (opts.gapAt !== undefined && s >= opts.gapAt && s < opts.gapAt + v * (opts.gapS ?? 0)) continue
    // Sai số GPS điện thoại: phần trôi chậm (tương quan ~50 giây) + rung nhỏ; 'harsh' = phố cao tầng (trôi nhanh, rung lớn)
    const k = opts.harsh ? 0.9 : 0.98, inn = sigma * 0.7 * Math.sqrt(1 - k * k)
    driftX = k * driftX + g() * inn; driftY = k * driftY + g() * inn
    const [x, y] = at(s)
    const w = opts.harsh ? 0.5 : 0.3
    const lat = 21 + (y + driftY + g() * sigma * w) / 111320
    const lng = 105.85 + (x + driftX + g() * sigma * w) / (111320 * Math.cos((21 * Math.PI) / 180))
    const r = eng.push({ latitude: lat, longitude: lng, accuracy: acc, altitude: 0, speed: devSpeed, recorded_at: new Date(t * 1000).toISOString() })
    dist += r.distance; moving += r.moving
    if (r.point) pts.push(r.point)
  }
  return { dist, moving, total, t, gaps: eng.gaps, pts }
}
const track400 = (): [number, number][] => {
  // vòng sân 400 m: 2 cạnh thẳng 84,4 m + 2 bán nguyệt bán kính 36,8 m
  const out: [number, number][] = []
  const R = 36.8, L = 84.39
  for (let i = 0; i <= 20; i++) out.push([(i / 20) * L, 0])
  for (let i = 1; i <= 30; i++) { const a = -Math.PI / 2 + (i / 30) * Math.PI; out.push([L + R * Math.cos(a), R + R * Math.sin(a)]) }
  for (let i = 1; i <= 20; i++) out.push([L - (i / 20) * L, 2 * R])
  for (let i = 1; i <= 30; i++) { const a = Math.PI / 2 + (i / 30) * Math.PI; out.push([R * Math.cos(a), R + R * Math.sin(a)]) }
  return out
}
const laps = (n: number) => Array.from({ length: n }, () => track400()).flat() as [number, number][]
const street = (): [number, number][] => [[0, 0], [600, 0], [600, 400], [1100, 400], [1100, 1300], [300, 1300], [300, 2000]]

describe('bộ máy GPS v2 (Kalman + mất tín hiệu)', () => {
  it('chạy 5 vòng sân 400 m, GPS tốt (±4 m): sai lệch < 2%', () => {
    const r = simulate(laps(5), 3.2, 4, 6)
    expect(Math.abs(r.dist - r.total) / r.total).toBeLessThan(0.02)
    expect(Math.abs(r.moving - r.total / 3.2) / (r.total / 3.2)).toBeLessThan(0.05)
  })
  it('đường phố có góc cua, GPS trung bình (±10 m) và kém (±15 m), phố cao tầng: sai lệch < 2%', () => {
    for (const [sig, acc, harsh] of [[10, 12, false], [15, 18, false], [10, 15, true]] as const) {
      const r = simulate(street(), 3, sig, acc, { harsh })
      expect(Math.abs(r.dist - r.total) / r.total).toBeLessThan(0.02)
    }
  })
  it('đi bộ chậm 1,6 m/s: vẫn đủ quãng đường (không bị coi là đứng yên)', () => {
    const r = simulate(street(), 1.6, 8, 10)
    expect(Math.abs(r.dist - r.total) / r.total).toBeLessThan(0.03)
  })
  it('máy không báo vận tốc (một số trình duyệt): vẫn trong 5% khi GPS ±10 m', () => {
    const r = simulate(street(), 3, 10, 12, { noSpeed: true })
    expect(Math.abs(r.dist - r.total) / r.total).toBeLessThan(0.05)
  })
  it('đứng chờ đèn đỏ 90 giây: không cộng thêm quãng đường, không tính giờ di chuyển', () => {
    const base = simulate(street(), 3, 6, 8)
    const r = simulate(street(), 3, 6, 8, { stopAt: 1000, stopS: 90 })
    expect(Math.abs(r.dist - base.dist)).toBeLessThan(30)
    expect(r.moving - base.moving).toBeLessThan(15)
  })
  it('mất tín hiệu 2 phút trên đường thẳng: được ghi lại, đoạn nối hợp lý nên vẫn tính', () => {
    const r = simulate([[0, 0], [4000, 0]], 3, 5, 6, { gapAt: 1500, gapS: 120 })
    expect(r.gaps).toHaveLength(1)
    expect(r.gaps[0]).toMatchObject({ counted: true })
    expect(r.gaps[0].seconds).toBeGreaterThanOrEqual(120)
    expect(Math.abs(r.dist - 4000) / 4000).toBeLessThan(0.04)
  })
  it('điểm sai số > 35 m bị bỏ; điểm đầu tiên không cộng quãng đường', () => {
    const e = new TrackEngine()
    const first = e.push({ latitude: 21, longitude: 105.85, accuracy: 8, altitude: 0, speed: null, recorded_at: new Date(1000).toISOString() })
    expect(first).toMatchObject({ distance: 0, reason: 'FIRST' })
    expect(e.push({ latitude: 21.001, longitude: 105.85, accuracy: 60, altitude: 0, speed: null, recorded_at: new Date(2000).toISOString() }).reason).toBe('INACCURATE')
  })
})

import { compactPoint, gpsReady } from './tracker'

describe('GPS sẵn sàng + làm gọn điểm', () => {
  it('chờ 3 điểm tốt liên tiếp hoặc 1 điểm rất tốt; điểm cũ không tính', () => {
    const now = 100_000
    expect(gpsReady([{ accuracy: 15, time: now - 2000 }], now)).toBe(false)
    expect(gpsReady([{ accuracy: 15, time: now - 3000 }, { accuracy: 18, time: now - 2000 }, { accuracy: 12, time: now - 1000 }], now)).toBe(true)
    expect(gpsReady([{ accuracy: 15, time: now - 3000 }, { accuracy: 40, time: now - 2000 }, { accuracy: 12, time: now - 1000 }], now)).toBe(false)
    expect(gpsReady([{ accuracy: 8, time: now - 500 }], now)).toBe(true)
    expect(gpsReady([{ accuracy: 8, time: now - 60_000 }], now)).toBe(false)
  })
  it('làm tròn toạ độ 1 cm, giữ quãng đường tích luỹ', () => {
    const p = compactPoint({ latitude: 21.012345678912, longitude: 105.851234567891, accuracy: 7.345, altitude: 12.3456, speed: 3.14159, recorded_at: 'x', distance_m: 1234.5678 })
    expect(p).toEqual({ latitude: 21.0123457, longitude: 105.8512346, accuracy: 7.3, altitude: 12.3, speed: 3.14, recorded_at: 'x', distance_m: 1234.6 })
    expect(JSON.stringify(p).length).toBeLessThan(140)
  })
})
