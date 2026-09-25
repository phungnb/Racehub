// Công cụ admin: mọi thao tác đi qua RPC kiểm tra quyền is_system_admin (migration 000700).
import { supabase } from '@/shared/lib/supabase'
import { toPolicy, type EconomyPolicy } from '@/shared/lib/economy'
import type { CharacterItem, Gender, RenderKind, Rarity, Slot } from '@/features/character'
import type { PendingRun } from '@/features/activity'

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

export type PendingActivity = PendingRun

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
  return data as { transaction_id?: string; balance?: number; duplicate?: boolean; pending?: boolean; approval_id?: string }
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
  return data as string | null        // null = vượt ngưỡng, đã thành yêu cầu chờ admin khác duyệt
}

export async function revokePass(id: string, reason: string) {
  const { error } = await supabase.rpc('admin_revoke_challenge_pass', { p_pass_id: id, p_reason: reason })
  if (error) throw error
}

/** Lưu chính sách: giữ nguyên các khóa khác (pace hợp lệ, giới thiệu bạn bè...) đang có */
export async function publishPolicy(current: Record<string, unknown>, next: EconomyPolicy) {
  // Máy chủ ghép với mặc định v2 và kiểm tra lại; giữ các khóa khác admin đã đặt (nếu có)
  const value = { ...current, ...next, econVersion: 2 }
  const { data, error } = await supabase.rpc('admin_publish_config', { p_config_key: 'economy_global_config', p_config_value: value })
  if (error) throw error
  return Number(data)
}

export async function listPendingActivities(): Promise<PendingActivity[]> {
  const { data, error } = await supabase.from('activities')
    .select('id, title, distance_m, started_at, created_at, source, moving_time_s, validation_reason, risk_score, risk_level, risk_flags, profiles!activities_user_id_fkey(display_name, avatar_url)')
    .eq('validation_status', 'PENDING').order('created_at', { ascending: false }).limit(100)
  if (error) throw error
  return (data ?? []) as unknown as PendingActivity[]
}

export async function reviewActivity(id: string, status: 'APPROVED' | 'REJECTED') {
  const { error } = await supabase.rpc('review_activity', { p_activity_id: id, p_status: status })
  if (error) throw error
}

// ---------------------------------------------------------------------
// Vật phẩm nhân vật (migration 001200)
// ---------------------------------------------------------------------
export interface AdminItem extends CharacterItem {
  is_active: boolean
  sort: number
  owners: number
}

export interface ItemInput {
  code: string
  name: string
  description: string | null
  slot: Slot
  rarity: Rarity
  render_kind: RenderKind
  color: string | null
  layer_urls: Partial<Record<Gender, string>> | null
  price_xu: number
  unlock_level: number
  sort: number
  is_active: boolean
}

export const LAYER_BUCKET = 'character-layers'

export async function listAvatarItems(): Promise<AdminItem[]> {
  const { data, error } = await supabase.rpc('admin_list_avatar_items')
  if (error) throw error
  return ((data ?? []) as AdminItem[]).map((i) => ({ ...i, price_xu: Number(i.price_xu ?? 0), owners: Number(i.owners ?? 0) }))
}

export async function saveAvatarItem(item: ItemInput) {
  const { data, error } = await supabase.rpc('admin_save_avatar_item', { p_item: item })
  if (error) throw error
  return data as AdminItem
}

export async function setAvatarItemActive(code: string, active: boolean) {
  const { error } = await supabase.rpc('admin_set_avatar_item_active', { p_code: code, p_active: active })
  if (error) throw error
}

/** Tải ảnh lớp lên kho; tên file có mốc thời gian để không bị cache ảnh cũ khi thay */
export async function uploadLayer(code: string, gender: Gender, file: File): Promise<string> {
  const path = `${code}/${gender}-${Date.now()}.png`
  const { error } = await supabase.storage.from(LAYER_BUCKET).upload(path, file, { contentType: 'image/png', upsert: false })
  if (error) throw error
  return supabase.storage.from(LAYER_BUCKET).getPublicUrl(path).data.publicUrl
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
  INVALID_CODE: 'Mã vật phẩm chỉ gồm chữ thường không dấu, số và dấu _ (3–48 ký tự).',
  INVALID_NAME: 'Tên vật phẩm cần 2–60 ký tự.',
  INVALID_DESCRIPTION: 'Mô tả tối đa 160 ký tự.',
  INVALID_SLOT: 'Ô trang phục không hợp lệ.',
  INVALID_RARITY: 'Độ hiếm không hợp lệ.',
  INVALID_PRICE: 'Giá phải từ 0 đến 100.000 Xu.',
  INVALID_LEVEL: 'Cấp mở khóa phải từ 1 đến 5.',
  TINT_SLOT_ONLY: 'Vật phẩm đổi màu chỉ dành cho áo, quần, tất, giày.',
  INVALID_COLOR: 'Mã màu không hợp lệ.',
  LAYER_REQUIRED: 'Cần ít nhất một ảnh lớp (Nam hoặc Nữ).',
  INVALID_LAYER: 'Đường dẫn ảnh lớp không hợp lệ (phải là PNG).',
  SLOT_LOCKED: 'Đã có người sở hữu món này, không đổi sang ô khác được. Hãy tạo mã mới.',
  ITEM_REQUIRED: 'Không ngừng bán được bản nguyên bản (bộ mặc định của mọi người).',
  ITEM_NOT_FOUND: 'Không tìm thấy vật phẩm.',
  SELF_ACTION_FORBIDDEN: 'Không thể tự cấp cho chính mình hoặc CLB mình là thành viên — nhờ một admin khác thực hiện.',
  SAME_ADMIN: 'Người yêu cầu không tự duyệt được — cần một admin khác.',
  APPROVAL_DONE: 'Yêu cầu này đã được xử lý.',
  APPROVAL_EXPIRED: 'Yêu cầu đã quá 7 ngày và hết hạn — tạo lại nếu vẫn cần.',
  APPROVAL_NOT_FOUND: 'Không tìm thấy yêu cầu.',
  ORDER_NOT_FOUND: 'Không tìm thấy đơn hàng.',
  ORDER_NOT_PENDING: 'Đơn đã được xử lý hoặc đã hủy.',
  INVALID_PLAN: 'Gói không hợp lệ cho loại tài khoản này (VIP cho cá nhân, CLB Pro cho CLB).',
  INVALID_MONTHS: 'Kỳ hạn chỉ 1, 3, 6 hoặc 12 tháng.',
  INVALID_BANK: 'Tài khoản nhận tiền không hợp lệ: mã BIN 6 số, số tài khoản 4–30 ký tự, tên chủ tài khoản ≥ 3 ký tự.',
  INVALID_OWNER: 'Loại tài khoản không hợp lệ.',
  gift_catalog: 'Quà không hợp lệ: mã 2–40 ký tự (a-z, 0-9, _), tên 2–40 ký tự, giá 1–1.000.000 Xu.',
  xu_packages: 'Gói Xu không hợp lệ: giá ≥ 1.000đ, số Xu ≥ 1.',
  plan_prices: 'Giá gói không hợp lệ.',
  plan_credits: 'Lượt tạo không hợp lệ (quy mô 1–10.000, 1–100 lượt/tháng).',
  'Payload too large': 'File quá lớn (tối đa 1 MB).',
  'mime type': 'Chỉ nhận file PNG.',
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

// ---------------------------------------------------------------------
// Gói CLB Pro (migration 002800)
// ---------------------------------------------------------------------
export interface AdminClub {
  id: string
  name: string
  avatar_url: string | null
  accent_color: string | null
  member_count: number
  plan: 'FREE' | 'PRO'
  pro_until: string | null
  slug: string | null
  active: boolean
}

export async function adminListClubs(query: string): Promise<AdminClub[]> {
  const { data, error } = await supabase.rpc('admin_list_clubs', { p_query: query })
  if (error) throw error
  return (data ?? []) as AdminClub[]
}

export async function adminSetClubPlan(clubId: string, plan: 'FREE' | 'PRO', until: string | null, reason: string) {
  const { error } = await supabase.rpc('admin_set_club_plan', { p_club_id: clubId, p_plan: plan, p_until: until, p_reason: reason })
  if (error) throw error
}

/* ------------------------------ Kiểm tra hệ thống (migration 003500) ------------------------------ */
export interface SystemCheck {
  migrations: { file: string; label: string; ok: boolean }[]
  buckets: { id: string; ok: boolean; limit_mb: number }[]
  stats: {
    pg_net: boolean; push_url: string | null; admins: number; users: number; clubs: number
    push_stuck?: number; challenges_overdue?: number; battles_overdue?: number; pending_reviews?: number
    cups_overdue?: number; cups_pending?: number
  }
  checked_at: string
}
export interface ServerCheckItem { key: string; label: string; status: 'ok' | 'warn' | 'fail'; detail: string }

export async function getSystemCheck(): Promise<SystemCheck> {
  const { data, error } = await supabase.rpc('admin_system_check')
  if (error) throw error
  return data as SystemCheck
}

export async function getServerCheck(): Promise<{ items: ServerCheckItem[]; origin: string }> {
  const res = await fetch('/api/admin/system-check', { cache: 'no-store' })
  if (!res.ok) throw new Error(`SERVER_CHECK_${res.status}`)
  return res.json()
}
