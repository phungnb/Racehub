// Tuyến chạy + từng km (hàm thuần, không gọi mạng) — dùng cho bản đồ, biểu đồ và ảnh chia sẻ

export type LatLng = [number, number]
/** Điểm GPS trong app: [lat, lng, giây kể từ lúc bắt đầu, độ cao] */
export type TrackPoint = [number, number, number, number | null]
export interface Split { distance_m: number; moving_s: number; elev_m: number | null; hr: number | null }

/** Giải mã Google encoded polyline (định dạng Strava dùng) */
export function decodePolyline(str: string | null | undefined): LatLng[] {
  if (!str) return []
  const out: LatLng[] = []
  let i = 0, lat = 0, lng = 0
  while (i < str.length) {
    for (const axis of [0, 1]) {
      let shift = 0, result = 0, b: number
      do {
        b = str.charCodeAt(i++) - 63
        result |= (b & 0x1f) << shift
        shift += 5
      } while (b >= 0x20 && i < str.length)
      const delta = result & 1 ? ~(result >> 1) : result >> 1
      if (axis === 0) lat += delta
      else lng += delta
    }
    out.push([lat / 1e5, lng / 1e5])
  }
  return out
}

/** Khoảng cách (m) giữa hai điểm */
export function haversine(a: LatLng, b: LatLng): number {
  const R = 6371000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b[0] - a[0])
  const dLng = toRad(b[1] - a[1])
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** Tính từng km từ điểm GPS trong app (bỏ đoạn dừng: thời gian giữa 2 điểm > 30 s coi như nghỉ) */
export function splitsFromPoints(points: TrackPoint[], minLast = 100): Split[] {
  const out: Split[] = []
  let dist = 0, time = 0, startAlt: number | null = points[0]?.[3] ?? null
  for (let k = 1; k < points.length; k++) {
    const p = points[k - 1], q = points[k]
    const d = haversine([p[0], p[1]], [q[0], q[1]])
    const dt = q[2] - p[2]
    if (dt <= 0) continue
    dist += d
    if (dt <= 30) time += dt
    if (dist >= 1000) {
      // Phần vượt 1 km chuyển sang km sau theo tỉ lệ
      const over = dist - 1000
      const overT = dt <= 30 && d > 0 ? (dt * over) / d : 0
      out.push({ distance_m: 1000, moving_s: Math.round(time - overT), elev_m: elev(startAlt, q[3]), hr: null })
      dist = over
      time = overT
      startAlt = q[3]
    }
  }
  if (dist >= minLast && time > 0) out.push({ distance_m: Math.round(dist), moving_s: Math.round(time), elev_m: elev(startAlt, points.at(-1)?.[3] ?? null), hr: null })
  return out
}
const elev = (a: number | null, b: number | null) => (a === null || b === null ? null : Math.round((b - a) * 10) / 10)

/** Pace (giây/km) của một km — km lẻ cuối quy đổi theo tỉ lệ */
export const splitPace = (s: Split) => (s.distance_m > 0 ? s.moving_s / (s.distance_m / 1000) : 0)

/** Chỉ số km nhanh nhất (chỉ xét km đủ ≥ 900 m) */
export function fastestSplit(splits: Split[]): number {
  let best = -1
  splits.forEach((s, i) => {
    if (s.distance_m < 900) return
    if (best < 0 || splitPace(s) < splitPace(splits[best])) best = i
  })
  return best
}

/**
 * Chiếu tuyến chạy vào khung w×h (giữ đúng tỉ lệ, căn giữa) — cho SVG / canvas.
 * Dùng phép chiếu equirectangular với cos(vĩ độ trung bình): đủ chính xác cho vài chục km.
 */
export function fitRoute(route: LatLng[], w: number, h: number, pad = 0): [number, number][] {
  if (route.length < 2) return []
  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity
  for (const [la, ln] of route) {
    minLat = Math.min(minLat, la); maxLat = Math.max(maxLat, la)
    minLng = Math.min(minLng, ln); maxLng = Math.max(maxLng, ln)
  }
  const k = Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180)
  const spanX = Math.max((maxLng - minLng) * k, 1e-9)
  const spanY = Math.max(maxLat - minLat, 1e-9)
  const scale = Math.min((w - 2 * pad) / spanX, (h - 2 * pad) / spanY)
  const ox = (w - spanX * scale) / 2
  const oy = (h - spanY * scale) / 2
  return route.map(([la, ln]) => [ox + (ln - minLng) * k * scale, oy + (maxLat - la) * scale])
}

/** Rút gọn điểm (giữ đầu/cuối) để vẽ nhanh */
export function thin<T>(pts: T[], max = 600): T[] {
  if (pts.length <= max) return pts
  const step = pts.length / max
  const out: T[] = []
  for (let i = 0; i < max; i++) out.push(pts[Math.floor(i * step)])
  out.push(pts[pts.length - 1])
  return out
}

/** Câu so sánh ngắn với các bài trước (vd "Dài hơn 2,1 km so với thường lệ") */
export function compareNotes(c: { runs: number; avg_distance_m: number | null; avg_pace_s: number | null; longest_30d: boolean } | null,
  distanceM: number, paceS: number): string[] {
  if (!c || c.runs < 3) return []
  const notes: string[] = []
  if (c.longest_30d) notes.push('Bài dài nhất 30 ngày qua')
  if (c.avg_distance_m) {
    const diff = (distanceM - c.avg_distance_m) / 1000
    if (Math.abs(diff) >= 0.5) notes.push(`${diff > 0 ? 'Dài hơn' : 'Ngắn hơn'} ${Math.abs(diff).toLocaleString('vi-VN', { maximumFractionDigits: 1 })} km so với thường lệ`)
  }
  if (c.avg_pace_s && paceS > 0) {
    const diff = Math.round(c.avg_pace_s - paceS)
    if (Math.abs(diff) >= 5) notes.push(`${diff > 0 ? 'Nhanh hơn' : 'Chậm hơn'} ${Math.abs(diff)} giây/km so với thường lệ`)
  }
  return notes
}
