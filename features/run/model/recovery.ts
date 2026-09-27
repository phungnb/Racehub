// Không bao giờ mất bài chạy:
// 1. Đang chạy: vài giây lưu tạm một lần trên máy. Trình duyệt / hệ điều hành đóng app giữa chừng →
//    mở lại màn Chạy sẽ hỏi khôi phục.
//    Điểm GPS lưu THEO KHỐI 100 điểm: mỗi lần chỉ ghi lại khối cuối (đang đầy dần) + phần tóm tắt nhỏ —
//    bài 3 tiếng vẫn chỉ ghi vài KB mỗi lần, nên lưu dày được (5 giây, mỗi km, mỗi lần tạm dừng / ẩn app).
// 2. Bấm Lưu mà mất mạng / máy chủ lỗi: bài vào hàng chờ trên máy, tự gửi lại khi có mạng (gửi trùng thì máy chủ bỏ qua).
import type { SessionState } from './session'
import type { Split, TrackPoint } from './tracker'

/** Bản lưu cũ (một khối, trước khi có RunSession) — vẫn đọc được để không mất bài đang dở khi cập nhật app */
interface LegacySnapshot {
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
interface RunMeta { v: 2; savedAt: number; count: number; state: SessionState }

/** Bài dở dang đọc từ máy */
export interface RunSnapshot { savedAt: number; state: SessionState; points: TrackPoint[] }

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

export interface PendingRun {
  id: string; payload: RunPayload; createdAt: number; attempts: number; lastError?: string
  /** tóm tắt chất lượng GPS gắn vào bài sau khi gửi được (activity_attach_gps_quality) */
  quality?: Record<string, unknown>
}

export const SNAPSHOT_KEY = 'rh-run-active'
export const QUEUE_KEY = 'rh-run-pending'
/** Số điểm mỗi khối lưu tạm (~10 KB) */
export const CHUNK = 100
const chunkKey = (i: number) => `${SNAPSHOT_KEY}:${i}`
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

/**
 * Lưu tạm bài đang chạy. `saved` = số điểm đã lưu chắc chắn ở lần trước: chỉ ghi lại từ khối chứa điểm đó trở đi.
 * Trả về số điểm đã lưu (dùng làm `saved` lần sau), hoặc `saved` cũ nếu bộ nhớ đầy / lỗi.
 */
export function saveSnapshot(state: SessionState, points: TrackPoint[], saved = 0, now = Date.now(), s: Store | null = store()): number {
  const count = points.length
  for (let i = Math.floor(Math.min(saved, count) / CHUNK); i * CHUNK < count; i++) {
    if (!write(s, chunkKey(i), points.slice(i * CHUNK, (i + 1) * CHUNK))) return saved
  }
  // Tóm tắt ghi SAU các khối: đọc lại luôn thấy đủ điểm mà tóm tắt nói tới
  return write(s, SNAPSHOT_KEY, { v: 2, savedAt: now, count, state } satisfies RunMeta) ? count : saved
}

export function clearSnapshot(s: Store | null = store()) {
  try {
    const meta = read<RunMeta | LegacySnapshot>(s, SNAPSHOT_KEY)
    const n = meta?.v === 2 ? Math.ceil(meta.count / CHUNK) : 0
    for (let i = 0; i < n; i++) s?.removeItem(chunkKey(i))
    s?.removeItem(SNAPSHOT_KEY)
  } catch { /* bỏ qua */ }
}

/** Bài dở dang còn khôi phục được (có ít nhất 100 m hoặc 1 phút) */
export function loadSnapshot(now = Date.now(), s: Store | null = store()): RunSnapshot | null {
  const meta = read<RunMeta | LegacySnapshot>(s, SNAPSHOT_KEY)
  let snap: RunSnapshot | null = null
  if (meta?.v === 2 && meta.state) {
    const points: TrackPoint[] = []
    for (let i = 0; i * CHUNK < meta.count; i++) {
      const c = read<TrackPoint[]>(s, chunkKey(i))
      if (!Array.isArray(c)) break          // thiếu khối (hiếm) → giữ phần đọc được
      points.push(...c)
    }
    snap = { savedAt: meta.savedAt, state: meta.state, points: points.slice(0, meta.count) }
  } else if (meta?.v === 1 && Array.isArray(meta.points)) {
    snap = {
      savedAt: meta.savedAt, points: meta.points,
      state: { phase: meta.phase, startedAt: meta.startedAt, endedAt: null, elapsedS: meta.elapsedS, movingS: meta.movingS, distanceM: meta.distanceM,
        splits: meta.splits ?? [], gaps: [], moved: meta.distanceM > 0, elapsedAtMove: meta.elapsedS, q: undefined as unknown as SessionState['q'] },
    }
  }
  if (!snap) return null
  if (now - snap.savedAt > SNAPSHOT_MAX_AGE_MS || (snap.state.distanceM < 100 && snap.state.movingS < 60)) {
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
export function enqueue(payload: RunPayload, now = Date.now(), s: Store | null = store(), quality?: Record<string, unknown>): PendingRun {
  const q = loadQueue(now, s)
  const existing = q.find((x) => x.payload.p_started_at === payload.p_started_at)
  if (existing) return existing
  const item: PendingRun = { id: `${payload.p_started_at}`, payload, createdAt: now, attempts: 0, ...(quality ? { quality } : {}) }
  write(s, QUEUE_KEY, [...q, item])
  return item
}

export function updateQueue(fn: (q: PendingRun[]) => PendingRun[], now = Date.now(), s: Store | null = store()) {
  const next = fn(loadQueue(now, s))
  if (next.length) write(s, QUEUE_KEY, next)
  else { try { s?.removeItem(QUEUE_KEY) } catch { /* bỏ qua */ } }
  return next
}
