import { describe, expect, it } from 'vitest'
import { buildCascade, cascadeStepMs, gameIcon, leagueTier, questProgressLabel, ratio, timeLeft, type GameEvent } from './game'
import { Target, Flame } from 'lucide-react'

const ev = (kind: GameEvent['kind'], i: number, xu = 0, xp = 0): GameEvent =>
  ({ id: `${kind}-${i}`, kind, title: kind === 'QUEST' ? `Nhiệm vụ: Q${i}` : kind, subtitle: null, xu, xp, payload: {}, created_at: `2026-10-01T00:00:0${i}Z` })

describe('lớp game — hàm thuần', () => {
  it('chuỗi phần thưởng: bài chạy đầu, lên cấp cuối, tối đa 6 thẻ (gộp nhiệm vụ)', () => {
    const c = buildCascade([ev('LEVEL_UP', 1), ev('BADGE', 2), ev('RUN', 3), ev('QUEST', 4)])
    expect(c.map((e) => e.kind)).toEqual(['RUN', 'QUEST', 'BADGE', 'LEVEL_UP'])
    const many = buildCascade([ev('RUN', 0), ev('QUEST', 1, 1, 30), ev('QUEST', 2, 0.5, 5), ev('QUEST', 3, 10, 150),
      ev('STREAK', 4), ev('BADGE', 5), ev('BADGE', 6), ev('LEVEL_UP', 7)])
    expect(many).toHaveLength(6)
    expect(many[1]).toMatchObject({ title: 'Hoàn thành 3 nhiệm vụ', xu: 11.5, xp: 185, subtitle: 'Q1 · Q2 · Q3' })
    expect(many.at(-1)!.kind).toBe('LEVEL_UP')
    expect(buildCascade([ev('RUN', 0), ...[1, 2, 3, 4, 5, 6, 7].map((i) => ev('BADGE', i))])).toHaveLength(6)
  })
  it('tổng thời gian chuỗi ≤ 6 giây', () => {
    for (const n of [1, 3, 6]) expect(cascadeStepMs(n) * n).toBeLessThanOrEqual(6000)
  })
  it('nhãn tiến độ, tỉ lệ, icon, hạng, thời gian còn lại', () => {
    expect(questProgressLabel({ metric: 'WEEK_KM', progress: 12.345, target: 30 })).toBe('12,3/30 km')
    expect(questProgressLabel({ metric: 'WEEK_RUN_DAYS', progress: 2, target: 5 })).toBe('2/5')
    expect(ratio(5, 3)).toBe(1)
    expect(gameIcon('Flame')).toBe(Flame)
    expect(gameIcon('KhongCo')).toBe(Target)
    expect(leagueTier(9).name).toBe('Kim cương')
    expect(timeLeft('2026-10-05T00:00:00Z', Date.parse('2026-10-02T19:00:00Z'))).toBe('2 ngày 5 giờ')
    expect(timeLeft('2026-10-05T00:00:00Z', Date.parse('2026-10-06T00:00:00Z'))).toBe('đang chốt')
  })
})
