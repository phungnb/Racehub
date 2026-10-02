import { describe, it, expect } from 'vitest'
import { analyzeRun, longestRun, stravaStreams, windowSpeeds, type FraudStreams } from './fraud'

// Dựng bài chạy giả: mỗi giây một điểm, tốc độ theo từng đoạn [giây, m/s]
function build(segments: [number, number][], opts: { hr?: (t: number, mps: number) => number; cad?: (mps: number) => number } = {}): FraudStreams {
  const time: number[] = [0], distance: number[] = [0], latlng: [number, number][] = [[21.0, 105.8]]
  const hr: number[] = [opts.hr ? opts.hr(0, 0) : 0], cadence: number[] = [opts.cad ? opts.cad(0) : 0]
  let t = 0, d = 0
  for (const [dur, mps] of segments) {
    for (let k = 0; k < dur; k++) {
      t += 1; d += mps
      time.push(t); distance.push(d); latlng.push([21.0 + d / 111_000, 105.8])
      hr.push(opts.hr ? opts.hr(t, mps) : 0); cadence.push(opts.cad ? opts.cad(mps) : 0)
    }
  }
  return { time, distance, latlng, heartrate: opts.hr ? hr : null, cadence: opts.cad ? cadence : null }
}
const sum = (s: FraudStreams) => ({ distanceM: s.distance.at(-1)!, movingS: s.time.at(-1)! })
const codes = (r: ReturnType<typeof analyzeRun>) => r.flags.map((f) => f.code)

describe('phát hiện gian lận bài chạy', () => {
  it('bài chạy thật 10 km pace 5:00 (có tim, cadence) → hợp lệ', () => {
    const s = build([[3000, 3.33]], { hr: (t) => 140 + (t % 7), cad: () => 85 })
    const r = analyzeRun(sum(s), s)
    expect(r).toMatchObject({ verdict: 'OK', level: 'LOW' })
    expect(r.flags).toEqual([])
  })

  it('chạy biến tốc: nước rút 60 s pace 3:00 vẫn hợp lệ', () => {
    const s = build([[600, 3.2], [60, 5.6], [120, 2.5], [60, 5.6], [600, 3.2]])
    expect(analyzeRun(sum(s), s).verdict).toBe('OK')
  })

  it('giữ ≥ 20 km/h trong 3 phút → chờ duyệt (SEVERE)', () => {
    const s = build([[600, 3], [180, 6], [600, 3]])
    const r = analyzeRun(sum(s), s)
    expect(r.verdict).toBe('REVIEW')
    expect(r.flags[0]).toMatchObject({ code: 'SUSTAINED_SPEED', severity: 'SEVERE' })
    expect(r.reason).toContain('liên tục')
  })

  it('đoạn đi xe máy 35 km/h → VEHICLE_BURST', () => {
    const s = build([[900, 3], [90, 9.7], [900, 3]])
    const r = analyzeRun(sum(s), s)
    expect(codes(r)).toContain('VEHICLE_BURST')
    expect(r.verdict).toBe('REVIEW')
  })

  it('sải chân > 2,1 m (cadence thấp mà vẫn nhanh) → STRIDE', () => {
    const s = build([[1200, 4.4]], { cad: () => 60 })      // 120 bước/phút, 4,4 m/s → 2,2 m/bước
    const r = analyzeRun(sum(s), s)
    expect(r.flags.find((f) => f.code === 'STRIDE')).toMatchObject({ severity: 'SEVERE' })
  })

  it('pace 3:50 nhưng tim chỉ ~100 bpm suốt 10 phút → HR_PACE; 10 phút đầu tim chưa lên thì bỏ qua', () => {
    const s = build([[1500, 4.35]], { hr: (t) => (t < 600 ? 80 : 100) + (t % 5) })
    const r = analyzeRun(sum(s), s)
    expect(r.flags.find((f) => f.code === 'HR_PACE')).toMatchObject({ severity: 'SEVERE' })
    // Chỉ 10 phút đầu tim thấp (khởi động) → không báo
    const ok = build([[1500, 4.35]], { hr: (t) => (t < 600 ? 90 : 165) + (t % 5) })
    expect(codes(analyzeRun(sum(ok), ok))).not.toContain('HR_PACE')
  })

  it('cảm biến tim đứng im (dữ liệu treo) không bị coi là bằng chứng', () => {
    const s = build([[1500, 4.35]], { hr: () => 90 })
    expect(codes(analyzeRun(sum(s), s))).not.toContain('HR_PACE')
  })

  it('bài nhập tay / chạy máy → chờ duyệt dù không có streams', () => {
    expect(analyzeRun({ manual: true, distanceM: 5000, movingS: 1500 }, null).verdict).toBe('REVIEW')
    expect(analyzeRun({ trainer: true, distanceM: 5000, movingS: 1500 }, null).flags[0].code).toBe('TREADMILL')
  })

  it('nhanh bất thường so với lịch sử chỉ là tham khảo (một mình không chặn)', () => {
    const history = Array.from({ length: 12 }, (_, i) => 360 + (i % 3) * 10)
    const r = analyzeRun({ distanceM: 10000, movingS: 2700 }, null, history)   // 4:30 so với ~6:10
    expect(codes(r)).toEqual(['HISTORY'])
    expect(r.verdict).toBe('OK')
  })

  it('vị trí nhảy xa + nhanh bất thường so với lịch sử → đủ 2 bằng chứng → chờ duyệt', () => {
    const s = build([[1500, 3.5]])
    for (const i of [300, 700, 1100]) s.latlng![i] = [21.01, 105.81]
    const history = Array.from({ length: 12 }, (_, i) => 420 + (i % 3) * 5)
    const r = analyzeRun(sum(s), s, history)
    expect(codes(r)).toEqual(expect.arrayContaining(['GPS_TELEPORT', 'HISTORY']))
    expect(r.verdict).toBe('REVIEW')
  })

  it('hàm phụ: tốc độ cửa sổ, đoạn dài nhất, đọc streams Strava', () => {
    const v = windowSpeeds([0, 10, 20, 30, 40], [0, 30, 60, 90, 120], 20)
    expect(v[4]).toBeCloseTo(3)
    expect(longestRun([0, 1, 2, 3, 4], [1, 5, 5, 5, 1], 4)).toEqual([2, 1])
    expect(stravaStreams({ time: { data: [0, 1] }, distance: { data: [0, 3] }, heartrate: { data: [100] } }))
      .toEqual({ time: [0, 1], distance: [0, 3], latlng: null, heartrate: null, cadence: null })
    expect(stravaStreams({ time: { data: [0] } })).toBeNull()
  })
})

import { speedRulesFrom } from './fraud'

describe('ngưỡng do admin đặt (Chính sách vận hành)', () => {
  it('mặc định = luật cũ; siết ngưỡng giữ tốc độ thì bài 14,4 km/h bị cờ', () => {
    const t = Array.from({ length: 1201 }, (_, i) => i)
    const s = { time: t, distance: t.map((x) => x * 4) }
    const summary = { distanceM: 4800, movingS: 1200 }
    expect(analyzeRun(summary, s).verdict).toBe('OK')
    const strict = speedRulesFrom({ highKmh: 13, highS: 120, severeKmh: 20, severeS: 120, vehicleKmh: 25, vehicleS: 30, spikeKmh: 43, spikeMax: 3 })
    expect(analyzeRun(summary, s, [], strict).flags.map((f) => f.code)).toContain('SUSTAINED_SPEED')
  })
})

import { bestWindowSpeed, despike } from './fraud'

describe('cú nhảy GPS và đường cong pace theo thời gian', () => {
  it('bài 7,5 km pace 4:47 có 1 điểm GPS nhảy 73 km/h → vẫn hợp lệ (như ảnh báo nhầm)', () => {
    const s = build([[1000, 3.48], [2, 20.3], [1140, 3.48]])        // 2 giây "nhảy" ~40 m (73 km/h)
    const r = analyzeRun({ ...sum(s), maxSpeedMps: 20.3 }, s)
    expect(r.verdict).toBe('OK')
    expect(codes(r)).not.toContain('VEHICLE_BURST')
    expect(codes(r)).not.toContain('PACE_CURVE')
  })

  it('đi xe 50 km/h liên tục 2 phút KHÔNG bị coi là cú nhảy GPS → chờ duyệt', () => {
    const s = build([[900, 3], [120, 13.9], [900, 3]])
    const r = analyzeRun(sum(s), s)
    expect(codes(r)).toEqual(expect.arrayContaining(['VEHICLE_BURST', 'PACE_CURVE']))
    expect(r.verdict).toBe('REVIEW')
  })

  it('5 phút pace 2:11/km (nhanh hơn kỷ lục 1500 m) → PACE_CURVE (SEVERE)', () => {
    const s = build([[600, 3], [300, 7.6], [600, 3]])
    const r = analyzeRun(sum(s), s)
    expect(r.flags.find((f) => f.code === 'PACE_CURVE')).toMatchObject({ severity: 'SEVERE', durationS: 300 })
    expect(r.reason).toContain('kỷ lục thế giới')
  })

  it('chạy nhanh nhưng trong khả năng con người (800 m trong 2:00) → không dính PACE_CURVE', () => {
    const s = build([[900, 3], [120, 6.67], [900, 3]])
    expect(codes(analyzeRun(sum(s), s))).not.toContain('PACE_CURVE')
  })

  it('không có streams: vận tốc tối đa một điểm chỉ là ghi chú, không tự chặn bài', () => {
    const r = analyzeRun({ distanceM: 7460, movingS: 2140, maxSpeedMps: 20.3 }, null)
    expect(r.verdict).toBe('OK')
    expect(r.flags[0]).toMatchObject({ code: 'VEHICLE_BURST', severity: 'INFO' })
  })

  it('hàm phụ: bỏ cú nhảy ngắn, giữ đoạn nhanh kéo dài; tốc độ cửa sổ tốt nhất', () => {
    const t = [0, 1, 2, 3, 4, 5]
    expect(despike(t, [0, 3, 6, 56, 59, 62], 12)).toEqual([0, 3, 6, 6, 9, 12])       // nhảy 50 m trong 1 s → bỏ
    const long = Array.from({ length: 31 }, (_, i) => i)
    const car = long.map((i) => i * 14)                                                 // 14 m/s suốt 30 s → giữ
    expect(despike(long, car, 12).at(-1)).toBe(420)
    expect(bestWindowSpeed([0, 10, 20, 30], [0, 30, 130, 160], 10).mps).toBeCloseTo(10)
  })
})
