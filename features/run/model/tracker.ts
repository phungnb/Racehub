// Logic thuần của bộ ghi bài chạy (không phụ thuộc React / trình duyệt) — dễ test.

export interface TrackPoint {
  latitude: number
  longitude: number
  accuracy: number
  altitude: number
  /** Vận tốc máy báo (m/s); null = máy không báo */
  speed: number | null
  recorded_at: string
  /** Quãng đường tích luỹ (m) app đo tới điểm này — máy chủ dùng (kẹp theo tuyến) thay vì cộng khoảng cách điểm-điểm có nhiễu */
  distance_m?: number
}

export interface Split {
  km: number          // km thứ mấy (1, 2, 3...)
  seconds: number     // thời gian chạy km đó
}

export const GPS = {
  MAX_ACCURACY_M: 25,      // bỏ điểm sai số lớn hơn (trong nhà, dưới mái che thường 30–100 m)
  MIN_STEP_M: 6,           // quãng dịch chuyển tối thiểu so với điểm neo
  ACCURACY_FACTOR: 1,      // …và tối thiểu bằng sai số trung bình của 2 điểm: rung GPS khi ngồi yên không cộng km
  STILL_WINDOW_S: 10,      // trong 10 giây gần nhất…
  STILL_MIN_M: 10,         // …vị trí (đã làm mượt) dời chưa tới 10 m (< 1 m/s) → đang đứng yên
  STILL_DEVICE_MPS: 0.5,   // máy báo vận tốc < 0,5 m/s mà điểm vẫn "nhảy" → coi là đứng yên
  MAX_SPEED_MPS: 12,       // > 43 km/h: nhảy điểm
  SEGMENT_MAX_S: 15,       // đoạn giữa 2 điểm dài hơn thế = có lúc đứng chờ → chỉ tính phần thời gian di chuyển
  AUTO_PAUSE_MPS: 0.6,     // < 2,2 km/h trong AUTO_PAUSE_AFTER_S → tự tạm dừng
  AUTO_PAUSE_AFTER_S: 10,
} as const

export function haversineM(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371e3
  const toRad = (d: number) => (d * Math.PI) / 180
  const dφ = toRad(lat2 - lat1)
  const dλ = toRad(lon2 - lon1)
  const a = Math.sin(dφ / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dλ / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

export type PointVerdict =
  | { accept: true; distance: number; speed: number }
  | { accept: false; reason: 'INACCURATE' | 'JITTER' | 'STILL' | 'TELEPORT' | 'NO_TIME' }

/**
 * Có nhận điểm GPS mới không, và cộng thêm bao nhiêu mét.
 * `prev` là điểm NEO (điểm được nhận gần nhất): điểm rung quanh chỗ đứng không dời neo,
 * nên khi thật sự di chuyển, quãng đường vẫn được cộng đủ từ neo tới vị trí mới.
 */
export function evaluatePoint(prev: TrackPoint | null, next: TrackPoint): PointVerdict {
  if (next.accuracy > GPS.MAX_ACCURACY_M) return { accept: false, reason: 'INACCURATE' }
  if (!prev) return { accept: true, distance: 0, speed: 0 }
  const dt = (Date.parse(next.recorded_at) - Date.parse(prev.recorded_at)) / 1000
  if (dt <= 0) return { accept: false, reason: 'NO_TIME' }
  const d = haversineM(prev.latitude, prev.longitude, next.latitude, next.longitude)
  const minStep = Math.max(GPS.MIN_STEP_M, GPS.ACCURACY_FACTOR * ((prev.accuracy + next.accuracy) / 2))
  if (d < minStep) return { accept: false, reason: 'JITTER' }
  const speed = d / dt
  // Máy báo gần như đứng yên nhưng điểm lệch vừa phải → rung GPS (điểm lệch rất xa thì vẫn xét tiếp)
  if (next.speed !== null && next.speed >= 0 && next.speed < GPS.STILL_DEVICE_MPS && d < 3 * minStep) {
    return { accept: false, reason: 'STILL' }
  }
  if (speed > GPS.MAX_SPEED_MPS) return { accept: false, reason: 'TELEPORT' }
  return { accept: true, distance: d, speed }
}

const SMOOTH_N = 5

/**
 * Làm mượt: trung vị của 5 điểm thô gần nhất (kết thúc ở vị trí `end`), loại điểm "văng" đơn lẻ.
 * Sai số lấy trung vị của 5 điểm.
 */
export function smoothPoint(raw: TrackPoint[], end = raw.length): TrackPoint | null {
  if (end <= 0) return null
  const last = raw[end - 1]
  const w = raw.slice(Math.max(0, end - SMOOTH_N), end)
  if (w.length < 3) return last
  const med = (xs: number[]) => { const a = [...xs].sort((x, y) => x - y); return a[Math.floor(a.length / 2)] }
  return { ...last, latitude: med(w.map((p) => p.latitude)), longitude: med(w.map((p) => p.longitude)), accuracy: med(w.map((p) => p.accuracy)) }
}

/**
 * Đang đứng yên? So vị trí đã làm mượt hiện tại với ~10 giây trước.
 * Chưa đủ 10 giây dữ liệu → chưa kết luận (trả về false).
 */
export function isStationary(raw: TrackPoint[]): boolean {
  if (raw.length < 3) return false
  const tEnd = Date.parse(raw[raw.length - 1].recorded_at)
  let i = raw.length - 1
  while (i > 0 && tEnd - Date.parse(raw[i].recorded_at) < GPS.STILL_WINDOW_S * 1000) i--
  if (tEnd - Date.parse(raw[i].recorded_at) < GPS.STILL_WINDOW_S * 1000) return false
  const now = smoothPoint(raw)!, then = smoothPoint(raw, i + 1)!
  return haversineM(then.latitude, then.longitude, now.latitude, now.longitude) < GPS.STILL_MIN_M
}

/**
 * Thời gian di chuyển (giây) của một đoạn giữa hai điểm được nhận — dùng để tính pace trung bình
 * khớp với chính quãng đường GPS (như Strava: "moving time").
 * Đoạn dài (đứng chờ đèn rồi chạy tiếp) chỉ tính phần di chuyển ước lượng theo tốc độ gần đây.
 */
export function segmentMovingS(dt: number, d: number, recentSpeed: number): number {
  if (dt <= 0 || d <= 0) return 0
  if (dt <= GPS.SEGMENT_MAX_S) return dt
  return Math.min(dt, d / Math.max(recentSpeed, 1.5))
}

/**
 * Pace hiện tại (giây/km) từ các điểm trong 30 giây gần nhất — mượt hơn pace tức thời.
 * Điểm cuối cũ hơn 10 giây (đang đứng) hoặc quãng quá ngắn → 0 (hiện "--:--").
 */
export function rollingPace(points: TrackPoint[], windowS = 30, now?: number): number {
  if (points.length < 2) return 0
  const last = points[points.length - 1]
  const tEnd = Date.parse(last.recorded_at)
  if (now !== undefined && now - tEnd > 10_000) return 0
  let dist = 0
  let tStart = tEnd
  for (let i = points.length - 1; i > 0; i--) {
    const t = Date.parse(points[i - 1].recorded_at)
    if (tEnd - t > windowS * 1000) break
    dist += haversineM(points[i - 1].latitude, points[i - 1].longitude, points[i].latitude, points[i].longitude)
    tStart = t
  }
  const dt = (tEnd - tStart) / 1000
  return dist >= 20 && dt > 0 ? dt / (dist / 1000) : 0
}

/** Khi vượt qua mốc km mới, trả về split của km vừa hoàn thành. */
export function nextSplit(prevDistanceM: number, newDistanceM: number, movingS: number, splits: Split[]): Split | null {
  const done = Math.floor(newDistanceM / 1000)
  if (done <= Math.floor(prevDistanceM / 1000) || done <= splits.length) return null
  const before = splits.reduce((s, x) => s + x.seconds, 0)
  return { km: done, seconds: Math.max(0, Math.round(movingS - before)) }
}

/** Câu đọc cho HLV giọng nói mỗi km. */
export function splitAnnouncement(split: Split, totalMovingS: number) {
  const m = Math.floor(split.seconds / 60)
  const s = split.seconds % 60
  const tm = Math.floor(totalMovingS / 60)
  return `Hoàn thành ${split.km} ki lô mét. Pace ${m} phút ${s} giây. Tổng thời gian ${tm} phút.`
}

// ============================================================================================
// Bộ máy ghi GPS (v2): lọc Kalman vận tốc-hằng theo sai số từng điểm + phát hiện mất tín hiệu.
// Dùng chung cho app cài (plugin nền) và trình duyệt. Hàm thuần — test bằng mô phỏng trong tracker.test.ts.
// ============================================================================================

/** Làm tròn điểm trước khi lưu / gửi: 7 chữ số thập phân ≈ 1 cm — mỗi điểm gọn ~20 % khi lưu tạm trên máy */
export function compactPoint(p: TrackPoint): TrackPoint {
  const r = (x: number, k: number) => Math.round(x * k) / k
  return {
    latitude: r(p.latitude, 1e7), longitude: r(p.longitude, 1e7), accuracy: r(p.accuracy, 10), altitude: r(p.altitude, 10),
    speed: p.speed === null ? null : r(p.speed, 100), recorded_at: p.recorded_at,
    ...(p.distance_m === undefined ? {} : { distance_m: r(p.distance_m, 10) }),
  }
}

/**
 * Có đủ tín hiệu để bắt đầu tính giờ chưa (như Strava/Garmin chờ "GPS sẵn sàng"):
 * một điểm rất tốt (≤ 10 m) hoặc 3 điểm tốt (≤ 20 m) liên tiếp — tránh bắt đầu bằng một điểm Wi-Fi/ô mạng "may mắn".
 * Điểm cũ (vị trí lưu từ trước, trễ > 10 giây) không tính.
 */
export function gpsReady(recent: { accuracy: number; time: number }[], now: number): boolean {
  const fresh = recent.filter((f) => now - f.time <= 10_000)
  if (fresh.some((f) => f.accuracy <= 10)) return true
  const tail = fresh.slice(-3)
  return tail.length === 3 && tail.every((f) => f.accuracy <= ENGINE.GOOD_ACCURACY_M)
}

export const ENGINE = {
  MAX_ACCURACY_M: 35,     // điểm sai số > 35 m bỏ (trong nhà / hầm); 20–35 m vẫn dùng nhưng bộ lọc tin ít hơn
  GOOD_ACCURACY_M: 20,    // hiển thị "GPS tốt"
  ACCEL_SIGMA: 1.0,       // nhiễu gia tốc (m/s²) của mô hình chạy bộ — nhỏ: đường mượt, lớn: bám góc cua nhanh
  MIN_STEP_M: 6,          // bước tích luỹ tối thiểu (thực tế thích ứng ~4 giây di chuyển, 6–15 m)
  GAP_S: 20,              // > 20 giây không có điểm tốt = mất tín hiệu (tắt màn hình, hầm, nhà cao tầng)
  GAP_MAX_MPS: 7,         // qua đoạn mất tín hiệu: chỉ nối nếu tốc độ suy ra ≤ 7 m/s (2:23/km)…
  GAP_MIN_MPS: 0.7,       // …và ≥ 0,7 m/s (chậm hơn = đã dừng, không tính giờ di chuyển)
  MAX_SPEED_MPS: 12,
  SPEED_W_MIN: 0.7,       // luôn tin vận tốc Doppler ≥ 70 % khi máy có báo (mô phỏng: sai lệch < 2 % mọi kịch bản)
} as const

export interface GpsGap { from: string; to: string; seconds: number; meters: number; counted: boolean }

/** Một trục (Đông hoặc Bắc, đơn vị mét) của bộ lọc Kalman vận tốc-hằng */
class Axis {
  p = 0; v = 0; P00 = 0; P01 = 0; P10 = 0; P11 = 0
  init(z: number, r: number) { this.p = z; this.v = 0; this.P00 = r; this.P01 = 0; this.P10 = 0; this.P11 = 9 }
  predict(dt: number, q: number) {
    this.p += this.v * dt
    const dt2 = dt * dt, dt3 = dt2 * dt, dt4 = dt3 * dt
    const P00 = this.P00 + dt * (this.P10 + this.P01) + dt2 * this.P11 + (q * dt4) / 4
    const P01 = this.P01 + dt * this.P11 + (q * dt3) / 2
    const P10 = this.P10 + dt * this.P11 + (q * dt3) / 2
    const P11 = this.P11 + q * dt2
    this.P00 = P00; this.P01 = P01; this.P10 = P10; this.P11 = P11
  }
  update(z: number, r: number) {
    const S = this.P00 + r
    const K0 = this.P00 / S, K1 = this.P10 / S
    const y = z - this.p
    this.p += K0 * y; this.v += K1 * y
    const P00 = (1 - K0) * this.P00, P01 = (1 - K0) * this.P01
    this.P10 = this.P10 - K1 * this.P00; this.P11 = this.P11 - K1 * this.P01
    this.P00 = P00; this.P01 = P01
  }
}

export interface EngineResult {
  /** điểm đã lọc được thêm vào tuyến (null = không thêm) */
  point: TrackPoint | null
  /** mét cộng thêm */
  distance: number
  /** giây di chuyển cộng thêm */
  moving: number
  /** vừa qua một đoạn mất tín hiệu */
  gap: GpsGap | null
  reason?: 'INACCURATE' | 'STILL' | 'JITTER' | 'TELEPORT' | 'NO_TIME' | 'FIRST'
}

/**
 * Bộ máy ghi GPS. `push(fix)` với mỗi điểm thô; trả về điểm tuyến + quãng đường / thời gian cộng thêm.
 * - Kalman trong hệ toạ độ mét cục bộ, nhiễu đo = sai số máy báo → điểm kém bị tin ít, không bị bỏ hẳn.
 * - Đứng yên (vị trí thô dời < 10 m trong 10 giây) → không cộng.
 * - Mất tín hiệu > 20 giây → khởi động lại bộ lọc; đoạn nối chỉ được tính nếu tốc độ hợp lý, và luôn được ghi lại (gaps).
 */
export class TrackEngine {
  private e = new Axis()
  private n = new Axis()
  private lat0 = 0; private lng0 = 0; private kx = 1
  private started = false
  private lastT = 0
  private anchor: { x: number; y: number; t: number } | null = null
  private lastGood: TrackPoint | null = null
  private spdAcc = 0
  private spdOk = true
  private lastSpeed: number | null = null
  raw: TrackPoint[] = []
  gaps: GpsGap[] = []
  recentSpeed = 2.8

  /** Tạm dừng / tiếp tục: không nối quãng giữa hai lần */
  breakSegment() { this.started = false; this.anchor = null; this.raw = []; this.lastGood = null }

  private toXY(lat: number, lng: number) { return { x: (lng - this.lng0) * this.kx, y: (lat - this.lat0) * 111_320 } }
  private toLL(x: number, y: number) { return { latitude: this.lat0 + y / 111_320, longitude: this.lng0 + x / this.kx } }

  push(p: TrackPoint): EngineResult {
    const none = (reason: EngineResult['reason']): EngineResult => ({ point: null, distance: 0, moving: 0, gap: null, reason })
    if (!(p.accuracy <= ENGINE.MAX_ACCURACY_M)) return none('INACCURATE')
    const t = Date.parse(p.recorded_at) / 1000
    if (this.started && t <= this.lastT) return none('NO_TIME')
    const r = Math.max(p.accuracy, 3) ** 2

    // Điểm đầu tiên (hoặc sau tạm dừng): neo bộ lọc
    if (!this.started) {
      if (!this.lat0) { this.lat0 = p.latitude; this.lng0 = p.longitude; this.kx = 111_320 * Math.cos((p.latitude * Math.PI) / 180) }
      const z = this.toXY(p.latitude, p.longitude)
      this.e.init(z.x, r); this.n.init(z.y, r)
      this.started = true; this.lastT = t
      this.anchor = { x: z.x, y: z.y, t }
      this.raw = [p]; this.lastGood = p; this.spdAcc = 0; this.spdOk = true; this.lastSpeed = p.speed != null && p.speed >= 0 ? p.speed : null
      return { point: { ...p }, distance: 0, moving: 0, gap: null, reason: 'FIRST' }
    }

    const dt = t - this.lastT
    const z = this.toXY(p.latitude, p.longitude)

    // Mất tín hiệu: nối từ điểm tốt cuối tới điểm mới, khởi động lại bộ lọc
    if (dt > ENGINE.GAP_S && this.anchor) {
      const d = Math.hypot(z.x - this.anchor.x, z.y - this.anchor.y)
      const span = t - this.anchor.t
      const speed = span > 0 ? d / span : 0
      const counted = speed >= ENGINE.GAP_MIN_MPS && speed <= ENGINE.GAP_MAX_MPS
      const gap: GpsGap = { from: this.lastGood?.recorded_at ?? p.recorded_at, to: p.recorded_at, seconds: Math.round(span), meters: Math.round(d), counted }
      this.gaps.push(gap)
      this.e.init(z.x, r); this.n.init(z.y, r)
      this.lastT = t; this.anchor = { x: z.x, y: z.y, t }; this.raw = [p]; this.lastGood = p
      this.spdAcc = 0; this.spdOk = true; this.lastSpeed = p.speed != null && p.speed >= 0 ? p.speed : null
      return { point: { ...p }, distance: counted ? d : 0, moving: counted ? span : 0, gap }
    }

    // Tích phân vận tốc máy báo giữa hai điểm (thiếu vận tốc ở bất kỳ điểm nào → không dùng cho bước này)
    if (p.speed != null && p.speed >= 0 && this.lastSpeed != null) this.spdAcc += ((p.speed + this.lastSpeed) / 2) * dt
    else this.spdOk = false
    this.lastSpeed = p.speed != null && p.speed >= 0 ? p.speed : null
    const q = ENGINE.ACCEL_SIGMA ** 2
    this.e.predict(dt, q); this.n.predict(dt, q)
    this.e.update(z.x, r); this.n.update(z.y, r)
    this.lastT = t
    this.lastGood = p
    this.raw.push(p)
    if (this.raw.length > 60) this.raw.splice(0, this.raw.length - 60)

    // Đứng yên: kéo neo theo (không tích luỹ rung), không cộng
    const deviceMoving = p.speed != null && p.speed > 0.8
    if (!deviceMoving && isStationary(this.raw)) { this.anchor = { x: this.e.p, y: this.n.p, t }; this.spdAcc = 0; this.spdOk = true; return none('STILL') }

    const a = this.anchor!
    const d = Math.hypot(this.e.p - a.x, this.n.p - a.y)
    const span = t - a.t
    // Bước tích luỹ thích ứng theo tốc độ (~4 giây di chuyển, 6–15 m): nhiễu nhỏ không cộng dồn thành zig-zag, góc cua vẫn giữ
    const minStep = Math.min(15, Math.max(ENGINE.MIN_STEP_M, 4 * Math.hypot(this.e.v, this.n.v)))
    if (d < minStep) return none('JITTER')
    if (span > 0 && d / span > ENGINE.MAX_SPEED_MPS) return none('TELEPORT')
    // Quãng đường theo vận tốc Doppler (chip GPS đo, chính xác ~0,2 m/s kể cả khi vị trí lệch 10–15 m):
    // tin vận tốc nhiều hơn khi sai số vị trí lớn → nhiễu vị trí không cộng dồn thành km "ảo"
    let dTrue = d
    if (this.spdOk && this.spdAcc > 0) {
      const w = Math.min(1, Math.max(ENGINE.SPEED_W_MIN, (p.accuracy - 5) / 10))   // GPS tốt: trộn một phần; ≥ ±15 m: tin vận tốc
      dTrue = (1 - w) * d + w * this.spdAcc
    }
    this.spdAcc = 0; this.spdOk = true
    const moving = segmentMovingS(span, d, this.recentSpeed)
    if (span > 0 && span <= GPS.SEGMENT_MAX_S) this.recentSpeed = 0.7 * this.recentSpeed + 0.3 * (d / span)
    this.anchor = { x: this.e.p, y: this.n.p, t }
    const ll = this.toLL(this.e.p, this.n.p)
    return { point: { ...p, ...ll }, distance: dTrue, moving, gap: null }
  }
}
