// Công cụ admin: mọi thao tác đi qua RPC kiểm tra quyền is_system_admin (migration 000700).
import { supabase } from '@/shared/lib/supabase'
import { toPolicy, type EconomyPolicy } from '@/shared/lib/economy'

export type AccountKind = 'USER' | 'CLUB'

export interface AccountHit {
  kind: AccountKind
  id: string
  name: string
  subtitle: string
  balance: number
}

export interface AuditEntry {
  id: string
  action: string
  target: string
  new_value: Record<string, unknown> | null
  reason: string | null
  created_at: string
  actor: string | null
}

export interface EconomyOverview {
  policy: EconomyPolicy
  rawPolicy: Record<string, unknown>
  wallets: number
  treasuries: number
  escrow: number
  minted30d: number
  granted30d: number
  fees30d: number
  activePasses: number
  recent: AuditEntry[]
}

export interface Pass {
  id: string
  owner_type: AccountKind
  owner_id: string
  owner_name: string | null
  max_slots: number
  remaining: number
  total: number
  expires_at: string | null
  note: string | null
  created_at: string
}

export interface PendingActivity {
  id: string
  title: string | null
  distance_m: number
  started_at: string | null
  created_at: string
  profiles: { display_name: string | null } | null
}

export async function getOverview(): Promise<EconomyOverview> {
  const { data, error } = await supabase.rpc('admin_economy_overview')
  if (error) throw error
  const o = data as Record<string, unknown>
  return {
    policy: toPolicy(o.policy), rawPolicy: (o.policy ?? {}) as Record<string, unknown>,
    wallets: Number(o.wallets ?? 0), treasuries: Number(o.treasuries ?? 0), escrow: Number(o.escrow ?? 0),
    minted30d: Number(o.minted_30d ?? 0), granted30d: Number(o.granted_30d ?? 0), fees30d: Number(o.fees_30d ?? 0),
    activePasses: Number(o.active_passes ?? 0), recent: (o.recent ?? []) as AuditEntry[],
  }
}

export async function searchAccounts(q: string): Promise<AccountHit[]> {
  const { data, error } = await supabase.rpc('admin_search_accounts', { p_query: q })
  if (error) throw error
  return ((data ?? []) as AccountHit[]).map((r) => ({ ...r, balance: Number(r.balance ?? 0) }))
}

export async function grantXu(input: { kind: AccountKind; id: string; amount: number; coinKind: 'BONUS' | 'PAID'; reason: string; key: string }) {
  const { data, error } = await supabase.rpc('admin_grant_xu', {
    p_target_type: input.kind, p_target_id: input.id, p_amount: input.amount, p_coin_kind: input.coinKind,
    p_reason: input.reason, p_idempotency_key: input.key,
  })
  if (error) throw error
  return data as { transaction_id: string; balance: number; duplicate?: boolean }
}

export async function listPasses(): Promise<Pass[]> {
  const { data, error } = await supabase.rpc('admin_list_passes')
  if (error) throw error
  return (data ?? []) as Pass[]
}

export async function grantPass(input: { kind: AccountKind; id: string; quantity: number; maxSlots: number; expiresAt: string | null; note: string }) {
  const { data, error } = await supabase.rpc('admin_grant_challenge_pass', {
    p_target_type: input.kind, p_target_id: input.id, p_quantity: input.quantity, p_max_slots: input.maxSlots,
    p_expires_at: input.expiresAt, p_note: input.note || null,
  })
  if (error) throw error
  return data as string
}

export async function revokePass(id: string, reason: string) {
  const { error } = await supabase.rpc('admin_revoke_challenge_pass', { p_pass_id: id, p_reason: reason })
  if (error) throw error
}

/** Lưu chính sách: giữ nguyên các khóa khác (pace hợp lệ, giới thiệu bạn bè...) đang có */
export async function publishPolicy(current: Record<string, unknown>, next: EconomyPolicy) {
  const value = { ...current, ...next, challengeFee: { ...next.challengeFee } }
  delete (value as Record<string, unknown>).tiers
  const { data, error } = await supabase.rpc('admin_publish_config', { p_config_key: 'economy_global_config', p_config_value: value })
  if (error) throw error
  return Number(data)
}

export async function listPendingActivities(): Promise<PendingActivity[]> {
  const { data, error } = await supabase.from('activities')
    .select('id, title, distance_m, started_at, created_at, profiles!activities_user_id_fkey(display_name)')
    .eq('validation_status', 'PENDING').order('created_at', { ascending: false }).limit(100)
  if (error) throw error
  return (data ?? []) as unknown as PendingActivity[]
}

export async function reviewActivity(id: string, status: 'APPROVED' | 'REJECTED') {
  const { error } = await supabase.rpc('review_activity', { p_activity_id: id, p_status: status })
  if (error) throw error
}

const MESSAGES: Record<string, string> = {
  FORBIDDEN: 'Chỉ quản trị viên hệ thống mới làm được việc này.',
  REASON_REQUIRED: 'Hãy ghi lý do (ít nhất 5 ký tự) để lưu nhật ký.',
  INVALID_AMOUNT: 'Số lượng không hợp lệ.',
  INVALID_COIN_KIND: 'Loại Xu không hợp lệ.',
  INSUFFICIENT_BALANCE: 'Số dư không đủ để trừ — không cho phép âm.',
  NEGATIVE_BALANCE: 'Số dư không đủ để trừ — không cho phép âm.',
  USER_NOT_FOUND: 'Không tìm thấy người dùng.',
  CLUB_NOT_FOUND: 'Không tìm thấy CLB.',
  INVALID_MAX_SLOTS: 'Số người tối đa của vé phải từ 1 đến 10.000.',
  INVALID_TIME_RANGE: 'Hạn dùng phải ở tương lai.',
  PASS_NOT_FOUND: 'Không tìm thấy vé.',
  INVALID_CONFIG: 'Cấu hình không hợp lệ — kiểm tra lại các mốc và đơn giá.',
}

export function adminErrorMessage(e: unknown): string {
  const err = e as { message?: string; code?: string } | null
  console.warn('[Admin] Lỗi gốc:', err?.code, err?.message)
  const raw = err?.message ?? ''
  const key = Object.keys(MESSAGES).find((k) => raw.includes(k))
  if (key) return MESSAGES[key]
  if (err?.code === '42501') return MESSAGES.FORBIDDEN
  return 'Không thực hiện được. Hãy thử lại.'
}
