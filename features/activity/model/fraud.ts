// Phát hiện gian lận bài chạy (hàm thuần, không gọi mạng) — dùng cho bài đồng bộ từ Strava.
// Dựa trên bộ quy tắc RaceHub trước đây (Apps Script), sửa các điểm dễ báo nhầm:
//  - Tốc độ tính theo quãng đường trong cửa sổ trượt 30 s (không dùng từng điểm velocity_smooth, hay bị nhảy)
//  - Nhịp tim: bỏ 10 phút đầu (tim chưa lên), bỏ dữ liệu HR rơi/đứng im, phải kéo dài ≥ 3 phút
//  - Sải chân: phải kéo dài đủ thời gian (bản cũ khai báo minDurationSec nhưng không dùng)
//  - Thêm: điểm GPS "dịch chuyển tức thời", đoạn chạy ≥ 25 km/h kiểu xe máy / xe đạp
//  - Cú nhảy GPS ngắn (≤ 10 s) bị bỏ khỏi quãng đường trước khi tính tốc độ — một điểm nhảy 70 km/h không làm cả bài thành "đi xe"
//  - Đường cong pace theo thời gian: tốc độ TB tốt nhất trong mỗi cửa sổ 1 phút … 2 giờ so với kỷ lục thế giới cùng thời lượng
// Kết luận chỉ là OK hoặc REVIEW (chờ ban quản trị duyệt) — không tự động từ chối người thật.

export interface FraudStreams {
  time: number[]                         // giây từ lúc bắt đầu
  distance: number[]                     // mét, cộng dồn
  latlng?: [number, number][] | null
  heartrate?: number[] | null
  cadence?: number[] | null              // bước/phút của MỘT chân (kiểu Strava) — sẽ nhân đôi
}

export interface FraudSummary {
  sportType?: string | null
  manual?: boolean | null
  trainer?: boolean | null
  deviceName?: string | null
  distanceM: number
  movingS: number
  maxSpeedMps?: number | null
}

export interface FraudFlag {
  code: 'MANUAL' | 'TREADMILL' | 'SUSTAINED_SPEED' | 'VEHICLE_BURST' | 'GPS_TELEPORT' | 'STRIDE' | 'HR_PACE' | 'HISTORY' | 'PACE_CURVE'
  severity: 'SEVERE' | 'HIGH' | 'INFO'
  score: number                          // 0–100 cho riêng quy tắc
  message: string
  atS?: number                           // bắt đầu đoạn nghi vấn (giây)
  durationS?: number
}

export interface FraudResult {
  score: number                          // 0–100 tổng hợp
  level: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
  verdict: 'OK' | 'REVIEW'
  flags: FraudFlag[]
  reason: string | null                  // câu ngắn gửi lên máy chủ / hiện cho người chạy
}

export const FRAUD_CONFIG = {
  windowS: 30,
  sustained: { normal: { kmh: 17, s: 180 }, severe: { kmh: 20, s: 120 } },
  vehicle: { kmh: 25, s: 30 },
  teleport: { mps: 12, minCount: 3 },
  stride: { windowS: 90, minS: 90, suspiciousM: 1.8, severeM: 2.1, minSpm: 120, minMps: 2 },
  hr: {
    skipFirstS: 600, windowS: 90, minS: 180, minCoverage: 0.8,
    // pace (phút/km) nhanh hơn hoặc bằng → nhịp tim tối thiểu hợp lý
    table: [{ pace: 5.0, minHr: 115 }, { pace: 4.5, minHr: 125 }, { pace: 4.0, minHr: 135 }, { pace: 3.5, minHr: 145 }],
  },
  history: { minSamples: 10, z: 3, zCritical: 5 },
  // Cú nhảy GPS: chuỗi điểm liên tiếp nhanh hơn ngưỡng "nhảy" nhưng tổng thời gian ≤ maxS giây → bỏ quãng đó
  spike: { maxS: 10 },
  // Tốc độ TB tối đa con người giữ được theo thời lượng (≈ kỷ lục thế giới nam: 400 m, 800 m, 1500 m, 5 km, 10 km, bán marathon,
  // marathon) + 5% sai số GPS. Vượt mức này trong cả một cửa sổ dài = không thể là chạy bộ.
  curve: { tolerance: 1.05, points: [
    { s: 60, mps: 8.6 }, { s: 120, mps: 7.9 }, { s: 300, mps: 7.0 }, { s: 600, mps: 6.8 },
    { s: 1200, mps: 6.5 }, { s: 3600, mps: 6.1 }, { s: 7200, mps: 5.85 },
  ] },
  weights: { PACE_CURVE: 40, SUSTAINED_SPEED: 35, VEHICLE_BURST: 35, GPS_TELEPORT: 20, STRIDE: 30, HR_PACE: 25, HISTORY: 10 } as Record<string, number>,
  levels: { medium: 35, high: 65, critical: 85 },
}

/** Ngưỡng tốc độ dùng chung với máy chủ (ops_policy.antiCheat, 009100) — admin đổi được, không cần sửa code */
export interface SpeedRules {
  sustained: { normal: { kmh: number; s: number }; severe: { kmh: number; s: number } }
  vehicle: { kmh: number; s: number }
  teleport: { mps: number; minCount: number }
}
const DEFAULT_SPEED: SpeedRules = { sustained: FRAUD_CONFIG.sustained, vehicle: FRAUD_CONFIG.vehicle, teleport: FRAUD_CONFIG.teleport }

/** Ngưỡng chống gian lận của Chính sách vận hành → luật tốc độ phân tích bài Strava */
export function speedRulesFrom(ac: { highKmh: number; highS: number; severeKmh: number; severeS: number; vehicleKmh: number; vehicleS: number; spikeKmh: number; spikeMax: number } | null | undefined): SpeedRules {
  if (!ac) return DEFAULT_SPEED
  return {
    sustained: { normal: { kmh: ac.highKmh, s: ac.highS }, severe: { kmh: ac.severeKmh, s: ac.severeS } },
    vehicle: { kmh: ac.vehicleKmh, s: ac.vehicleS },
    teleport: { mps: ac.spikeKmh / 3.6, minCount: ac.spikeMax },
  }
}

const kmhToPace = (kmh: number) => {
  const s = Math.round(3600 / kmh)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
const mmss = (s: number) => (s >= 60 ? `${Math.floor(s / 60)} phút${s % 60 ? ` ${Math.round(s % 60)} giây` : ''}` : `${Math.round(s)} giây`)

function haversine(a: [number, number], b: [number, number]) {
  const R = 6371000, rad = Math.PI / 180
  const dLat = (b[0] - a[0]) * rad, dLon = (b[1] - a[1]) * rad
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(Math.min(1, Math.max(0, h))))
}

/** Tốc độ (m/s) tại mỗi điểm = quãng đường trong cửa sổ ~30 s kết thúc tại điểm đó. NaN nếu cửa sổ quá ngắn. */
export function windowSpeeds(time: number[], distance: number[], windowS = FRAUD_CONFIG.windowS): number[] {
  const out = new Array<number>(time.length).fill(NaN)
  let j = 0
  for (let i = 1; i < time.length; i++) {
    while (j < i && time[i] - time[j] > windowS) j++
    const dt = time[i] - time[j]
    if (dt >= windowS / 2) out[i] = Math.max(0, distance[i] - distance[j]) / dt
  }
  return out
}

/**
 * Quãng đường cộng dồn sau khi bỏ cú nhảy GPS: chuỗi điểm liên tiếp có tốc độ tức thời > `maxMps` mà tổng thời gian
 * ≤ `maxS` giây (điểm lạc rồi quay về). Đoạn nhanh kéo dài hơn (đi xe thật) được GIỮ NGUYÊN để các luật tốc độ bắt được.
 */
export function despike(time: number[], distance: number[], maxMps: number, maxS = FRAUD_CONFIG.spike.maxS): number[] {
  const n = Math.min(time.length, distance.length)
  const fast = new Array<boolean>(n).fill(false)
  for (let i = 1; i < n; i++) {
    const dt = time[i] - time[i - 1], dd = distance[i] - distance[i - 1]
    fast[i] = dd > 0 && (dt <= 0 || dd / dt > maxMps)
  }
  const drop = new Array<boolean>(n).fill(false)
  for (let i = 1; i < n; i++) {
    if (!fast[i] || fast[i - 1]) continue
    let j = i
    while (j + 1 < n && fast[j + 1]) j++
    if (time[j] - time[i - 1] <= maxS) for (let k = i; k <= j; k++) drop[k] = true
  }
  const out = new Array<number>(n)
  let acc = 0
  out[0] = distance[0] ?? 0
  for (let i = 1; i < n; i++) { if (!drop[i]) acc += Math.max(0, distance[i] - distance[i - 1]); out[i] = (distance[0] ?? 0) + acc }
  return out
}

/** Tốc độ TB tốt nhất (m/s) trên mọi cửa sổ dài ≥ `windowS` giây — "đường cong pace" của bài chạy */
export function bestWindowSpeed(time: number[], distance: number[], windowS: number): { mps: number; atS: number } {
  let best = 0, at = 0, j = 0
  for (let i = 0; i < time.length; i++) {
    if (j < i) j = i
    while (j < time.length && time[j] - time[i] < windowS) j++
    if (j >= time.length) break
    const v = (distance[j] - distance[i]) / (time[j] - time[i])
    if (v > best) { best = v; at = time[i] }
  }
  return { mps: best, atS: at }
}

/** Đoạn liên tục dài nhất có tốc độ ≥ ngưỡng: [thời lượng giây, giây bắt đầu] */
export function longestRun(time: number[], speed: number[], minMps: number): [number, number] {
  let best = 0, bestAt = 0, start = -1
  for (let i = 0; i <= speed.length; i++) {
    const ok = i < speed.length && speed[i] >= minMps
    if (ok && start < 0) start = i
    if (!ok && start >= 0) {
      const d = time[i - 1] - time[start]
      if (d > best) { best = d; bestAt = time[start] }
      start = -1
    }
  }
  return [best, bestAt]
}

function ruleSummary(s: FraudSummary): FraudFlag[] {
  const out: FraudFlag[] = []
  if (s.manual) out.push({ code: 'MANUAL', severity: 'SEVERE', score: 100, message: 'Bài nhập tay, không có dữ liệu thiết bị' })
  const dev = (s.deviceName ?? '').toLowerCase()
  if (s.trainer || s.sportType === 'VirtualRun' || /treadmill|zwift|virtual/.test(dev)) {
    out.push({ code: 'TREADMILL', severity: 'SEVERE', score: 80, message: 'Chạy máy / chạy ảo — không có tuyến GPS để đối chiếu' })
  }
  return out
}

function ruleSpeed(t: number[], v: number[], c: SpeedRules): FraudFlag[] {
  const out: FraudFlag[] = []
  const [sev, sevAt] = longestRun(t, v, c.sustained.severe.kmh / 3.6)
  const [nor, norAt] = longestRun(t, v, c.sustained.normal.kmh / 3.6)
  if (sev >= c.sustained.severe.s) {
    out.push({ code: 'SUSTAINED_SPEED', severity: 'SEVERE', score: 100, atS: sevAt, durationS: sev,
      message: `Giữ pace ${kmhToPace(c.sustained.severe.kmh)}/km hoặc nhanh hơn liên tục ${mmss(sev)}` })
  } else if (nor >= c.sustained.normal.s) {
    out.push({ code: 'SUSTAINED_SPEED', severity: 'HIGH', score: 80, atS: norAt, durationS: nor,
      message: `Giữ pace ${kmhToPace(c.sustained.normal.kmh)}/km hoặc nhanh hơn liên tục ${mmss(nor)}` })
  }
  const [veh, vehAt] = longestRun(t, v, c.vehicle.kmh / 3.6)
  if (veh >= c.vehicle.s) {
    out.push({ code: 'VEHICLE_BURST', severity: 'SEVERE', score: 100, atS: vehAt, durationS: veh,
      message: `Di chuyển ≥ ${c.vehicle.kmh} km/h trong ${mmss(veh)} — giống đi xe` })
  }
  return out
}

function ruleCurve(t: number[], d: number[]): FraudFlag[] {
  const c = FRAUD_CONFIG.curve
  const total = t[t.length - 1] - t[0]
  let worst: { ratio: number; s: number; mps: number; atS: number } | null = null
  for (const p of c.points) {
    if (total < p.s) break
    const b = bestWindowSpeed(t, d, p.s)
    const ratio = b.mps / (p.mps * c.tolerance)
    if (ratio > 1 && (!worst || ratio > worst.ratio)) worst = { ratio, s: p.s, mps: b.mps, atS: b.atS }
  }
  if (!worst) return []
  return [{ code: 'PACE_CURVE', severity: 'SEVERE', score: 100, atS: worst.atS, durationS: worst.s,
    message: `Pace TB ${kmhToPace(worst.mps * 3.6)}/km suốt ${mmss(worst.s)} — nhanh hơn kỷ lục thế giới cùng thời lượng` }]
}

function ruleTeleport(t: number[], ll: [number, number][] | null | undefined, c: SpeedRules): FraudFlag[] {
  if (!ll || ll.length < 2) return []
  let n = 0, first = -1
  for (let i = 1; i < Math.min(t.length, ll.length); i++) {
    const dt = t[i] - t[i - 1]
    if (dt <= 0 || !ll[i] || !ll[i - 1]) continue
    const d = haversine(ll[i - 1], ll[i])
    if (d > 50 && d / dt > c.teleport.mps) { n++; if (first < 0) first = t[i] }
  }
  return n >= c.teleport.minCount
    ? [{ code: 'GPS_TELEPORT', severity: 'HIGH', score: Math.min(100, 50 + n * 10), atS: first, message: `${n} lần vị trí nhảy xa bất thường (> ${Math.round(c.teleport.mps * 3.6)} km/h)` }]
    : []
}

/** Các cửa sổ trượt dài `windowS`; trả về chỉ số [đầu, cuối] */
function* windows(t: number[], windowS: number): Generator<[number, number]> {
  let j = 0
  for (let i = 0; i < t.length; i++) {
    while (j < t.length && t[j] - t[i] < windowS) j++
    if (j >= t.length) return
    yield [i, j]
  }
}

function ruleStride(t: number[], d: number[], cad: number[] | null | undefined): FraudFlag[] {
  const c = FRAUD_CONFIG.stride
  if (!cad || cad.length !== t.length || !cad.some((x) => x > 0)) return []
  // Sải chân (m) mỗi cửa sổ = quãng đường / số bước; bỏ cửa sổ đi bộ / đứng (ít bước hoặc chậm)
  const stride = new Array<number>(t.length).fill(NaN)
  for (const [a, b] of windows(t, c.windowS)) {
    const dt = t[b] - t[a]
    let steps = 0, cover = 0
    for (let k = a + 1; k <= b; k++) {
      const spm = (cad[k] ?? 0) * 2
      if (spm >= c.minSpm) { steps += (spm / 60) * (t[k] - t[k - 1]); cover += t[k] - t[k - 1] }
    }
    const mps = (d[b] - d[a]) / dt
    if (cover < dt * 0.8 || mps < c.minMps || steps <= 0) continue
    stride[a] = (d[b] - d[a]) / steps
  }
  const [sev, sevAt] = longestRun(t, stride, c.severeM)
  const [sus, susAt] = longestRun(t, stride, c.suspiciousM)
  if (sev >= c.minS) return [{ code: 'STRIDE', severity: 'SEVERE', score: 100, atS: sevAt, durationS: sev, message: `Sải chân > ${c.severeM} m liên tục ${mmss(sev)} — không phải bước chạy` }]
  if (sus >= c.minS) return [{ code: 'STRIDE', severity: 'HIGH', score: 90, atS: susAt, durationS: sus, message: `Sải chân > ${c.suspiciousM} m liên tục ${mmss(sus)}` }]
  return []
}

function ruleHr(t: number[], d: number[], hr: number[] | null | undefined): FraudFlag[] {
  const c = FRAUD_CONFIG.hr
  if (!hr || hr.length !== t.length) return []
  const flagged = new Array<number>(t.length).fill(NaN)
  let worst: { pace: number; hr: number; min: number } | null = null
  for (const [a, b] of windows(t, c.windowS)) {
    if (t[a] < c.skipFirstS) continue
    const vals = hr.slice(a, b + 1).filter((x) => x > 30 && x < 230)
    if (vals.length < (b - a + 1) * c.minCoverage) continue
    // HR đứng im tuyệt đối (cảm biến treo) → không dùng làm bằng chứng
    if (Math.max(...vals) - Math.min(...vals) < 1) continue
    const avgHr = vals.reduce((s, x) => s + x, 0) / vals.length
    const mps = (d[b] - d[a]) / (t[b] - t[a])
    if (mps <= 0) continue
    const pace = 1000 / mps / 60
    let min: number | null = null
    for (const r of c.table) if (pace <= r.pace) min = r.minHr
    if (min !== null && avgHr < min) {
      flagged[a] = 1
      if (!worst || pace < worst.pace) worst = { pace, hr: avgHr, min }
    }
  }
  const [dur, at] = longestRun(t, flagged, 1)
  if (dur < c.minS || !worst) return []
  const p = Math.round(worst.pace * 60)
  // ≥ 5 phút liên tục: gần như chắc chắn điện thoại/đồng hồ không đi cùng người đang chạy (xe, người khác cầm)
  return [{ code: 'HR_PACE', severity: dur >= 300 ? 'SEVERE' : 'HIGH', score: 90, atS: at, durationS: dur,
    message: `Pace ${Math.floor(p / 60)}:${String(p % 60).padStart(2, '0')}/km nhưng nhịp tim chỉ ${Math.round(worst.hr)} bpm (hợp lý ≥ ${worst.min}) trong ${mmss(dur)}` }]
}

/** So với lịch sử của chính người chạy: pace (giây/km) các bài gần đây */
function ruleHistory(s: FraudSummary, history: number[]): FraudFlag[] {
  const c = FRAUD_CONFIG.history
  const h = history.filter((x) => Number.isFinite(x) && x > 0)
  if (h.length < c.minSamples || s.distanceM <= 0) return []
  const cur = s.movingS / (s.distanceM / 1000)
  const mean = h.reduce((a, x) => a + x, 0) / h.length
  const sd = Math.sqrt(h.reduce((a, x) => a + (x - mean) ** 2, 0) / h.length)
  if (!(sd > 0)) return []
  const z = (mean - cur) / sd
  if (z < c.z) return []
  return [{ code: 'HISTORY', severity: z >= c.zCritical ? 'HIGH' : 'INFO', score: z >= c.zCritical ? 100 : 80,
    message: `Nhanh hơn thường ngày ${z.toFixed(1)} lần độ lệch chuẩn` }]
}

export function analyzeRun(summary: FraudSummary, streams: FraudStreams | null, history: number[] = [], rules: SpeedRules = DEFAULT_SPEED): FraudResult {
  const flags: FraudFlag[] = [...ruleSummary(summary)]
  if (streams && streams.time.length >= 2 && streams.distance.length === streams.time.length) {
    const { time: t } = streams
    // Bỏ cú nhảy GPS ngắn trước khi tính tốc độ (luật GPS_TELEPORT vẫn đếm các cú nhảy riêng)
    const d = despike(t, streams.distance, rules.teleport.mps)
    const v = windowSpeeds(t, d)
    flags.push(...ruleCurve(t, d), ...ruleSpeed(t, v, rules), ...ruleTeleport(t, streams.latlng, rules), ...ruleStride(t, d, streams.cadence), ...ruleHr(t, d, streams.heartrate))
  } else if ((summary.maxSpeedMps ?? 0) > rules.teleport.mps) {
    // Không có streams: "vận tốc tối đa" là MỘT điểm (thường do GPS nhảy) → chỉ ghi chú, không tự chặn bài
    flags.push({ code: 'VEHICLE_BURST', severity: 'INFO', score: 40, message: `Vận tốc tối đa một điểm ${Math.round((summary.maxSpeedMps ?? 0) * 3.6)} km/h (có thể do GPS nhảy)` })
  }
  flags.push(...ruleHistory(summary, history))

  const w = FRAUD_CONFIG.weights
  const score = Math.min(100, Math.round(flags.reduce((s, f) => s + (f.score / 100) * (w[f.code] ?? 0), 0)))
  const L = FRAUD_CONFIG.levels
  const level = score >= L.critical ? 'CRITICAL' : score >= L.high ? 'HIGH' : score >= L.medium ? 'MEDIUM' : 'LOW'
  // Chờ duyệt khi: có bằng chứng "chắc chắn" (SEVERE), hoặc ≥ 2 bằng chứng độc lập mức HIGH, hoặc tổng điểm cao
  const strong = flags.filter((f) => f.severity !== 'INFO')
  const verdict = flags.some((f) => f.severity === 'SEVERE') || strong.length >= 2 || score >= L.high ? 'REVIEW' : 'OK'
  const top = [...flags].sort((a, b) => b.score - a.score)
  return { score, level, verdict, flags, reason: verdict === 'REVIEW' ? top.slice(0, 2).map((f) => f.message).join('; ') : null }
}

/** Streams Strava (key_by_type=true) → FraudStreams */
export function stravaStreams(raw: Record<string, { data?: unknown[] } | undefined> | null | undefined): FraudStreams | null {
  const arr = <T>(k: string) => (Array.isArray(raw?.[k]?.data) ? (raw![k]!.data as T[]) : null)
  const time = arr<number>('time'), distance = arr<number>('distance')
  if (!time || !distance || time.length < 2) return null
  const n = Math.min(time.length, distance.length)
  const cut = <T>(x: T[] | null) => (x && x.length >= n ? x.slice(0, n) : null)
  return { time: time.slice(0, n), distance: distance.slice(0, n), latlng: cut(arr<[number, number]>('latlng')),
    heartrate: cut(arr<number>('heartrate')), cadence: cut(arr<number>('cadence')) }
}
