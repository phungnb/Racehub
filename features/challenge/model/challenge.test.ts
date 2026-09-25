import { describe, it, expect } from 'vitest'
import * as m from './challenge'
import {
  challengePhase, defaultDraft, draftToPayload, formatScore, planStatus, rewardSummary, settlementDue, timeLabel, timeProgress,
  validateDraft,
  draftFromTemplate,
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

describe('mục tiêu tự đăng ký', () => {
  it('số tuần ISO và thứ Hai theo giờ VN', () => {
    expect(m.isoWeek(new Date('2026-09-24T03:00:00Z'))).toBe(39)
    expect(m.isoWeek(new Date('2026-01-01T03:00:00Z'))).toBe(1)
    // 23:30 Chủ nhật giờ UTC = 06:30 thứ Hai giờ VN → đã sang tuần mới
    expect(m.isoWeek(new Date('2026-09-27T23:30:00Z'))).toBe(40)
    expect(m.vnMonday(new Date('2026-09-24T03:00:00Z')).toISOString()).toBe('2026-09-20T17:00:00.000Z')
    expect(m.vnMonday(new Date('2026-09-24T03:00:00Z'), true).toISOString()).toBe('2026-09-27T17:00:00.000Z')
  })
  it('mẫu thử thách tuần: thứ Năm → lấy tuần sau; tên theo số tuần', () => {
    const p = m.weeklyPreset(new Date('2026-09-24T03:00:00Z'), 'club-1')
    expect(p).toMatchObject({ title: 'Thử thách tuần 40', format: 'SOLO_GOAL', audience: 'CLUB_ONLY', clubId: 'club-1' })
    expect(p.start).toBe('2026-09-27T17:00:00.000Z')
    expect(Date.parse(p.end!) - Date.parse(p.start!)).toBe(7 * 86_400_000)
  })
  it('kiểm tra + dữ liệu gửi lên; thử thách cá nhân lấy mốc thấp nhất làm mục tiêu chung', () => {
    const d = { ...m.defaultDraft(new Date('2026-09-24T03:00:00Z')), ...m.weeklyPreset(new Date('2026-09-24T03:00:00Z'), 'c') } as m.ChallengeDraft
    expect(m.validatePledge({ ...d.pledge, options: [0] })).toBe('Mốc từ 1 đến 5.000 km')
    expect(m.validatePledge({ ...d.pledge, options: [], minKm: 50, maxKm: 10 })).toBe('Khoảng mục tiêu không hợp lệ')
    expect(m.pledgePayload({ ...d.pledge, options: [60, 21, 42, 21] })).toEqual({ options: [21, 42, 60], min_km: null, max_km: null, cap_pct: null, team_size: null })
    expect(m.draftToPayload(d)).toMatchObject({ target_value: 21, max_slots: 50 })
    const t = { ...d, ...m.teamPledgePreset(new Date('2026-09-24T03:00:00Z'), 'c') } as m.ChallengeDraft
    expect(m.draftToPayload({ ...t, gameMode: 'TEAM_AVG' })).toMatchObject({ game_mode: 'TEAM_SUM', target_value: 0, team_names: ['Đội 1', 'Đội 2'], team_size: 0 })
    expect(m.pledgePayload({ ...t.pledge, options: [21, 42] }, true)).toMatchObject({ team_size: 5, options: null, min_km: 1, max_km: 1000 })   // đua đội: thành viên tự nhập km
    expect(m.validateDraft({ ...t, pledge: { ...t.pledge, teamSize: 1 } }, 2)).toHaveProperty('teamSize')
    expect(m.validateDraft({ ...t, teamNames: [] }, 2)).not.toHaveProperty('teamNames')
  })
  it('số đội = số người đăng ký ÷ số người mỗi đội (làm tròn, ít nhất 2)', () => {
    expect(m.plannedTeams(20, 5)).toBe(4)
    expect(m.plannedTeams(17, 5)).toBe(3)
    expect(m.plannedTeams(6, 5)).toBe(2)
  })
  it('km được tính tối đa mục tiêu × (1 + % vượt)', () => {
    expect(m.cappedKm(50, 30, 20)).toBe(36)
    expect(m.cappedKm(50, 30, null)).toBe(50)
    expect(m.cappedKm(20, 30, 20)).toBe(20)
  })
})

describe('nhân bản thử thách cũ (VIP2)', () => {
  const t = {
    title: 'Tuần 50 km', description: null, format: 'TEAM', objective: 'DISTANCE', game_mode: 'TEAM_SUM', target_value: '50', min_km: '2',
    min_pace: '3', max_pace: '12', daily_cap_km: null, require_hr: true, max_slots: 20, audience: 'CLUB_ONLY', club_id: 'c1', team_size: 5,
    reward_xu: '300', reward_split: 'TOP3', days: 14, team_names: ['Xanh', 'Đỏ'],
    pledge: { enabled: false, options: [], min_km: null, max_km: null, cap_pct: null, team_size: null },
  }
  it('giữ luật, dời thời gian từ giờ tới đúng số ngày; CLB chỉ giữ khi mình còn là ban quản trị', () => {
    const now = new Date('2026-09-24T10:20:00Z')
    const d = draftFromTemplate(t, ['c1'], now)
    expect(d).toMatchObject({ format: 'TEAM', targetValue: 50, minKm: 2, maxPace: 12, requireHr: true, maxSlots: 20, teamSize: 5,
      audience: 'CLUB_ONLY', clubId: 'c1', rewardXu: 300, rewardSource: 'CLUB', rewardSplit: 'TOP3', teamNames: ['Xanh', 'Đỏ'] })
    expect((Date.parse(d.end) - Date.parse(d.start)) / 86_400_000).toBe(14)
    expect(Date.parse(d.start)).toBeGreaterThan(now.getTime())
    const lost = draftFromTemplate(t, [], now)
    expect(lost).toMatchObject({ audience: 'PUBLIC', clubId: null, rewardXu: 0, rewardSource: 'NONE' })
  })
})
