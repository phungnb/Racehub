import { describe, expect, it } from 'vitest'
import { buildPayload, enqueue, loadQueue, loadSnapshot, saveSnapshot, updateQueue, SNAPSHOT_MAX_AGE_MS, type RunSnapshot } from './recovery'

const mem = () => {
  const m = new Map<string, string>()
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) }
}
const pt = { latitude: 21, longitude: 105, accuracy: 5, altitude: 0, speed: 3, recorded_at: '2026-09-25T00:00:00Z' }
const snap = (over: Partial<RunSnapshot> = {}): RunSnapshot => ({
  v: 1, phase: 'RUNNING', startedAt: 1_000, savedAt: 10_000, elapsedS: 600, movingS: 590, distanceM: 2000, points: [pt], splits: [], ...over,
})

describe('lưu tạm + khôi phục bài chạy', () => {
  it('khôi phục bài dở dang; quá cũ hoặc quá ngắn thì bỏ', () => {
    const s = mem()
    saveSnapshot(snap(), s)
    expect(loadSnapshot(20_000, s)).toMatchObject({ distanceM: 2000, points: [pt] })
    expect(loadSnapshot(10_000 + SNAPSHOT_MAX_AGE_MS + 1, s)).toBeNull()
    saveSnapshot(snap({ distanceM: 50, movingS: 20 }), s)
    expect(loadSnapshot(20_000, s)).toBeNull()
  })

  it('hàng chờ gửi: không thêm trùng cùng một bài; xóa khi gửi xong', () => {
    const s = mem()
    const p = buildPayload({ startedAt: Date.UTC(2026, 8, 25), endedAt: Date.UTC(2026, 8, 25, 0, 30), elapsedS: 1800, movingS: 1500, distanceM: 5000, points: [pt] })
    expect(p).toMatchObject({ p_source: 'DIRECT_GPS', p_distance_m: 5000, p_moving_s: 1500, p_avg_pace_s: 300 })
    const now = Date.UTC(2026, 8, 25, 1)
    enqueue(p, now, s)
    enqueue(p, now, s)
    expect(loadQueue(now, s)).toHaveLength(1)
    updateQueue((q) => q.filter(() => false), now, s)
    expect(loadQueue(now, s)).toHaveLength(0)
  })
})
