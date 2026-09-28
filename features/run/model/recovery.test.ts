import { describe, expect, it } from 'vitest'
import { buildPayload, clearSnapshot, enqueue, loadQueue, loadSnapshot, ownedBy, saveSnapshot, updateQueue, SNAPSHOT_KEY, SNAPSHOT_MAX_AGE_MS } from './recovery'
import { RunSession, type SessionState } from './session'

const mem = () => {
  const m = new Map<string, string>()
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) }
}
const pt = { latitude: 21, longitude: 105, accuracy: 5, altitude: 0, speed: 3, recorded_at: '2026-09-25T00:00:00Z' }
const state = (over: Partial<SessionState> = {}): SessionState => ({
  phase: 'RUNNING', startedAt: 1_000, endedAt: null, elapsedS: 600, movingS: 590, distanceM: 2000, splits: [], gaps: [], moved: true, elapsedAtMove: 600,
  q: new RunSession().q, ...over,
})
const pts = (n: number) => Array.from({ length: n }, (_, i) => ({ ...pt, latitude: 21 + i / 1e5 }))

describe('lưu tạm + khôi phục bài chạy', () => {
  it('khôi phục bài dở dang; quá cũ hoặc quá ngắn thì bỏ', () => {
    const s = mem()
    saveSnapshot(state(), [pt], 0, 10_000, s)
    expect(loadSnapshot(20_000, s)).toMatchObject({ state: { distanceM: 2000 }, points: [pt] })
    expect(loadSnapshot(10_000 + SNAPSHOT_MAX_AGE_MS + 1, s)).toBeNull()
    saveSnapshot(state({ distanceM: 50, movingS: 20 }), [pt], 0, 10_000, s)
    expect(loadSnapshot(20_000, s)).toBeNull()
  })

  it('lưu theo khối: mỗi lần chỉ ghi lại khối cuối, đọc lại đủ điểm theo đúng thứ tự', () => {
    const m = new Map<string, string>()
    const writes: string[] = []
    const s = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { writes.push(k); m.set(k, v) }, removeItem: (k: string) => void m.delete(k) }
    const all = pts(250)
    let saved = saveSnapshot(state(), all.slice(0, 120), 0, 10_000, s)
    expect(saved).toBe(120)
    expect(writes).toEqual([`${SNAPSHOT_KEY}:0`, `${SNAPSHOT_KEY}:1`, SNAPSHOT_KEY])
    writes.length = 0
    saved = saveSnapshot(state(), all, saved, 11_000, s)
    expect(writes).toEqual([`${SNAPSHOT_KEY}:1`, `${SNAPSHOT_KEY}:2`, SNAPSHOT_KEY])    // khối 0 không ghi lại
    expect(loadSnapshot(12_000, s)!.points).toEqual(all)
    clearSnapshot(s)
    expect(m.size).toBe(0)
  })

  it('bộ nhớ đầy: báo chưa lưu được để lần sau ghi lại', () => {
    const s = { ...mem(), setItem: () => { throw new Error('QuotaExceededError') } }
    expect(saveSnapshot(state(), pts(10), 0, 10_000, s)).toBe(0)
  })

  it('đọc được bản lưu kiểu cũ (trước khi có lưu theo khối)', () => {
    const s = mem()
    s.setItem(SNAPSHOT_KEY, JSON.stringify({ v: 1, phase: 'PAUSED', startedAt: 1_000, savedAt: 10_000, elapsedS: 600, movingS: 590, distanceM: 2000, points: [pt], splits: [] }))
    expect(loadSnapshot(20_000, s)).toMatchObject({ state: { phase: 'PAUSED', distanceM: 2000, moved: true }, points: [pt] })
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

  it('bài của tài khoản khác trên cùng máy: không khôi phục, không đếm, không gửi', () => {
    const s = mem()
    saveSnapshot(state(), [pt], 0, 10_000, s, 'user-a')
    expect(loadSnapshot(20_000, s, 'user-b')).toBeNull()
    expect(loadSnapshot(20_000, s, 'user-a')).toMatchObject({ state: { distanceM: 2000 } })
    const p = { ...buildPayload({ startedAt: 1_000, endedAt: 2_000, elapsedS: 600, movingS: 600, distanceM: 2000, points: [pt] }) }
    enqueue(p, 5_000, s, undefined, 'user-a')
    enqueue({ ...p, p_started_at: 'legacy' }, 5_000, s)
    const q = loadQueue(6_000, s)
    expect(ownedBy(q, 'user-b').map((x) => x.id)).toEqual(['legacy'])
    expect(ownedBy(q, 'user-a')).toHaveLength(2)
    expect(ownedBy(q, null)).toEqual([])
  })
})
