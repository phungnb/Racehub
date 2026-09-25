// Lớp game: mọi thao tác qua RPC (migration 000800). Client chỉ đọc và hiển thị.
import { supabase } from '@/shared/lib/supabase'
import type { Achievement, GameEvent, GameState, LeagueRow, Wallet } from '../model/game'

const n = (v: unknown) => Number(v ?? 0)
const toEvent = (e: GameEvent): GameEvent => ({ ...e, xu: n(e.xu), xp: n(e.xp), payload: e.payload ?? {} })

export async function getGameState(): Promise<GameState> {
  const { data, error } = await supabase.rpc('my_game_state')
  if (error) throw error
  const s = data as GameState
  return {
    ...s,
    week: { km: n(s.week?.km), runs: n(s.week?.runs), days: n(s.week?.days) },
    quests: (s.quests ?? []).map((q) => ({ ...q, target: n(q.target), progress: n(q.progress), reward_xu: n(q.reward_xu), reward_xp: n(q.reward_xp) })),
    streak: { ...s.streak, shield_price: n(s.streak?.shield_price) },
    league: { ...s.league, points: s.league?.points === undefined ? undefined : n(s.league.points) },
    unseen: (s.unseen ?? []).map(toEvent),
  }
}

export async function checkIn() {
  const { error } = await supabase.rpc('daily_checkin')
  if (error) throw error
}

export async function setWeeklyGoal(goal: number) {
  const { error } = await supabase.rpc('set_weekly_goal', { p_goal: goal })
  if (error) throw error
}

export async function buyShield(key: string) {
  const { data, error } = await supabase.rpc('buy_streak_shield', { p_idempotency_key: key })
  if (error) throw error
  return data as { shields: number; balance?: number; duplicate?: boolean }
}

/* ------------------------- Quà tặng (migration 003900) ------------------------- */
// Quà đốt Xu của người tặng (người nhận không nhận Xu) → không có đường chuyển Xu P2P.

export type GiftTier = 'CHEER' | 'BOOST' | 'HYPE' | 'LEGEND'
export interface Gift {
  code: string; name: string; emoji: string; price_xu: number; tier: GiftTier; description: string | null
  vip_tier: number; seasonal: boolean; locked: boolean
}
export interface GiftCatalog { gifts: Gift[]; daily_cap: number; sent_today: number }
export interface GiftWall {
  shine: number; count: number
  gifts: { code: string; name: string; emoji: string; tier: GiftTier; count: number }[]
  top_supporters: { user_id: string; display_name: string | null; avatar_url: string | null; shine: number }[]
}

export async function getGiftCatalog(): Promise<GiftCatalog> {
  const { data, error } = await supabase.rpc('gift_catalog')
  if (error) throw error
  const c = (data ?? {}) as GiftCatalog
  return {
    gifts: (c.gifts ?? []).map((g) => ({ ...g, price_xu: n(g.price_xu), vip_tier: n(g.vip_tier) })),
    daily_cap: n(c.daily_cap), sent_today: n(c.sent_today),
  }
}

export async function sendGift(input: { toUser: string; code: string; qty: number; message?: string; postId?: string | null; activityId?: string | null; key: string }) {
  const { data, error } = await supabase.rpc('send_gift', {
    p_to_user: input.toUser, p_gift_code: input.code, p_qty: input.qty, p_message: input.message || null,
    p_post_id: input.postId ?? null, p_activity_id: input.activityId ?? null, p_idempotency_key: input.key,
  })
  if (error) throw error
  return data as { gift_id: string; total_xu?: number; emoji?: string; tier?: GiftTier; qty?: number; balance?: number; duplicate?: boolean }
}

export async function getGiftWall(userId: string): Promise<GiftWall> {
  const { data, error } = await supabase.rpc('gift_wall', { p_user: userId })
  if (error) throw error
  const w = (data ?? {}) as GiftWall
  return {
    shine: n(w.shine), count: n(w.count),
    gifts: (w.gifts ?? []).map((g) => ({ ...g, count: n(g.count) })),
    top_supporters: (w.top_supporters ?? []).map((t) => ({ ...t, shine: n(t.shine) })),
  }
}

export async function getActivityRewards(activityId: string): Promise<GameEvent[]> {
  const { data, error } = await supabase.rpc('activity_rewards', { p_activity_id: activityId })
  if (error) throw error
  return ((data ?? []) as GameEvent[]).map(toEvent)
}

export async function markEventsSeen(ids: string[] | null) {
  const { error } = await supabase.rpc('mark_game_events_seen', { p_ids: ids })
  if (error) throw error
}

export async function getAchievements(): Promise<Achievement[]> {
  const { data, error } = await supabase.rpc('my_achievements')
  if (error) throw error
  return ((data ?? []) as Achievement[]).map((a) => ({ ...a, target: n(a.target), progress: n(a.progress), xu_reward: n(a.xu_reward) }))
}

export async function getLeagueStandings(groupId: string): Promise<LeagueRow[]> {
  const { data, error } = await supabase.rpc('league_standings', { p_group_id: groupId })
  if (error) throw error
  return ((data ?? []) as LeagueRow[]).map((r) => ({ ...r, points: n(r.points) }))
}

export async function getWallet(before?: string | null): Promise<Wallet> {
  const { data, error } = await supabase.rpc('my_wallet', { p_before: before ?? null, p_limit: 30 })
  if (error) throw error
  const w = data as Wallet
  return {
    bonus: n(w.bonus), paid: n(w.paid), total: n(w.total),
    items: (w.items ?? []).map((i) => ({ ...i, amount: n(i.amount) })),
  }
}

const MESSAGES: Record<string, string> = {
  CANNOT_GIFT_SELF: 'Không tự tặng quà cho chính mình được.',
  GIFT_DAILY_LIMIT: 'Bạn đã tặng quà tối đa trong hôm nay. Mai tiếp nhé!',
  GIFT_NOT_AVAILABLE: 'Quà này hiện không còn (hết mùa hoặc đã ngừng).',
  VIP_REQUIRED: 'Quà này dành cho thành viên VIP.',
  INVALID_QTY: 'Số lượng quà không hợp lệ.',
  CHEER_REPLACED_BY_GIFTS: 'Tặng Xu trực tiếp đã được thay bằng Quà tặng. Hãy cập nhật ứng dụng.',
  INSUFFICIENT_BALANCE: 'Số Xu trong ví không đủ.',
  SHIELD_LIMIT: 'Bạn đã có số khiên tối đa.',
  INVALID_AMOUNT: 'Số Xu không hợp lệ (1–10).',
  INVALID_GOAL: 'Mục tiêu tuần từ 1 đến 7 ngày.',
  MESSAGE_TOO_LONG: 'Lời nhắn tối đa 140 ký tự.',
  USER_NOT_FOUND: 'Không tìm thấy người nhận.',
  FORBIDDEN: 'Bạn không có quyền làm việc này.',
}

export function gameErrorMessage(e: unknown): string {
  const err = e as { message?: string; code?: string } | null
  console.warn('[Game] Lỗi gốc:', err?.code, err?.message)
  const raw = err?.message ?? ''
  const key = Object.keys(MESSAGES).find((k) => raw.includes(k))
  return key ? MESSAGES[key] : 'Không thực hiện được. Hãy thử lại.'
}

/* ------------------------- Phong độ (migration 004200) ------------------------- */
export type FormStatus = 'NEW' | 'RISING' | 'STEADY' | 'SLOWING' | 'RESTING' | 'LONG_BREAK'
export interface RunnerForm { status: FormStatus; last_run_at: string | null; days_since: number | null; km_28d: number; km_prev_28d: number; runs_28d: number; comeback_xu: number; comeback_days: number }
export async function getRunnerForm(userId?: string | null): Promise<RunnerForm> {
  const { data, error } = await supabase.rpc('runner_form', { p_user: userId ?? null })
  if (error) throw error
  const f = (data ?? {}) as RunnerForm
  return { ...f, km_28d: n(f.km_28d), km_prev_28d: n(f.km_prev_28d), runs_28d: n(f.runs_28d), comeback_xu: n(f.comeback_xu), comeback_days: n(f.comeback_days) }
}
