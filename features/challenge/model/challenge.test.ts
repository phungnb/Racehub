import { describe, it, expect } from 'vitest'
import {
  challengePhase, defaultDraft, draftToPayload, formatScore, planStatus, rewardSummary, settlementDue, timeLabel, timeProgress,
  validateDraft,
} from './challenge'

const now = new Date('2026-10-10T00:00:00Z')
const c = (s: string, e: string, status = 'ACTIVE') => ({ start_date: s, end_date: e, status })

describe('trạng thái thử thách', () => {
  it('sắp diễn ra / đang diễn ra / đang tổng kết / đã kết thúc / đã hủy', () => {
    expect(challengePhase(c('2026-10-12T00:00:00Z', '2026-10-20T00:00:00Z'), now)).toBe('UPCOMING')
    expect(challengePhase(c('2026-10-01T00:00:00Z', '2026-10-20T00:00:00Z'), now)).toBe('LIVE')
    expect(challengePhase(c('2026-09-01T00:00:00Z', '2026-09-20T00:00:00Z'), now)).toBe('SETTLING')
    expect(challengePhase(c('2026-09-01T00:00:00Z', '2026-09-20T00:00:00Z', 'FINISHED'), now)).toBe('ENDED')
    expect(challengePhase(c('2026-10-12T00:00:00Z', '2026-10-20T00:00:00Z', 'CANCELLED'), now)).toBe('CANCELLED')
  })
  it('chỉ tất toán sau 2 giờ chờ bài đồng bộ muộn', () => {
    expect(settlementDue(c('2026-10-01T00:00:00Z', '2026-10-09T23:00:00Z'), now)).toBe(false)
    expect(settlementDue(c('2026-10-01T00:00:00Z', '2026-10-09T21:00:00Z'), now)).toBe(true)
    expect(settlementDue(c('2026-10-01T00:00:00Z', '2026-10-09T21:00:00Z', 'FINISHED'), now)).toBe(false)
  })
  it('nhãn thời gian', () => {
    expect(timeLabel(c('2026-10-01T00:00:00Z', '2026-10-15T00:00:00Z'), now)).toBe('Còn 5 ngày')
    expect(timeLabel(c('2026-10-01T00:00:00Z', '2026-10-10T03:00:00Z'), now)).toBe('Còn 3 giờ')
    expect(timeLabel(c('2026-10-01T00:00:00Z', '2026-10-10T00:20:00Z'), now)).toBe('Còn 20 phút')
    expect(timeLabel(c('2026-10-12T00:00:00Z', '2026-10-20T00:00:00Z'), now)).toBe('Bắt đầu sau 2 ngày')
    expect(timeLabel(c('2026-09-01T00:00:00Z', '2026-09-20T00:00:00Z'), now)).toBe('Đang tổng kết')
    expect(timeLabel(c('2026-09-01T00:00:00Z', '2026-09-20T00:00:00Z', 'FINISHED'), now)).toBe('Đã kết thúc')
  })
  it('tiến độ thời gian và so với kế hoạch', () => {
    const ch = { ...c('2026-10-05T00:00:00Z', '2026-10-15T00:00:00Z'), target_value: 100 }
    expect(timeProgress(ch, now)).toBeCloseTo(0.5)
    expect(planStatus(ch, 40, now)).toEqual({ expected: 50, diff: -10 })     // chậm 10 km
    expect(planStatus({ ...ch, target_value: 0 }, 40, now)).toBeNull()
  })
})

describe('định dạng', () => {
  it('điểm theo mục tiêu', () => {
    expect(formatScore('DISTANCE', 12.5)).toBe('12,5 km')
    expect(formatScore('RUNS', 4)).toBe('4 buổi')
    expect(formatScore('DURATION', 95.25)).toBe('95,3 phút')
    expect(formatScore('STREAK_DAYS', 7, false)).toBe('7')
  })
  it('mô tả phần thưởng', () => {
    expect(rewardSummary({ reward_xu: 0 })).toBeNull()
    expect(rewardSummary({ reward_xu: 500, reward_split: 'TOP3' })).toBe('500 Xu cho Top 3 (50% · 30% · 20%)')
    expect(rewardSummary({ reward_xu: 200, reward_split: 'FINISHERS', format: 'COLLECTIVE' })).toContain('cả cộng đồng')
  })
})

describe('tạo thử thách', () => {
  it('kiểm tra từng bước', () => {
    const d = defaultDraft(now)
    expect(validateDraft({ ...d, title: 'ab' }, 1, now)).toHaveProperty('title')
    expect(validateDraft({ ...d, title: 'Chạy tháng 10', audience: 'CLUB_ONLY', clubId: null }, 1, now)).toHaveProperty('clubId')
    expect(validateDraft({ ...d, format: 'SOLO_GOAL', targetValue: 0 }, 2, now)).toHaveProperty('targetValue')
    expect(validateDraft({ ...d, format: 'TEAM', teamNames: ['A', 'a'] }, 2, now)).toMatchObject({ teamNames: 'Tên đội bị trùng' })
    expect(validateDraft({ ...d, objective: 'STREAK_DAYS', minKm: 0 }, 2, now)).toHaveProperty('minKm')
    expect(validateDraft({ ...d, end: d.start }, 3, now)).toHaveProperty('end')
    expect(validateDraft({ ...d, format: 'TEAM', start: now.toISOString() }, 3, now)).toHaveProperty('start')
    expect(validateDraft({ ...d, title: 'Hợp lệ' }, 1, now)).toEqual({})
    expect(validateDraft(d, 3, now)).toEqual({})
  })
  it('chuyển thành payload: 1-1 luôn 2 người và riêng tư; không thưởng thì không có nguồn', () => {
    const p = draftToPayload({ ...defaultDraft(now), title: ' Solo ', format: 'DUEL' })
    expect(p).toMatchObject({ title: 'Solo', max_slots: 2, audience: 'INVITE_ONLY', reward_source: 'NONE', game_mode: null })
    const t = draftToPayload({ ...defaultDraft(now), format: 'TEAM', teamNames: [' Xanh ', '', 'Đỏ'] })
    expect(t).toMatchObject({ game_mode: 'TEAM_AVG', team_names: ['Xanh', 'Đỏ'] })
  })
})
