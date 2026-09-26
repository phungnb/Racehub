// Công cụ admin: mọi thao tác đi qua RPC kiểm tra quyền is_system_admin (migration 000700).
import { supabase } from '@/shared/lib/supabase'
import { toPolicy, type EconomyPolicy } from '@/shared/lib/economy'
import type { CharacterItem, Gender, ItemLifecycle, ItemPrint, RenderKind, Rarity, Slot, UniformRequest, UniformStatus } from '@/features/character'
import type { PendingRun } from '@/features/activity'
import { systemErrorMessage } from '@/shared/lib/errors'

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
export interface AdminItem extends Omit<CharacterItem, 'collection'> {
  is_active: boolean
  sort: number
  owners: number
  status: ItemLifecycle
  /** Mã bộ sưu tập */
  collection: string | null
  required_badge: string | null
  required_challenge: string | null
  challenge_title?: string | null
  supply_limit: number | null
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
  /** Vòng đời (migration 005800); thay is_active */
  status: ItemLifecycle
  collection: string | null
  club_id: string | null
  required_badge: string | null
  required_challenge: string | null
  available_from: string | null
  available_to: string | null
  supply_limit: number | null
  print: ItemPrint | null
  /** Mã bộ đồng phục (migration 005900) */
  kit?: string | null
}

export const ITEM_STATUS: Record<ItemLifecycle, { label: string; hint: string; tone: string }> = {
  DRAFT: { label: 'Nháp', hint: 'Chỉ admin thấy', tone: 'bg-surface-2 text-fg-muted' },
  REVIEW: { label: 'Chờ duyệt', hint: 'Chờ người thứ hai xem lại', tone: 'bg-coin/15 text-coin' },
  PUBLISHED: { label: 'Đang bán', hint: 'Hiện trong Tủ đồ', tone: 'bg-brand/15 text-brand' },
  ARCHIVED: { label: 'Ngừng bán', hint: 'Người đã có vẫn mặc được', tone: 'bg-xp/15 text-xp' },
  RETIRED: { label: 'Gỡ hẳn', hint: 'Ẩn cả với người đã có (theo chính sách hoàn Xu)', tone: 'bg-danger/15 text-danger' },
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

export async function setAvatarItemStatus(code: string, status: ItemLifecycle) {
  const { error } = await supabase.rpc('admin_set_avatar_item_status', { p_code: code, p_status: status })
  if (error) throw error
}

export type CollectionKind = 'CORE' | 'LEVEL' | 'SEASON' | 'EVENT' | 'CLUB' | 'SPONSOR'
export const COLLECTION_KIND: Record<CollectionKind, string> = {
  CORE: 'Cơ bản', LEVEL: 'Theo cấp', SEASON: 'Mùa', EVENT: 'Sự kiện', CLUB: 'CLB', SPONSOR: 'Nhà tài trợ',
}
export interface AvatarCollection {
  id?: string
  code: string
  name: string
  description: string | null
  kind: CollectionKind
  starts_at: string | null
  ends_at: string | null
  sort: number
  is_active: boolean
  items?: number
}

export async function listAvatarCollections(): Promise<AvatarCollection[]> {
  const { data, error } = await supabase.rpc('admin_list_avatar_collections')
  if (error) throw error
  return ((data ?? []) as AvatarCollection[]).map((c) => ({ ...c, items: Number(c.items ?? 0) }))
}

export async function saveAvatarCollection(c: AvatarCollection) {
  const { data, error } = await supabase.rpc('admin_save_avatar_collection', { p: c })
  if (error) throw error
  return data as AvatarCollection
}

export async function listUniformRequests(status: UniformStatus | 'ALL'): Promise<UniformRequest[]> {
  const { data, error } = await supabase.rpc('admin_list_uniform_requests', { p_status: status })
  if (error) throw error
  return (data ?? []) as UniformRequest[]
}

export interface UniformApproval { price_xu: number; part_prices?: Record<string, number>; rarity: Rarity; name?: string; collection?: string | null; note?: string }
export async function reviewUniformRequest(id: string, action: 'APPROVE' | 'REJECT', p: UniformApproval | { note: string }) {
  const { data, error } = await supabase.rpc('admin_review_uniform_request', { p_id: id, p_action: action, p })
  if (error) throw error
  return data as UniformRequest
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
  PROMO_OVERLAP: 'Vật phẩm này đang có chương trình khác trong cùng thời gian. Mỗi vật phẩm chỉ một chương trình.',
  INVALID_DISCOUNT: 'Mức giảm từ 5% đến 90%. Muốn tặng miễn phí hãy dùng loại "Miễn phí".',
  FLASH_TOO_LONG: 'Flash sale cần giờ kết thúc, tối đa 72 giờ.',
  FREE_NEEDS_LIMIT: 'Quà miễn phí phải giới hạn số lượt mỗi người (chống farm).',
  TRIAL_AVATAR_ONLY: 'Dùng thử chỉ áp cho đồ nhân vật.',
  INVALID_BUNDLE: 'Gói cần 2–12 món đồ nhân vật đang bán và giá gói.',
  INVALID_PROMO_TITLE: 'Nhập tên chương trình.',
  INVALID_PROMO: 'Chương trình không hợp lệ.',
  FORBIDDEN: 'Chỉ quản trị viên hệ thống mới làm được việc này.',
  REASON_REQUIRED: 'Hãy ghi lý do (ít nhất 5 ký tự) để lưu nhật ký.',
  INVALID_AMOUNT: 'Số lượng không hợp lệ.',
  INVALID_COIN_KIND: 'Loại Xu không hợp lệ.',
  INSUFFICIENT_BALANCE: 'Số dư không đủ để trừ — không cho phép âm.',
  NEGATIVE_BALANCE: 'Số dư không đủ để trừ — không cho phép âm.',
  USER_NOT_FOUND: 'Không tìm thấy người dùng.',
  CLUB_NOT_FOUND: 'Không tìm thấy CLB.',
  INVALID_MAX_SLOTS: 'Số người tối đa của vé phải từ 1 đến 10.000.',
  INVALID_TIME_RANGE: 'Khoảng thời gian không hợp lệ (kết thúc sau bắt đầu, sự kiện cần đủ 2 mốc, tối đa 1 năm).',
  INVALID_TITLE: 'Tên cần từ 2 ký tự.',
  PASS_NOT_FOUND: 'Không tìm thấy vé.',
  INVALID_CONFIG: 'Cấu hình không hợp lệ — kiểm tra lại các mốc và đơn giá.',
  INVALID_CODE: 'Mã không hợp lệ: vật phẩm dùng chữ thường, số, dấu _ (3–48 ký tự); món Tỏa sáng dùng chữ in hoa, số, dấu _ (2–32 ký tự).',
  INVALID_NAME: 'Tên vật phẩm cần 2–60 ký tự.',
  INVALID_DESCRIPTION: 'Mô tả tối đa 160 ký tự.',
  INVALID_SLOT: 'Ô trang phục không hợp lệ.',
  INVALID_RARITY: 'Độ hiếm không hợp lệ.',
  INVALID_PRICE: 'Giá phải từ 0 đến 100.000 Xu.',
  INVALID_LEVEL: 'Cấp mở khóa phải từ 1 đến 8.',
  INVALID_STATUS: 'Trạng thái không hợp lệ.',
  COLLECTION_NOT_FOUND: 'Không tìm thấy bộ sưu tập.',
  BADGE_NOT_FOUND: 'Không tìm thấy huy hiệu với mã này.',
  CHALLENGE_NOT_FOUND: 'Không tìm thấy thử thách.',
  PRINT_TOP_ONLY: 'Chỉ áo mới có vùng in.',
  INVALID_PRINT: 'Nội dung in chưa hợp lệ (logo PNG/WebP/JPG, màu chữ dạng #rrggbb).',
  ITEM_HAS_OWNERS: 'Đã có người sở hữu: không đưa về Nháp / Chờ duyệt được. Dùng Ngừng bán.',
  INVALID_SUPPLY: 'Số lượng giới hạn phải từ 1 trở lên.',
  REQUEST_NOT_FOUND: 'Không tìm thấy yêu cầu.',
  REQUEST_CLOSED: 'Yêu cầu đã được xử lý.',
  INVALID_ACTION: 'Thao tác không hợp lệ.',
  INVALID_PATTERN: 'Họa tiết không hợp lệ cho món này.',
  PATTERN_TINT_ONLY: 'Họa tiết chỉ dùng cho món đổi màu (không dùng cho lớp ảnh).',
  INVALID_KIT: 'Mã bộ không hợp lệ.',
  INVALID_PARTS: 'Bộ đồng phục chỉ gồm áo, quần, tất, giày.',
  TINT_SLOT_ONLY: 'Vật phẩm đổi màu chỉ dành cho áo, quần, tất, giày.',
  INVALID_COLOR: 'Mã màu không hợp lệ.',
  LAYER_REQUIRED: 'Cần ít nhất một ảnh lớp (Nam hoặc Nữ).',
  INVALID_LAYER: 'Đường dẫn ảnh lớp không hợp lệ (phải là PNG).',
  SLOT_LOCKED: 'Đã có người sở hữu món này, không đổi sang ô khác được. Hãy tạo mã mới.',
  ITEM_REQUIRED: 'Không ngừng bán được bản nguyên bản (bộ mặc định của mọi người).',
  ITEM_NOT_FOUND: 'Không tìm thấy vật phẩm.',
  INVALID_REWARD: 'Phần thưởng không hợp lệ: cần ít nhất Xu, lượt tạo hoặc gói VIP (gói tặng phải là VIP1–3).',
  SEGMENT_TOO_LARGE: 'Nhóm quá lớn (trên 50.000 người) — chia nhỏ theo điều kiện khác.',
  INVALID_SALE: 'Đợt giảm giá cần % giảm hoặc % tặng thêm.',
  INVALID_PERIOD: 'Kỳ nhiệm vụ không hợp lệ.',
  INVALID_METRIC: 'Chỉ số không hợp với kỳ (km / ngày chạy trong tuần chỉ cho nhiệm vụ tuần; km cộng đồng cho tuần / tháng / sự kiện; điểm danh chỉ hằng ngày).',
  INVALID_TARGET: 'Mục tiêu phải lớn hơn 0.',
  TOO_MANY_ACTIVE: 'Đã đủ số nhiệm vụ đang bật cho loại này. Tắt bớt một nhiệm vụ hoặc nâng giới hạn ở thẻ Giới hạn.',
  INVALID_TIERS: 'Bậc không hợp lệ: mục tiêu phải tăng dần, tối đa 5 bậc (km cộng đồng không dùng bậc).',
  INVALID_PARAMS: 'Tham số không hợp lệ (km tối thiểu 0–100, giờ chạy sớm 1–23).',
  INVALID_CATEGORY: 'Nhóm nhiệm vụ không hợp lệ.',
  INVALID_BADGE: 'Tên huy hiệu cần 2–60 ký tự.',
  INVALID_PASSES: 'Lượt tạo không hợp lệ (1–10 lượt, quy mô 2–1.000 người).',
  INVALID_LIMIT: 'Giới hạn không hợp lệ.',
  INVALID_KIND: 'Loại món không hợp lệ.',
  promotions_code_key: 'Mã khuyến mãi này đã tồn tại.',
  promotions_code_check: 'Mã chỉ gồm chữ in hoa, số, - và _ (4–24 ký tự).',
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
  // Lỗi quyền của chính cơ sở dữ liệu (không phải luật "chỉ admin"): hiện nguyên văn để biết bảng / hàm nào bị chặn
  if (err?.code === '42501') return `Lỗi quyền trong cơ sở dữ liệu: ${raw || 'permission denied'}. Gửi nguyên văn dòng này cho đội kỹ thuật.`
  return systemErrorMessage(e, 'Không thực hiện được. Hãy thử lại.')
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
    client_errors_24h?: number; not_deployed_24h?: number
    cups_overdue?: number; cups_pending?: number
  }
  checked_at: string
}
export interface ServerCheckItem { key: string; label: string; status: 'ok' | 'warn' | 'fail'; detail: string }

export async function getSystemCheck(): Promise<SystemCheck> {
  const { data, error } = await supabase.rpc('admin_system_check')
  if (error) throw error
  if (!data) throw new Error('NOT_DEPLOYED')
  return data as SystemCheck
}

export interface NotifyError { at: string; stage: string; kind: string | null; sqlstate: string | null; message: string | null }
/** Lỗi trong chuỗi thông báo → push (migration 006900); thao tác chính vẫn thành công */
export async function getNotifyErrors(): Promise<NotifyError[]> {
  const { data, error } = await supabase.rpc('admin_notify_errors')
  if (error) throw error
  return (data as NotifyError[] | null) ?? []
}

export async function getServerCheck(): Promise<{ items: ServerCheckItem[]; origin: string }> {
  const res = await fetch('/api/admin/system-check', { cache: 'no-store' })
  if (!res.ok) throw new Error(`SERVER_CHECK_${res.status}`)
  const j = (await res.json().catch(() => null)) as { items?: ServerCheckItem[]; origin?: string } | null
  return { items: Array.isArray(j?.items) ? j.items : [], origin: j?.origin ?? '' }
}
