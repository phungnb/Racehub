import { describe, expect, it } from 'vitest'
import { bestEfforts, fmtDuration, fmtPace, paceHistogram, summarize, toCsv, type PerfRun } from './insights'

const run = (id: string, km: number, moving_s: number, splits: number[] = []): PerfRun => ({ id, started_at: '2026-09-01T00:00:00Z', title: id, km, moving_s, splits })

describe('phân tích VIP', () => {
  it('kỷ lục: đoạn km liên tiếp nhanh nhất; không có từng km thì ước tính từ pace trung bình', () => {
    const e = bestEfforts([
      run('a', 5.2, 1600, [320, 300, 290, 310, 305]),
      run('b', 10.5, 3150, [300, 300, 300, 300, 300, 300, 300, 300, 300, 300]),
      run('c', 22, 7040),
    ])
    const by = Object.fromEntries(e.map((x) => [x.key, x]))
    expect(by['1k']).toMatchObject({ seconds: 290, runId: 'a', estimated: false })
    expect(by['5k']).toMatchObject({ seconds: 1500, runId: 'b' })
    expect(by['10k']).toMatchObject({ seconds: 3000, runId: 'b', estimated: false })
    expect(by.hm).toMatchObject({ runId: 'c', estimated: true, seconds: Math.round(7040 * 21.0975 / 22) })
    expect(by.fm).toBeUndefined()
  })
  it('phân bố pace theo ô 15 giây', () => {
    const h = paceHistogram([run('a', 2, 600, [290, 305]), run('b', 3, 1080)])
    expect(h.find((b) => b.from === 285)?.count).toBe(1)
    expect(h.find((b) => b.from === 300)?.count).toBe(1)
    expect(h.find((b) => b.from === 360)?.count).toBe(3)
  })
  it('định dạng và CSV cho Excel', () => {
    expect(fmtDuration(3725)).toBe('1:02:05')
    expect(fmtPace(305)).toBe('5:05')
    const csv = toCsv([{ started_at: '2026-09-01T00:30:00Z', title: 'Chạy, sáng', source: 'STRAVA', km: 5.25, moving_s: 1575, elapsed_s: 1600, elev_m: 12, avg_hr: 150, xu: 7.5, xp: 52 }])
    expect(csv.startsWith('﻿Ngày,')).toBe(true)
    expect(csv).toContain('"Chạy, sáng"')
    expect(csv).toContain('"5,25"')
    expect(csv).toContain('26:15')
    const s = summarize([{ started_at: '2026-09-01T00:30:00Z', title: null, source: null, km: 5, moving_s: 1500, elapsed_s: 0, elev_m: 0, avg_hr: null, xu: 0, xp: 0 },
      { started_at: '2026-10-02T00:30:00Z', title: null, source: null, km: 10, moving_s: 3300, elapsed_s: 0, elev_m: 0, avg_hr: null, xu: 0, xp: 0 }])
    expect(s).toMatchObject({ runs: 2, km: 15, longest: 10, pace: 320 })
    expect(s.months.map((m) => m.month)).toEqual(['2026-09', '2026-10'])
  })
})
