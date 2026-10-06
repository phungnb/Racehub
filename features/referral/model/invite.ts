// Nội dung lời mời giới thiệu: dựng từ luật thưởng hiện hành máy chủ trả về (my_referral.rules ← economy_config.referral),
// không ghi số cứng — admin đổi chính sách thì chữ ở trang chủ / trang Mời bạn bè đổi theo.
import { formatCoin, formatNumber } from '@/shared/lib/format'
import type { MyReferral } from '../api/referralApi'

type Rules = MyReferral['rules']

/** "Khi bạn mới chạy đủ 3 km (cộng dồn): bạn nhận 20 Xu, bạn mới nhận 10 Xu." — km cộng dồn các bài hợp lệ (private.referral_on_run) */
export function inviteRewardText(rules: Rules | null | undefined): string {
  if (!rules) return 'Rủ bạn chạy cùng — cả hai nhận Xu khi bạn mới chạy đủ những km đầu tiên.'
  const parts = [
    rules.inviter_xu > 0 ? `bạn nhận ${formatCoin(rules.inviter_xu)} Xu` : null,
    rules.referee_xu > 0 ? `bạn mới nhận ${formatCoin(rules.referee_xu)} Xu` : null,
  ].filter(Boolean)
  if (!parts.length) return 'Rủ bạn bè chạy cùng trên RaceHub.'
  return `Khi bạn mới chạy đủ ${formatNumber(rules.min_km)} km (cộng dồn): ${parts.join(', ')}.`
}

/** Tin nhắn gửi kèm link mời (Zalo, Messenger…) */
export function inviteMessage(code: string, link: string, refereeXu: number): string {
  return `Chạy cùng mình trên RaceHub nhé! Mã giới thiệu ${code}${refereeXu > 0 ? ` — nhận ${formatCoin(refereeXu)} Xu chào mừng` : ''}: ${link}`
}
