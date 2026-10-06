import { describe, expect, it } from 'vitest'
import { inviteMessage, inviteRewardText } from './invite'

const rules = { inviter_xu: 20, referee_xu: 10, min_km: 3, monthly_cap: 10 }

describe('lời mời giới thiệu', () => {
  it('nói đúng luật thưởng theo cấu hình (không số cứng)', () => {
    expect(inviteRewardText(rules)).toBe('Khi bạn mới chạy đủ 3 km (cộng dồn): bạn nhận 20 Xu, bạn mới nhận 10 Xu.')
    const changed = inviteRewardText({ ...rules, min_km: 5, inviter_xu: 50 })
    expect(changed).toContain('đủ 5 km')
    expect(changed).toContain('bạn nhận 50 Xu')
    expect(inviteRewardText({ ...rules, referee_xu: 0 })).toBe('Khi bạn mới chạy đủ 3 km (cộng dồn): bạn nhận 20 Xu.')
  })

  it('tắt thưởng / chưa tải được luật: không hứa con số cụ thể', () => {
    expect(inviteRewardText({ ...rules, inviter_xu: 0, referee_xu: 0 })).not.toMatch(/\d/)
    expect(inviteRewardText(null)).not.toMatch(/\d/)
  })

  it('tin nhắn mời kèm mã + link; chỉ nhắc Xu chào mừng khi có', () => {
    expect(inviteMessage('K7M2Q9XA', 'https://racehub.vn/join/K7M2Q9XA', 10))
      .toBe('Chạy cùng mình trên RaceHub nhé! Mã giới thiệu K7M2Q9XA — nhận 10 Xu chào mừng: https://racehub.vn/join/K7M2Q9XA')
    expect(inviteMessage('K7M2Q9XA', 'https://x.vn/join/K7M2Q9XA', 0)).not.toContain('Xu')
  })
})
