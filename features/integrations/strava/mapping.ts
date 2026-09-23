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
  map?: { summary_polyline?: string | null } | null
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
