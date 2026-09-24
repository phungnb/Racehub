// Logic thuần của bộ ghi bài chạy (không phụ thuộc React / trình duyệt) — dễ test.

export interface TrackPoint {
  latitude: number
  longitude: number
  accuracy: number
  altitude: number
  /** Vận tốc máy báo (m/s); null = máy không báo */
  speed: number | null
  recorded_at: string
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
