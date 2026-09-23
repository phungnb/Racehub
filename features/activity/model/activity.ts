// Dạng chuẩn hoá của một bài chạy để hiển thị.
// Bảng `activities` hiện có nhiều tên cột khác nhau giữa các phiên bản (xem database.md §7),
// nên đọc linh hoạt ở một chỗ duy nhất tại đây.
export interface ActivitySummary {
  id: string
  title: string
  startedAt: string
  distanceM: number
  movingS: number
  status: string | null
}

type Row = Record<string, unknown>
const num = (...vals: unknown[]) => Number(vals.find((v) => v !== null && v !== undefined) ?? 0)
const str = (...vals: unknown[]) => (vals.find((v) => typeof v === 'string' && v) as string | undefined) ?? null

export function normalizeActivity(r: Row): ActivitySummary {
  return {
    id: String(r.id),
    title: str(r.title, r.name) ?? 'Chạy bộ',
    startedAt: str(r.start_time, r.start_date, r.activity_date, r.started_at, r.created_at) ?? new Date(0).toISOString(),
    distanceM: num(r.distance_m, r.distance),
    movingS: num(r.moving_time_s, r.time_s, r.moving_time, r.moving_s),
    status: str(r.validation_status, r.status),
  }
}
