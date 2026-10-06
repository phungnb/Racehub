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

  // Lần 7 (đổi có chủ đích): nhập tay → không ghi nhận (REJECT); chạy máy → ghi nhận kèm cảnh báo (trước đây cả hai chờ duyệt)
  it('bài nhập tay → không ghi nhận; chạy máy → ghi nhận kèm cảnh báo (không cần streams)', () => {
    expect(analyzeRun({ manual: true, distanceM: 5000, movingS: 1500 }, null)).toMatchObject({ verdict: 'REJECT', reason: 'Bài nhập tay không được ghi nhận' })
    const tm = analyzeRun({ trainer: true, distanceM: 5000, movingS: 1500 }, null)
    expect(tm.flags[0]).toMatchObject({ code: 'TREADMILL', tier: 'WARN' })
    expect(tm.verdict).toBe('OK')
  })

  it('nhanh bất thường so với lịch sử chỉ là tham khảo (một mình không chặn)', () => {
    const history = Array.from({ length: 12 }, (_, i) => 360 + (i % 3) * 10)
    const r = analyzeRun({ distanceM: 10000, movingS: 2700 }, null, history)   // 4:30 so với ~6:10
    expect(codes(r)).toEqual(['HISTORY'])
    expect(r.verdict).toBe('OK')
  })

  // Lần 7 (đổi có chủ đích): GPS nhảy không còn được tính là một bằng chứng để cộng với cảnh báo khác (trước đây → REVIEW)
  it('vị trí nhảy xa + nhanh bất thường so với lịch sử → GPS nhảy không tính là bằng chứng giữ bài → ghi nhận', () => {
    const s = build([[1500, 3.5]])
    for (const i of [300, 700, 1100]) s.latlng![i] = [21.01, 105.81]
    const history = Array.from({ length: 12 }, (_, i) => 420 + (i % 3) * 5)
    const r = analyzeRun(sum(s), s, history)
    expect(codes(r)).toEqual(expect.arrayContaining(['GPS_TELEPORT', 'HISTORY']))
    expect(r.verdict).toBe('OK')
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

import { FRAUD_ENGINE_VERSION, FRAUD_RULES, gpsErrorRegions, isGpsJumpFlag } from './fraud'

describe('cú nhảy GPS: không sửa km đối tác, chỉ phân loại', () => {
  const jump = (s: FraudStreams, at: number, m: number, back = 0) => {
    for (let i = at; i < s.distance.length; i++) s.distance[i] += m
    if (back) for (let i = at + back; i < s.distance.length; i++) s.distance[i] += m
    return s
  }
  it('nhiều lần GPS lạc 150 m rồi quay về → bình thường: chỉ ghi chú, bài hợp lệ', () => {
    const s = build([[2400, 3.0]])
    for (const at of [300, 900, 1500, 2100]) jump(s, at, 150, 2)
    const r = analyzeRun(sum(s), s)
    expect(r.verdict).toBe('OK')
    expect(r.flags.find((f) => f.code === 'GPS_DISTANCE_GAIN')).toMatchObject({ tier: 'NOTE' })
  })
  it('một lần vị trí dịch chuyển 2 km trong 1 giây rồi chạy tiếp → chỉ cảnh báo, bài có GPS vẫn ghi nhận; km gốc không đổi', () => {
    const s = jump(build([[2400, 3.0]]), 1200, 2000)
    const r = analyzeRun(sum(s), s)
    expect(r.verdict).toBe('OK')
    expect(r.flags.find((f) => f.code === 'GPS_DISTANCE_GAIN')).toMatchObject({ tier: 'WARN' })
    expect(r.flags.find((f) => f.code === 'GPS_DISTANCE_GAIN')!.evidence!.maxJumpM).toBeGreaterThanOrEqual(2000)
    expect(s.distance.at(-1)).toBeCloseTo(9200)
  })
})

describe('mức kết luận và độc lập của bằng chứng', () => {
  it('mỗi kết quả có phiên bản luật, số nhóm bằng chứng độc lập, mức cao nhất; mỗi dấu hiệu có số đo', () => {
    const s = build([[600, 3], [300, 7.6], [600, 3]])
    const r = analyzeRun(sum(s), s)
    expect(r.engine).toMatch(/^ac-/)
    expect(r.basis).toBe('DISQUALIFY')
    const curve = r.flags.find((f) => f.code === 'PACE_CURVE')!
    expect(curve).toMatchObject({ tier: 'DISQUALIFY', source: 'GPS' })
    expect(curve.evidence).toMatchObject({ windowS: 300 })
  })

  it('giữ 17 km/h 3 phút là CẢNH BÁO, một mình không giữ bài; 20 km/h 2 phút là NGHI VẤN', () => {
    const a = build([[600, 3], [240, 4.9], [600, 3]])
    const ra = analyzeRun(sum(a), a)
    expect(ra.flags.find((f) => f.code === 'SUSTAINED_SPEED')?.tier).toBe('WARN')
    expect(ra.verdict).toBe('OK')
    const b = build([[600, 3], [150, 5.8], [600, 3]])
    expect(analyzeRun(sum(b), b)).toMatchObject({ verdict: 'REVIEW', basis: 'SUSPECT' })
  })

  it('tốc độ cao TRÙNG lúc GPS nhảy → coi là cùng một lỗi GPS, hạ mức, không cộng thành 2 bằng chứng', () => {
    const s = build([[600, 3], [240, 4.9], [600, 3]])
    for (const i of [610, 650, 700]) s.latlng![i] = [21.02, 105.82]      // 3 lần nhảy ngay trong đoạn nhanh
    const r = analyzeRun(sum(s), s)
    const sus = r.flags.find((f) => f.code === 'SUSTAINED_SPEED')!
    expect(sus).toMatchObject({ gpsError: true, tier: 'NOTE' })
    expect(r.independent).toBe(1)
    expect(r.verdict).toBe('OK')
  })

  it('hai cảnh báo ở hai thời điểm khác nhau, hai nguồn khác nhau → độc lập → chờ duyệt', () => {
    // Phút 10–14: giữ 17,6 km/h (cảnh báo tốc độ, GPS) · phút 24–29: pace 4:38 mà tim chỉ ~95 (cảnh báo tim, cảm biến tim)
    const s = build([[600, 3], [240, 4.9], [600, 3], [330, 3.6], [600, 3]],
      { hr: (t) => (t > 1440 && t <= 1770 ? 95 + (t % 3) : 150 + (t % 5)) })
    const r = analyzeRun(sum(s), s)
    expect(r.independent).toBeGreaterThanOrEqual(2)
    expect(r.verdict).toBe('REVIEW')
  })

  it('danh mục quy tắc đủ lý do + đầu vào cho mọi mã', () => {
    for (const r of Object.values(FRAUD_RULES)) {
      expect(r.reason.length).toBeGreaterThan(10)
      expect(r.inputs.length).toBeGreaterThan(5)
      expect(r.warn || r.suspect || r.disqualify).toBeTruthy()
    }
  })

  it('vùng lỗi GPS: nhảy điểm và khoảng mất dữ liệu dài', () => {
    const t = [0, 1, 2, 60, 61], raw = [0, 3, 6, 9, 12], clean = [0, 3, 6, 9, 12]
    expect(gpsErrorRegions(t, raw, clean, null, { sustained: { normal: { kmh: 17, s: 180 }, severe: { kmh: 20, s: 120 } }, vehicle: { kmh: 25, s: 30 }, teleport: { mps: 12, minCount: 3 } }))
      .toEqual([[2, 60]])
  })
})

describe('luật Strava lần 7 (Phụng chốt 06/10/2026): GPS nhảy vẫn ghi nhận, nhập tay không ghi nhận, chạy máy cảnh báo', () => {
  // Dịch chuyển m mét bắt đầu từ điểm i, trải trên `over` điểm (cả distance và latlng); back > 0: quay về sau `back` điểm
  const shift = (s: FraudStreams, i: number, m: number, over = 1, back = 0) => {
    const move = (from: number, sign: number) => {
      for (let k = from; k < s.time.length; k++) {
        const f = Math.min(1, (k - from + 1) / over)
        s.distance[k] += m * f
        s.latlng![k] = [s.latlng![k][0] + (sign * m * f) / 111_000, s.latlng![k][1]]
      }
    }
    move(i, 1)
    if (back) move(i + back, -1)
    return s
  }
  const history = Array.from({ length: 15 }, (_, i) => 330 + (i % 5) * 6)
  const gpsOnly = (r: ReturnType<typeof analyzeRun>) => r.flags.filter((f) => f.tier !== 'NOTE').every((f) => isGpsJumpFlag(f))

  it('nhiều kiểu GPS nhảy (nhảy tức thời, trôi trải nhiều điểm, nhiều cú) → ghi nhận ngay (OK), cảnh báo vẫn lưu, km của Strava không đổi', () => {
    const cases: [string, FraudStreams][] = [
      ['3 cú 1,2 km trong 1 giây', shift(shift(shift(build([[2400, 3]]), 500, 1200), 1200, 1200), 1900, 1200)],
      ['3 cú 300 m rồi quay về', shift(shift(shift(build([[2400, 3]]), 500, 300, 1, 2), 1200, 300, 1, 2), 1900, 300, 1, 2)],
      ['dịch chuyển 600 m trải 15 giây', shift(build([[2400, 3]]), 1200, 600, 15)],
      ['dịch chuyển 1 km trải 20 giây', shift(build([[2400, 3]]), 1200, 1000, 20)],
      ['trôi 300 m ra rồi về, mỗi chiều 15 giây', shift(build([[2400, 3]]), 1200, 300, 15, 15)],
      ['10 cú 200 m', [200, 400, 600, 800, 1000, 1200, 1400, 1600, 1800, 2000].reduce((s, i) => shift(s, i, 200), build([[2400, 3]]))],
    ]
    for (const [name, s] of cases) {
      const km = s.distance.at(-1)!
      const r = analyzeRun({ ...sum(s), sportType: 'Run', hasGps: true }, s, history)
      expect(r.verdict, name).toBe('OK')
      expect(r.flags.some((f) => f.tier === 'WARN'), name).toBe(true)       // vẫn có cảnh báo cho ban quản trị
      expect(gpsOnly(r), name).toBe(true)
      expect(r.flags.every((f) => f.tier !== 'SUSPECT' && f.tier !== 'DISQUALIFY'), name).toBe(true)
      expect(s.distance.at(-1), name).toBe(km)
    }
    // Tốc độ "nhanh hơn kỷ lục" chỉ vì GPS trôi → đánh dấu GPS nhảy, chỉ là cảnh báo
    const drift = analyzeRun(sum(shift(build([[2400, 3]]), 1200, 1000, 20)), shift(build([[2400, 3]]), 1200, 1000, 20))
    expect(drift.flags.find((f) => f.code === 'PACE_CURVE')).toMatchObject({ gpsJump: true, tier: 'WARN' })
  })

  it('đi xe thật (đoạn nhanh kéo dài) vẫn chờ duyệt dù đầu đoạn có "cú nhảy" ngắn', () => {
    const s = build([[900, 3], [300, 13], [900, 3]])
    const r = analyzeRun(sum(s), s)
    expect(r.verdict).toBe('REVIEW')
    expect(r.flags.filter((f) => f.code === 'VEHICLE_BURST' || f.code === 'PACE_CURVE').every((f) => !f.gpsJump)).toBe(true)
  })

  it('dấu hiệu không do GPS nhảy giữ nguyên hành vi: tim thấp + tốc độ cao ở hai thời điểm vẫn chờ duyệt', () => {
    const s = build([[600, 3], [240, 4.9], [600, 3], [330, 3.6], [600, 3]],
      { hr: (t) => (t > 1440 && t <= 1770 ? 95 + (t % 3) : 150 + (t % 5)) })
    const r = analyzeRun({ ...sum(s), hasGps: true }, s)
    expect(r.verdict).toBe('REVIEW')
    expect(r.reason).toBeTruthy()
  })

  it('bài nhập tay → không ghi nhận (REJECT) kể cả khi có streams', () => {
    const s = build([[1800, 3]])
    const r = analyzeRun({ ...sum(s), manual: true, hasGps: false }, s)
    expect(r).toMatchObject({ verdict: 'REJECT', basis: 'DISQUALIFY', reason: 'Bài nhập tay không được ghi nhận' })
    expect(codes(r)).toEqual(['MANUAL'])
  })

  it('chạy máy / hoàn toàn không có GPS → ghi nhận kèm cảnh báo TREADMILL, không chờ duyệt', () => {
    for (const summary of [
      { distanceM: 8000, movingS: 2700, sportType: 'VirtualRun' },
      { distanceM: 8000, movingS: 2700, trainer: true, deviceName: 'Treadmill' },
      { distanceM: 8000, movingS: 2700, sportType: 'Run', hasGps: false },
    ]) {
      const r = analyzeRun(summary, null)
      expect(r.verdict).toBe('OK')
      expect(r.flags.find((f) => f.code === 'TREADMILL')).toMatchObject({ tier: 'WARN', source: 'DEVICE' })
    }
    // Chạy máy + một cảnh báo khác (khác thường ngày) vẫn không đủ 2 cảnh báo để giữ bài
    const history = Array.from({ length: 12 }, (_, i) => 360 + (i % 3) * 10)
    expect(analyzeRun({ distanceM: 10000, movingS: 2700, trainer: true }, null, history).verdict).toBe('OK')
  })

  it('phiên bản luật và danh mục quy tắc cập nhật theo lần 7', () => {
    expect(FRAUD_ENGINE_VERSION).toBe('ac-2026.10.7')
    expect(FRAUD_RULES.MANUAL.disqualify).toBeTruthy()
    expect(FRAUD_RULES.MANUAL.suspect).toBeNull()
    expect(FRAUD_RULES.TREADMILL.warn).toBeTruthy()
    expect(FRAUD_RULES.TREADMILL.suspect).toBeNull()
  })
})
