// Chuyển dữ liệu Strava → định dạng chuẩn của RaceHub (hàm thuần, không gọi mạng).
// Tài liệu trường dữ liệu: https://developers.strava.com/docs/reference/#api-models-SummaryActivity

export interface StravaSummaryActivity {
  id: number | string
  name?: string
  sport_type?: string
  type?: string
  start_date?: string
  elapsed_time?: number
  moving_time?: number
  distance?: number
  total_elevation_gain?: number
  average_speed?: number
  max_speed?: number
  average_heartrate?: number
  manual?: boolean
  trainer?: boolean
  device_name?: string
  map?: { summary_polyline?: string | null; polyline?: string | null } | null
  // Chỉ có ở bản chi tiết (GET /activities/:id)
  start_latlng?: [number, number] | [] | null
  max_heartrate?: number
  average_cadence?: number
  calories?: number
  splits_metric?: { distance?: number; moving_time?: number; elevation_difference?: number; average_heartrate?: number }[]
}

/** Dữ liệu chi tiết lưu vào activity_details (migration 001900) */
export interface ActivityDetailPayload {
  polyline: string | null
  splits: { distance_m: number; moving_s: number; elev_m: number | null; hr: number | null }[] | null
  max_heartrate: number | null
  avg_cadence: number | null
  calories: number | null
  start_lat: number | null
  start_lng: number | null
  detailed: boolean
}

export interface NormalizedActivity {
  title: string
  sport_type: string
  started_at: string
  elapsed_s: number
  moving_s: number
  distance_m: number
  elevation_gain_m: number
  avg_speed_mps: number | null
  max_speed_mps: number | null
  avg_heartrate: number | null
  manual: boolean
  has_gps: boolean
  device_name: string | null
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)

export function mapStravaActivity(a: StravaSummaryActivity): NormalizedActivity {
  // Chạy máy (trainer) được coi như VirtualRun để đưa vào hàng chờ duyệt
  const sport = a.trainer && (a.sport_type ?? a.type) === 'Run' ? 'VirtualRun' : (a.sport_type ?? a.type ?? 'Unknown')
  return {
    title: (a.name ?? '').trim() || 'Buổi chạy',
    sport_type: sport,
    started_at: a.start_date ?? new Date(0).toISOString(),
    elapsed_s: Math.max(0, Math.round(num(a.elapsed_time) ?? 0)),
    moving_s: Math.max(0, Math.round(num(a.moving_time) ?? 0)),
    distance_m: Math.max(0, num(a.distance) ?? 0),
    elevation_gain_m: num(a.total_elevation_gain) ?? 0,
    avg_speed_mps: num(a.average_speed),
    max_speed_mps: num(a.max_speed),
    avg_heartrate: num(a.average_heartrate),
    manual: a.manual === true,
    has_gps: !!a.map?.summary_polyline,
    device_name: a.device_name ?? null,
  }
}

/**
 * Tuyến chạy + từng km. `detailed` = dữ liệu lấy từ GET /activities/:id (có polyline đầy đủ + splits_metric);
 * bản trong danh sách chỉ có summary_polyline rút gọn.
 */
export function mapStravaDetail(a: StravaSummaryActivity, detailed: boolean): ActivityDetailPayload | null {
  const polyline = (detailed ? a.map?.polyline : null) || a.map?.summary_polyline || null
  const splits = (a.splits_metric ?? [])
    .filter((s) => (num(s.distance) ?? 0) > 50 && (num(s.moving_time) ?? 0) > 0)
    .map((s) => ({
      distance_m: Math.round(num(s.distance)!),
      moving_s: Math.round(num(s.moving_time)!),
      elev_m: num(s.elevation_difference),
      hr: num(s.average_heartrate) === null ? null : Math.round(num(s.average_heartrate)!),
    }))
  const ll = Array.isArray(a.start_latlng) && a.start_latlng.length === 2 ? a.start_latlng : null
  // Strava tính cadence chạy theo một chân → nhân đôi thành bước/phút
  const cadence = num(a.average_cadence)
  if (!polyline && !splits.length && !detailed) return null
  return {
    polyline,
    splits: splits.length ? splits : null,
    max_heartrate: num(a.max_heartrate),
    avg_cadence: cadence === null ? null : Math.round(cadence * 2),
    calories: num(a.calories),
    start_lat: ll ? ll[0] : null,
    start_lng: ll ? ll[1] : null,
    detailed,
  }
}

/** Token hết hạn (hoặc sắp hết trong `skewSeconds`) thì cần làm mới trước khi gọi API. */
export function tokenNeedsRefresh(expiresAt: string | Date | null | undefined, now = new Date(), skewSeconds = 120) {
  if (!expiresAt) return true
  return new Date(expiresAt).getTime() - now.getTime() < skewSeconds * 1000
}

/** Mốc bắt đầu đồng bộ: từ lần đồng bộ trước (lùi 1 ngày để bắt bài tải lên muộn), tối đa 30 ngày. */
export function syncWindowStart(lastSyncedAt: string | Date | null | undefined, now = new Date(), maxDays = 30) {
  const floor = now.getTime() - maxDays * 86400_000
  if (!lastSyncedAt) return new Date(floor)
  return new Date(Math.max(floor, new Date(lastSyncedAt).getTime() - 86400_000))
}

export interface SyncSummary {
  imported: number
  pending: number
  skipped: number
  duplicates: number
  earned_xu: number
}

export function summarize(results: Array<Record<string, unknown>>): SyncSummary {
  const s: SyncSummary = { imported: 0, pending: 0, skipped: 0, duplicates: 0, earned_xu: 0 }
  for (const r of results) {
    if (r.result === 'IMPORTED') {
      s.imported++
      if (r.validation_status === 'PENDING') s.pending++
      s.earned_xu += Number(r.earned_xu ?? 0)
    } else if (r.result === 'SKIPPED') s.skipped++
    else s.duplicates++
  }
  s.earned_xu = Math.round(s.earned_xu * 10) / 10
  return s
}
