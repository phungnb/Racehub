// Lớp game (migration 000800): kiểu dữ liệu + hàm thuần cho giao diện.
import {
  Award, CalendarCheck, CalendarDays, Crown, Flag, Flame, Footprints, Gem, Globe2, HandHeart, Map, Medal, Milestone, Moon,
  Repeat, Route, Shield, Sparkles, Star, Sunrise, Target, Trophy, Users, type LucideIcon,
} from 'lucide-react'

export type QuestPeriod = 'DAILY' | 'WEEKLY'
export type GameEventKind = 'RUN' | 'QUEST' | 'BADGE' | 'STREAK' | 'LEVEL_UP' | 'LEAGUE' | 'CHEER_IN'
export type BadgeTier = 'BRONZE' | 'SILVER' | 'GOLD' | 'LEGEND'
export type LeagueZone = 'UP' | 'STAY' | 'DOWN'

export interface Quest {
  id: string
  code: string
  period: QuestPeriod
  metric: string
  title: string
  description: string | null
  icon: string
  target: number
  progress: number
  completed: boolean
  reward_xu: number
  reward_xp: number
}

export interface GameEvent {
  id: string
  kind: GameEventKind
  title: string
  subtitle: string | null
  xu: number
  xp: number
  activity_id?: string | null
  payload: Record<string, unknown>
  created_at: string
}

export interface StreakState {
  goal: number
  week_days: number
  done_this_week: boolean
  current: number
  best: number
  alive: boolean
  at_risk_weeks: number
  shields: number
  max_shields: number
  shield_price: number
  daily: number
}

export interface LeagueState {
  group_id: string | null
  tier: number
  tier_name: string
  size?: number
  rank?: number
  points?: number
  promote?: number
  demote?: number
  ends_at?: string
}

export interface GameState {
  today: string
  week_start: string
  checked_in: boolean
  week: { km: number; runs: number; days: number }
  streak: StreakState
  quests: Quest[]
  league: LeagueState
  unseen: GameEvent[]
}

export interface Achievement {
  code: string
  title: string
  description: string | null
  category: string
  tier: BadgeTier
  icon: string
  xp_reward: number
  xu_reward: number
  target: number
  progress: number
  unlocked_at: string | null
}

export interface LeagueRow {
  rank: number
  user_id: string
  display_name: string
  avatar_url: string | null
  level: number
  points: number
  zone: LeagueZone
  is_me: boolean
}

export interface WalletItem {
  id: string
  type: string
  reason: string | null
  created_at: string
  amount: number
  by_kind: Partial<Record<'BONUS' | 'PAID', number>>
}

export interface Wallet {
  bonus: number
  paid: number
  total: number
  items: WalletItem[]
}

const ICONS: Record<string, LucideIcon> = {
  Award, CalendarCheck, CalendarDays, Crown, Flag, Flame, Footprints, Gem, Globe2, HandHeart, Map, Medal, Milestone, Moon,
  Repeat, Route, Shield, Sparkles, Star, Sunrise, Target, Trophy, Users,
}
/** Tên icon lưu trong DB → component (không có thì dùng Target) */
export const gameIcon = (name: string | null | undefined): LucideIcon => (name && ICONS[name]) || Target

/** Màu theo bậc huy hiệu (token trong globals.css) */
export const TIER_META: Record<BadgeTier, { label: string; text: string; bg: string; ring: string }> = {
  BRONZE: { label: 'Đồng', text: 'text-medal-bronze', bg: 'bg-medal-bronze/15', ring: 'ring-medal-bronze/50' },
  SILVER: { label: 'Bạc', text: 'text-medal-silver', bg: 'bg-medal-silver/15', ring: 'ring-medal-silver/50' },
  GOLD: { label: 'Vàng', text: 'text-medal-gold', bg: 'bg-medal-gold/15', ring: 'ring-medal-gold/50' },
  LEGEND: { label: 'Huyền thoại', text: 'text-rarity-epic', bg: 'bg-rarity-epic/15', ring: 'ring-rarity-epic/50' },
}

/** Hạng league 1–5 */
export const LEAGUE_TIERS = [
  { tier: 1, name: 'Đồng', text: 'text-medal-bronze', bg: 'bg-medal-bronze/15' },
  { tier: 2, name: 'Bạc', text: 'text-medal-silver', bg: 'bg-medal-silver/15' },
  { tier: 3, name: 'Vàng', text: 'text-medal-gold', bg: 'bg-medal-gold/15' },
  { tier: 4, name: 'Bạch kim', text: 'text-xp', bg: 'bg-xp/15' },
  { tier: 5, name: 'Kim cương', text: 'text-rarity-epic', bg: 'bg-rarity-epic/15' },
] as const
export const leagueTier = (tier: number | null | undefined) => LEAGUE_TIERS[Math.min(5, Math.max(1, tier ?? 1)) - 1]

export const CATEGORY_LABEL: Record<string, string> = {
  DISTANCE: 'Quãng đường', RACE: 'Cự ly', HABIT: 'Thói quen', CHALLENGE: 'Thử thách', SOCIAL: 'Cộng đồng', LEVEL: 'Cấp độ',
}

/** Tỉ lệ hoàn thành 0–1 */
export const ratio = (progress: number, target: number) => (target > 0 ? Math.min(1, Math.max(0, progress / target)) : 0)

/** Hiển thị tiến độ nhiệm vụ: km có số lẻ, còn lại số nguyên */
export function questProgressLabel(q: Pick<Quest, 'metric' | 'progress' | 'target'>) {
  const km = q.metric === 'RUN_KM' || q.metric === 'WEEK_KM'
  const f = (n: number) => (km ? n.toLocaleString('vi-VN', { maximumFractionDigits: 1 }) : String(Math.floor(n)))
  return `${f(q.progress)}/${f(q.target)}${km ? ' km' : ''}`
}

/** Thứ tự thẻ trong màn tổng kết: bài chạy → nhiệm vụ → streak → huy hiệu → league → cổ vũ → lên cấp (đỉnh điểm) */
const ORDER: Record<GameEventKind, number> = { RUN: 0, QUEST: 1, STREAK: 2, BADGE: 3, LEAGUE: 4, CHEER_IN: 5, LEVEL_UP: 6 }
export const MAX_CASCADE = 6

/** Tối đa 6 thẻ; quá nhiều nhiệm vụ thì gộp thành một thẻ */
export function buildCascade(events: GameEvent[]): GameEvent[] {
  const sorted = [...events].sort((a, b) => ORDER[a.kind] - ORDER[b.kind] || a.created_at.localeCompare(b.created_at))
  if (sorted.length <= MAX_CASCADE) return sorted
  const quests = sorted.filter((e) => e.kind === 'QUEST')
  const rest = sorted.filter((e) => e.kind !== 'QUEST')
  const merged: GameEvent[] = quests.length > 1
    ? [{ ...quests[0], id: `quests-${quests[0].id}`, title: `Hoàn thành ${quests.length} nhiệm vụ`,
         subtitle: quests.map((q) => q.title.replace(/^Nhiệm vụ: /, '')).join(' · '),
         xu: quests.reduce((s, q) => s + q.xu, 0), xp: quests.reduce((s, q) => s + q.xp, 0) }]
    : quests
  const all = [...merged, ...rest].sort((a, b) => ORDER[a.kind] - ORDER[b.kind])
  if (all.length <= MAX_CASCADE) return all
  // Vẫn quá: giữ thẻ đầu (bài chạy) và các thẻ cuối (quan trọng nhất)
  return [all[0], ...all.slice(all.length - (MAX_CASCADE - 1))]
}

/** Thời gian mỗi thẻ để cả chuỗi ≤ 6 giây */
export const cascadeStepMs = (n: number) => (n <= 1 ? 1500 : Math.min(1500, Math.floor(6000 / n)))

/** Nhãn loại giao dịch trong ví */
export const WALLET_LABEL: Record<string, string> = {
  RUN_REWARD: 'Thưởng bài chạy', RUN_REWARD_REVERSAL: 'Thu hồi thưởng bài chạy', GAME_QUEST: 'Nhiệm vụ', GAME_BADGE: 'Huy hiệu',
  GAME_LEAGUE: 'Thưởng league', GAME_STREAK: 'Chuỗi tuần', GAME_REVERSAL: 'Thu hồi thưởng', CHEER: 'Cổ vũ', SHOP_SHIELD: 'Mua khiên giữ chuỗi',
  CHALLENGE_CREATION_FEE: 'Phí tạo thử thách', CHALLENGE_ESCROW: 'Treo thưởng thử thách', CHALLENGE_PRIZE: 'Thưởng thử thách',
  CHALLENGE_REFUND: 'Hoàn tiền thử thách', CLUB_CONTRIBUTION: 'Góp quỹ CLB', ADMIN_GRANT: 'RaceHub tặng', ADMIN_DEDUCT: 'RaceHub điều chỉnh', ADMIN_ADJUST: 'RaceHub điều chỉnh',
  CLUB_FUND_TOPUP: 'Nạp quỹ CLB', IAP_TOPUP_VND: 'Nạp Xu',
  REFERRAL_INVITER: 'Thưởng giới thiệu', REFERRAL_REFEREE: 'Thưởng được mời', OPENING_BALANCE: 'Số dư đầu kỳ',
}
export const walletLabel = (type: string) => WALLET_LABEL[type] ?? 'Giao dịch'

/** Thời gian còn lại tới hết tuần, ví dụ "2 ngày 5 giờ" */
export function timeLeft(endsAt: string, now = Date.now()) {
  const ms = Date.parse(endsAt) - now
  if (!(ms > 0)) return 'đang chốt'
  const h = Math.floor(ms / 3_600_000)
  if (h >= 24) return `${Math.floor(h / 24)} ngày ${h % 24} giờ`
  if (h >= 1) return `${h} giờ`
  return `${Math.max(1, Math.floor(ms / 60_000))} phút`
}
