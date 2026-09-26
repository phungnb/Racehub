// Tường nhà CLB Pro (migration 008100): chủ đề nền + kiểm tra Pro còn hạn
import type { Club, ClubTheme } from '../api/clubApi'

export const CLUB_THEMES: Record<ClubTheme, { label: string; bg: string }> = {
  AURORA: { label: 'Cực quang', bg: 'linear-gradient(135deg, #0f766e 0%, #6d28d9 55%, #0b1020 100%)' },
  SUNSET: { label: 'Hoàng hôn', bg: 'linear-gradient(135deg, #f97316 0%, #db2777 55%, #1e1b4b 100%)' },
  OCEAN: { label: 'Đại dương', bg: 'linear-gradient(135deg, #0ea5e9 0%, #1d4ed8 55%, #0b1020 100%)' },
  FOREST: { label: 'Rừng xanh', bg: 'linear-gradient(135deg, #65a30d 0%, #047857 55%, #0b1020 100%)' },
  GOLD: { label: 'Hoàng kim', bg: 'linear-gradient(135deg, #facc15 0%, #b45309 55%, #1c1308 100%)' },
  NIGHT: { label: 'Đêm thành phố', bg: 'linear-gradient(135deg, #334155 0%, #0f172a 60%, #020617 100%)' },
}

export const isProActive = (c: Pick<Club, 'plan' | 'pro_until'>, now = Date.now()) =>
  c.plan === 'PRO' && (!c.pro_until || Date.parse(c.pro_until) > now)
