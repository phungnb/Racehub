// Không bao giờ mất bài chạy:
// 1. Đang chạy: vài giây lưu tạm một lần trên máy. Trình duyệt đóng app (iPhone hay làm vậy khi app chạy ngầm) →
//    mở lại màn Chạy sẽ hỏi khôi phục.
// 2. Bấm Lưu mà mất mạng / máy chủ lỗi: bài vào hàng chờ trên máy, tự gửi lại khi có mạng (gửi trùng thì máy chủ bỏ qua).
import type { Split, TrackPoint } from './tracker'

export interface RunSnapshot {
  v: 1
  phase: 'RUNNING' | 'PAUSED' | 'FINISHED'
  startedAt: number
  savedAt: number
  elapsedS: number
  movingS: number
  distanceM: number
  points: TrackPoint[]
  splits: Split[]
}

/** Tham số của RPC submit_and_process_activity */
export interface RunPayload {
  p_title: string
  p_source: 'DIRECT_GPS'
  p_started_at: string
  p_ended_at: string
  p_elapsed_s: number
  p_moving_s: number
  p_distance_m: number
  p_avg_pace_s: number
  p_track_points: TrackPoint[]
}

export interface PendingRun { id: string; payload: RunPayload; createdAt: number; attempts: number; lastError?: string }

export const SNAPSHOT_KEY = 'rh-run-active'
export const QUEUE_KEY = 'rh-run-pending'
/** Bài dở dang cũ hơn thế thì bỏ (không ai chạy liền 12 tiếng rồi mới mở lại app) */
export const SNAPSHOT_MAX_AGE_MS = 12 * 3600_000
/** Hàng chờ giữ tối đa 7 ngày */
export const PENDING_MAX_AGE_MS = 7 * 86_400_000

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
const store = (): Store | null => { try { return typeof localStorage === 'undefined' ? null : localStorage } catch { return null } }
const read = <T>(s: Store | null, key: string): T | null => {
  try { const raw = s?.getItem(key); return raw ? (JSON.parse(raw) as T) : null } catch { return null }
}
const write = (s: Store | null, key: string, v: unknown) => { try { s?.setItem(key, JSON.stringify(v)); return true } catch { return false } }

export function saveSnapshot(snap: RunSnapshot, s: Store | null = store()) { return write(s, SNAPSHOT_KEY, snap) }
export function clearSnapshot(s: Store | null = store()) { try { s?.removeItem(SNAPSHOT_KEY) } catch { /* bỏ qua */ } }

/** Bài dở dang còn khôi phục được (có ít nhất 100 m hoặc 1 phút) */
export function loadSnapshot(now = Date.now(), s: Store | null = store()): RunSnapshot | null {
  const snap = read<RunSnapshot>(s, SNAPSHOT_KEY)
  if (!snap || snap.v !== 1 || !Array.isArray(snap.points)) return null
  if (now - snap.savedAt > SNAPSHOT_MAX_AGE_MS || (snap.distanceM < 100 && snap.movingS < 60)) {
    clearSnapshot(s)
    return null
  }
  return snap
}

export function buildPayload(r: { startedAt: number; endedAt: number; elapsedS: number; movingS: number; distanceM: number; points: TrackPoint[] }): RunPayload {
  const km = r.distanceM / 1000
  const moving = Math.round(r.movingS)
  return {
    p_title: `Buổi chạy ${new Date(r.startedAt).toLocaleDateString('vi-VN')}`,
    p_source: 'DIRECT_GPS',
    p_started_at: new Date(r.startedAt).toISOString(),
    p_ended_at: new Date(r.endedAt).toISOString(),
    p_elapsed_s: Math.round(r.elapsedS),
    p_moving_s: moving,
    p_distance_m: Math.round(r.distanceM),
    p_avg_pace_s: km > 0 ? Math.round(moving / km) : 0,
    p_track_points: r.points,
  }
}

export function loadQueue(now = Date.now(), s: Store | null = store()): PendingRun[] {
  const q = read<PendingRun[]>(s, QUEUE_KEY) ?? []
  return Array.isArray(q) ? q.filter((x) => x?.payload && now - x.createdAt <= PENDING_MAX_AGE_MS) : []
}

/** Thêm vào hàng chờ; cùng giờ bắt đầu = cùng bài (không thêm trùng) */
export function enqueue(payload: RunPayload, now = Date.now(), s: Store | null = store()): PendingRun {
  const q = loadQueue(now, s)
  const existing = q.find((x) => x.payload.p_started_at === payload.p_started_at)
  if (existing) return existing
  const item: PendingRun = { id: `${payload.p_started_at}`, payload, createdAt: now, attempts: 0 }
  write(s, QUEUE_KEY, [...q, item])
  return item
}

export function updateQueue(fn: (q: PendingRun[]) => PendingRun[], now = Date.now(), s: Store | null = store()) {
  const next = fn(loadQueue(now, s))
  if (next.length) write(s, QUEUE_KEY, next)
  else { try { s?.removeItem(QUEUE_KEY) } catch { /* bỏ qua */ } }
  return next
}
