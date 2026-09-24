// Logic thuần của bộ ghi bài chạy (không phụ thuộc React / trình duyệt) — dễ test.

export interface TrackPoint {
  latitude: number
  longitude: number
  accuracy: number
  altitude: number
  speed: number
  recorded_at: string
}

export interface Split {
  km: number          // km thứ mấy (1, 2, 3...)
  seconds: number     // thời gian chạy km đó
}

export const GPS = {
  MAX_ACCURACY_M: 35,      // bỏ điểm sai số lớn hơn
  MIN_STEP_M: 2,           // bỏ rung GPS khi đứng yên
  MAX_SPEED_MPS: 12,       // > 43 km/h: nhảy điểm
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
  | { accept: false; reason: 'INACCURATE' | 'JITTER' | 'TELEPORT' | 'NO_TIME' }

/** Có nhận điểm GPS mới không, và cộng thêm bao nhiêu mét. */
export function evaluatePoint(prev: TrackPoint | null, next: TrackPoint): PointVerdict {
  if (next.accuracy > GPS.MAX_ACCURACY_M) return { accept: false, reason: 'INACCURATE' }
  if (!prev) return { accept: true, distance: 0, speed: 0 }
  const dt = (Date.parse(next.recorded_at) - Date.parse(prev.recorded_at)) / 1000
  if (dt <= 0) return { accept: false, reason: 'NO_TIME' }
  const d = haversineM(prev.latitude, prev.longitude, next.latitude, next.longitude)
  if (d < GPS.MIN_STEP_M) return { accept: false, reason: 'JITTER' }
  const speed = d / dt
  if (speed > GPS.MAX_SPEED_MPS) return { accept: false, reason: 'TELEPORT' }
  return { accept: true, distance: d, speed }
}

/** Pace hiện tại (giây/km) từ các điểm trong 30 giây gần nhất — mượt hơn pace tức thời. */
export function rollingPace(points: TrackPoint[], windowS = 30): number {
  if (points.length < 2) return 0
  const last = points[points.length - 1]
  const tEnd = Date.parse(last.recorded_at)
  let dist = 0
  let tStart = tEnd
  for (let i = points.length - 1; i > 0; i--) {
    const t = Date.parse(points[i - 1].recorded_at)
    if (tEnd - t > windowS * 1000) break
    dist += haversineM(points[i - 1].latitude, points[i - 1].longitude, points[i].latitude, points[i].longitude)
    tStart = t
  }
  const dt = (tEnd - tStart) / 1000
  return dist > 5 && dt > 0 ? dt / (dist / 1000) : 0
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
