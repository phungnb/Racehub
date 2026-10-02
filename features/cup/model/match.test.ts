import { describe, it, expect } from 'vitest'
import type { Cup } from '../api/cupApi'
import { countdown, defaultTerms, duelLead, formatScore, rulesSummary, signupState, validateTerms } from './match'

const NOW = Date.parse('2026-10-02T10:00:00+07:00')
const base = {
  status: 'OPEN', require_signup: true, my_signup: null, rules_version: 2,
  start_at: '2026-10-05T00:00:00+07:00', end_at: '2026-10-12T00:00:00+07:00', roster_close_at: '2026-10-04T23:00:00+07:00',
  my_clubs: [{ id: 'A', name: 'Hồ Tây', avatar_url: null, accent_color: null, staff: false, joined: true, eligible: true }],
} as unknown as Cup

describe('thi đấu CLB — hàm thuần', () => {
  it('trạng thái đăng ký của tôi: đăng ký được / đã đăng ký / vào CLB muộn / đã chốt / chưa nhận lời', () => {
    expect(signupState(base, NOW)).toMatchObject({ kind: 'CAN_SIGN', clubId: 'A' })
    expect(signupState({ ...base, my_signup: 'A' }, NOW)).toMatchObject({ kind: 'SIGNED', canLeave: true })
    expect(signupState({ ...base, my_clubs: [{ ...base.my_clubs[0], eligible: false }] }, NOW).kind).toBe('NOT_ELIGIBLE')
    expect(signupState(base, Date.parse('2026-10-05T01:00:00+07:00')).kind).toBe('LOCKED')
    expect(signupState({ ...base, status: 'INVITED' }, NOW).kind).toBe('WAITING')
    expect(signupState({ ...base, require_signup: false }, NOW).kind).toBe('AUTO')
    expect(signupState({ ...base, my_clubs: [] }, NOW).kind).toBe('NOT_MEMBER')
  })

  it('điểm theo đơn vị: km / km mỗi người / thời gian / pace', () => {
    expect(formatScore({ measure: 'KM', format: 'TOTAL' }, 72.5)).toBe('72,5 km')
    expect(formatScore({ measure: 'KM', format: 'AVG' }, 12)).toBe('12 km/người')
    expect(formatScore({ measure: 'TIME', format: 'TOP' }, 5400)).toBe('1 giờ 30 phút')
    expect(formatScore({ measure: 'PACE', format: 'AVG' }, 305)).toBe('5:05/km')
    expect(formatScore({ measure: 'KM', format: 'AVG' }, null)).toBe('—')
  })

  it('ai đang dẫn: km cao hơn / pace thấp hơn / đối thủ thiếu người', () => {
    const st = (a: number, b: number, fa = false) => [
      { club_id: 'A', name: 'Hồ Tây', score: a, forfeited: fa }, { club_id: 'B', name: 'Sông Hồng', score: b, forfeited: false },
    ] as Cup['standings']
    expect(duelLead({ measure: 'KM', format: 'TOTAL', standings: st(72, 55) })).toEqual({ leaderId: 'A', text: 'Hồ Tây dẫn 17 km' })
    expect(duelLead({ measure: 'PACE', format: 'AVG', standings: st(320, 300) }).leaderId).toBe('B')
    expect(duelLead({ measure: 'KM', format: 'TOTAL', standings: st(90, 10, true) }).leaderId).toBe('B')
    expect(duelLead({ measure: 'KM', format: 'TOTAL', standings: st(10, 10) }).text).toBe('Đang hòa')
  })

  it('tóm tắt luật đủ ý; trận cũ không cần đăng ký', () => {
    const r = rulesSummary({ ...defaultTerms(NOW), kind: 'DUEL', rules_version: 2, final_delay_hours: 48 })
    expect(r[0]).toContain('Trung bình')
    expect(r.join(' ')).toContain('42 km/ngày')
    expect(r.join(' ')).toContain('xử thua')
    expect(rulesSummary({ ...defaultTerms(NOW), kind: 'DUEL', rules_version: null, final_delay_hours: 2 })[1]).toContain('không cần đăng ký')
  })

  it('điều khoản mặc định hợp lệ; chặn giờ chốt quá sát, top thiếu số người', () => {
    const t = defaultTerms(NOW)
    expect(validateTerms(t, NOW, 'DUEL')).toBeNull()
    expect(validateTerms({ ...t, start_at: new Date(NOW + 3600_000).toISOString() }, NOW, 'DUEL')).toContain('chốt danh sách')
    expect(validateTerms({ ...t, format: 'TOP', top_n: null }, NOW, 'DUEL')).toContain('top')
    expect(validateTerms({ ...t, end_at: new Date(Date.parse(t.start_at) + 70 * 86400_000).toISOString() }, NOW, 'DUEL')).toContain('2 tháng')
  })

  it('đếm ngược', () => {
    expect(countdown('2026-10-03T13:00:00+07:00', NOW)).toBe('còn 1 ngày 3 giờ')
    expect(countdown('2026-10-02T10:45:00+07:00', NOW)).toBe('còn 45 phút')
    expect(countdown('2026-10-01T10:00:00+07:00', NOW)).toBe('đã qua')
  })
})
