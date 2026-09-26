// Dữ liệu CLB: thông tin, thành viên, quỹ, cài đặt. Mọi thao tác ghi đi qua RPC.
import { supabase } from '@/shared/lib/supabase'
import type { ClubRole, JoinPolicy, MemberStatus } from '../model/roles'
import type { PendingRun } from '@/features/activity'
import { systemErrorMessage } from '@/shared/lib/errors'
import type { ClubChallengeQuota } from '@/features/challenge'

export interface Club {
  id: string
  name: string
  description: string | null
  avatar_url: string | null
  accent_color: string | null
  owner_id: string
  treasury_balance: number
  member_count: number
  member_limit: number
  join_policy: JoinPolicy
  /** Gói CLB (migration 002800) */
  plan?: 'FREE' | 'PRO'
  pro_until?: string | null
  slug?: string | null
  /** Tường nhà CLB Pro (migration 008100) */
  cover_url?: string | null
  cover_position?: number | null
  tagline?: string | null
  theme?: ClubTheme | null
  created_at: string
}
export type ClubTheme = 'AURORA' | 'SUNSET' | 'OCEAN' | 'FOREST' | 'GOLD' | 'NIGHT'

export interface MemberProfile {
  id: string
  display_name: string | null
  level: number | null
  avatar_url: string | null
}

export interface ClubMember {
  id: string
  club_id: string
  user_id: string
  role: ClubRole
  status: MemberStatus
  joined_at: string
  profile: MemberProfile | null
}

export interface MyMembership { id: string; role: ClubRole; status: MemberStatus }

export interface TreasuryEntry {
  id: string
  amount: number
  kind: 'CONTRIBUTE' | 'SPEND' | 'REWARD'
  note: string | null
  created_at: string
  user: MemberProfile | null
}

type MemberRow = Omit<ClubMember, 'profile'> & { profile: MemberProfile | MemberProfile[] | null }
const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? v[0] ?? null : v)
const normalizeMember = (r: MemberRow): ClubMember => ({ ...r, profile: one(r.profile) })

/* ---------------------------------- Đọc ---------------------------------- */

/** Cột công khai của bảng clubs (migration 003400: mã mời / ngân hàng không đọc trực tiếp được) */
export const CLUB_COLUMNS = 'id, name, description, avatar_url, accent_color, owner_id, treasury_balance, member_count, member_limit, join_policy, plan, pro_until, slug, cover_url, cover_position, tagline, theme, created_at'

export async function getClub(clubId: string): Promise<Club> {
  const { data, error } = await supabase.from('clubs').select(CLUB_COLUMNS).eq('id', clubId).single()
  if (error) throw error
  if (!data || Array.isArray(data)) throw new Error('CLUB_NOT_FOUND')
  return data as Club
}

export async function getMyMembership(clubId: string, userId: string): Promise<MyMembership | null> {
  const { data, error } = await supabase.from('club_members').select('id, role, status')
    .eq('club_id', clubId).eq('user_id', userId).maybeSingle()
  if (error) throw error
  return data as MyMembership | null
}

export async function listMembers(clubId: string): Promise<ClubMember[]> {
  const { data, error } = await supabase.from('club_members')
    .select('id, club_id, user_id, role, status, joined_at, profile:profiles!fk_club_members_profiles ( id, display_name, level, avatar_url )')
    .eq('club_id', clubId)
    .in('status', ['APPROVED', 'PENDING', 'BANNED'])
    .order('joined_at', { ascending: true })
  if (error) throw error
  return ((data ?? []) as unknown as MemberRow[]).map(normalizeMember)
}

/** Tìm CLB (migration 003100): không dấu, nhiều từ, viết tắt, link riêng; khớp nhất rồi đông người trước */
export async function searchClubs(search: string, limit = 20): Promise<Club[]> {
  const { data, error } = await supabase.rpc('search_clubs', { p_query: search.trim(), p_limit: limit })
  if (error) throw error
  return (data ?? []) as Club[]
}

export async function listTreasury(clubId: string, limit = 50): Promise<TreasuryEntry[]> {
  const { data, error } = await supabase.from('club_treasury_log')
    .select('id, amount, kind, note, created_at, user:profiles!club_treasury_log_user_id_fkey ( id, display_name, level, avatar_url )')
    .eq('club_id', clubId).order('created_at', { ascending: false }).limit(limit)
  if (error) throw error
  return ((data ?? []) as unknown as (Omit<TreasuryEntry, 'user'> & { user: MemberProfile | MemberProfile[] | null })[])
    .map((r) => ({ ...r, amount: Number(r.amount), user: one(r.user) }))
}

/* --------------------------------- Ghi ---------------------------------- */

export async function createClub(name: string, description?: string): Promise<Club> {
  const { data, error } = await supabase.rpc('create_club', { p_name: name, p_description: description ?? null })
  if (error) throw error
  return data as Club
}

export async function joinClub(clubId: string): Promise<{ status: MemberStatus }> {
  const { data, error } = await supabase.rpc('join_club', { p_club_id: clubId })
  if (error) throw error
  return data as { status: MemberStatus }
}

export async function joinClubByCode(code: string): Promise<{ club_id: string; status: MemberStatus }> {
  const { data, error } = await supabase.rpc('join_club_by_code', { p_code: code.trim() })
  if (error) throw error
  return data as { club_id: string; status: MemberStatus }
}

export async function setMemberStatus(memberId: string, status: Exclude<MemberStatus, 'PENDING'>) {
  const { error } = await supabase.rpc('set_member_status', { p_member_id: memberId, p_status: status })
  if (error) throw error
}

export async function setMemberRole(memberId: string, role: Exclude<ClubRole, 'OWNER'>) {
  const { error } = await supabase.rpc('set_member_role', { p_member_id: memberId, p_role: role })
  if (error) throw error
}

export async function removeMember(memberId: string) {
  const { error } = await supabase.rpc('remove_member', { p_member_id: memberId })
  if (error) throw error
}

export async function contributeTreasury(clubId: string, amount: number): Promise<number> {
  const { data, error } = await supabase.rpc('contribute_treasury', { p_club_id: clubId, p_amount: amount })
  if (error) throw error
  return Number(data)
}

export const AVATAR_BUCKET = 'club-avatars'
export const MAX_AVATAR_BYTES = 2 * 1024 * 1024
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp']

export async function uploadClubAvatar(clubId: string, file: File): Promise<Club> {
  if (!IMAGE_TYPES.includes(file.type)) throw new Error('AVATAR_TYPE')
  if (file.size > MAX_AVATAR_BYTES) throw new Error('AVATAR_SIZE')
  const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg'
  const path = `${clubId}/${Date.now()}.${ext}`
  const { error: upErr } = await supabase.storage.from(AVATAR_BUCKET)
    .upload(path, file, { cacheControl: '3600', upsert: false, contentType: file.type })
  if (upErr) throw upErr
  const { data: pub } = supabase.storage.from(AVATAR_BUCKET).getPublicUrl(path)
  const { data, error } = await supabase.rpc('update_club', { p_club_id: clubId, p_avatar_url: pub.publicUrl, p_avatar_path: path })
  if (error) {
    await supabase.storage.from(AVATAR_BUCKET).remove([path])
    throw error
  }
  return data as Club
}

export async function updateClub(clubId: string, fields: { name?: string; description?: string }): Promise<Club> {
  const { data, error } = await supabase.rpc('update_club', {
    p_club_id: clubId, p_name: fields.name ?? null, p_description: fields.description ?? null,
  })
  if (error) throw error
  return data as Club
}

/** Ảnh bìa CLB Pro: thu nhỏ còn ≤ 1600px JPEG trước khi tải (giới hạn 2 MB của kho ảnh CLB) */
export async function uploadClubCover(clubId: string, file: File): Promise<string> {
  if (!IMAGE_TYPES.includes(file.type)) throw new Error('AVATAR_TYPE')
  const bmp = await createImageBitmap(file)
  const scale = Math.min(1, 1600 / bmp.width)
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bmp.width * scale); canvas.height = Math.round(bmp.height * scale)
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height)
  const blob = await new Promise<Blob>((ok, bad) => canvas.toBlob((b) => (b ? ok(b) : bad(new Error('AVATAR_TYPE'))), 'image/jpeg', 0.85))
  if (blob.size > MAX_AVATAR_BYTES) throw new Error('AVATAR_SIZE')
  const path = `${clubId}/cover-${Date.now()}.jpg`
  const { error } = await supabase.storage.from(AVATAR_BUCKET).upload(path, blob, { cacheControl: '3600', upsert: false, contentType: 'image/jpeg' })
  if (error) throw error
  return supabase.storage.from(AVATAR_BUCKET).getPublicUrl(path).data.publicUrl
}

export async function setClubBranding(clubId: string, b: { cover_url: string | null; cover_position: number; tagline: string | null; theme: ClubTheme | null }) {
  const { error } = await supabase.rpc('set_club_branding', { p_club_id: clubId, p: b })
  if (error) throw error
}

export async function setClubAccent(clubId: string, color: string | null) {
  const { error } = await supabase.rpc('set_club_accent', { p_club_id: clubId, p_color: color })
  if (error) throw error
}

export async function updateClubPolicy(clubId: string, fields: { joinPolicy?: JoinPolicy }): Promise<Club> {
  const { data, error } = await supabase.rpc('update_club_policy', {
    p_club_id: clubId, p_join_policy: fields.joinPolicy ?? null, p_member_limit: null,
  })
  if (error) throw error
  return data as Club
}

/** Bài chạy chờ duyệt của thành viên CLB (migration 002400) — chỉ ban quản trị */
export async function listClubPendingRuns(clubId: string): Promise<PendingRun[]> {
  const { data, error } = await supabase.rpc('club_pending_activities', { p_club_id: clubId })
  if (error) throw error
  return (data ?? []) as PendingRun[]
}

export async function reviewRun(activityId: string, status: 'APPROVED' | 'REJECTED') {
  const { error } = await supabase.rpc('review_activity', { p_activity_id: activityId, p_status: status })
  if (error) throw error
}

export interface ClubPlan {
  plan: 'FREE' | 'PRO'
  active: boolean
  pro_until: string | null
  slug: string | null
  captains: number
  captain_limit: number | null
}

export interface AttendanceRow {
  user_id: string
  display_name: string | null
  role: string
  joined_at: string
  runs: number
  km: number
  events_going: number
  events_checked_in: number
  dues_paid: number
}

export async function getClubPlan(clubId: string): Promise<ClubPlan> {
  const { data, error } = await supabase.rpc('club_plan', { p_club_id: clubId })
  if (error) throw error
  return data as ClubPlan
}

/** Hạn mức thử thách nội bộ miễn phí theo gói (migration 008200) */
export async function getClubChallengeQuota(clubId: string): Promise<ClubChallengeQuota> {
  const { data, error } = await supabase.rpc('club_challenge_quota', { p_club_id: clubId })
  if (error) throw error
  return data as ClubChallengeQuota
}

export async function setClubSlug(clubId: string, slug: string | null): Promise<string | null> {
  const { data, error } = await supabase.rpc('set_club_slug', { p_club_id: clubId, p_slug: slug })
  if (error) throw error
  return data as string | null
}

export async function getAttendanceReport(clubId: string, from: string, to: string) {
  const { data, error } = await supabase.rpc('club_attendance_report', { p_club_id: clubId, p_from: from, p_to: to })
  if (error) throw error
  return data as { events: number; dues: number; members: AttendanceRow[] }
}

/** /c/<slug> → mã mời (chỉ CLB đang Pro) */
export async function resolveClubSlug(slug: string): Promise<string | null> {
  const { data, error } = await supabase.rpc('resolve_club_slug', { p_slug: slug })
  if (error) throw error
  return (data as string | null) ?? null
}

export interface ClubInvitePreview {
  id: string; name: string; description: string | null; avatar_url: string | null; accent_color: string | null
  member_count: number; join_policy: 'OPEN' | 'APPROVAL' | 'INVITE_ONLY'; plan: string | null; full: boolean
  my_status: 'PENDING' | 'APPROVED' | 'BANNED' | 'LEFT' | null
}
/** Xem trước CLB từ mã mời (chưa đăng nhập cũng xem được — migration 005500) */
export async function clubInvitePreview(code: string): Promise<ClubInvitePreview | null> {
  const { data, error } = await supabase.rpc('club_invite_preview', { p_code: code.trim() })
  if (error) throw error
  return (data as ClubInvitePreview | null) ?? null
}

/** Mã mời (ban quản trị; thành viên nếu CLB không "chỉ qua mã mời") */
export async function getInviteCode(clubId: string): Promise<string> {
  const { data, error } = await supabase.rpc('club_invite_code', { p_club_id: clubId })
  if (error) throw error
  return data as string
}

/** Đã là thành viên mà bấm lại link mời → id CLB để mở */
export async function myClubByInvite(code: string): Promise<string | null> {
  const { data, error } = await supabase.rpc('my_club_by_invite', { p_code: code })
  if (error) throw error
  return (data as string | null) ?? null
}

export async function rotateInviteCode(clubId: string): Promise<string> {
  const { data, error } = await supabase.rpc('rotate_invite_code', { p_club_id: clubId })
  if (error) throw error
  return data as string
}

export async function transferClubOwnership(clubId: string, newOwnerId: string) {
  const { error } = await supabase.rpc('transfer_club_ownership', { p_club_id: clubId, p_new_owner_id: newOwnerId })
  if (error) throw error
}

export async function leaveClub(clubId: string) {
  const { error } = await supabase.rpc('leave_club', { p_club_id: clubId, p_new_owner_id: null })
  if (error) throw error
}

export async function deleteClub(clubId: string, confirmName: string) {
  const { error } = await supabase.rpc('delete_club', { p_club_id: clubId, p_confirm_name: confirmName })
  if (error) throw error
}

/* ------------------------- Thông báo lỗi tiếng Việt ------------------------- */

const MESSAGES: Record<string, string> = {
  AUTH_REQUIRED: 'Bạn cần đăng nhập để tiếp tục.',
  NAME_REQUIRED: 'Hãy nhập tên CLB.',
  NAME_TOO_LONG: 'Tên CLB tối đa 60 ký tự.',
  NAME_TAKEN: 'Tên này đã có CLB khác dùng. Hãy chọn tên khác.',
  DESC_TOO_LONG: 'Mô tả tối đa 300 ký tự.',
  CLUB_NOT_FOUND: 'CLB không còn tồn tại.',
  CLUB_FULL: 'CLB đã đủ số thành viên tối đa.',
  ALREADY_MEMBER: 'Bạn đã ở trong CLB này hoặc đang chờ duyệt.',
  BANNED: 'Bạn đã bị hạn chế tham gia CLB này.',
  INVITE_ONLY: 'CLB này chỉ nhận thành viên qua link mời.',
  INVALID_INVITE: 'Mã mời không đúng hoặc đã hết hiệu lực.',
  FORBIDDEN: 'Bạn không có quyền làm việc này.',
  BOOST_DAY_TOO_LATE: 'Ngày vàng phải đặt trước, từ ngày mai trở đi (ngày đã bắt đầu thì không đổi được).',
  INVALID_MULTIPLIER: 'Hệ số chỉ được ×1,5, ×2 hoặc ×3.',
  BOOST_DAYS_LIMIT: 'Mỗi tháng tối đa 4 ngày vàng.',
  TAGLINE_TOO_LONG: 'Khẩu hiệu tối đa 80 ký tự.',
  EXCHANGE_PENDING: 'Đã có một thư mời đang chờ CLB này trả lời.',
  EXCHANGE_LIMIT: 'Mỗi CLB tối đa 5 thư mời đang chờ.',
  EXCHANGE_CLOSED: 'Thư mời đã được trả lời hoặc đã huỷ.',
  EXCHANGE_EXPIRED: 'Buổi giao lưu đã qua giờ.',
  EXCHANGE_NOT_FOUND: 'Không tìm thấy thư mời.',
  REASON_REQUIRED: 'Hãy ghi lý do (ít nhất 3 ký tự).',
  CLUB_BANK_MISSING: 'CLB chưa khai tài khoản nhận tiền (tab Quỹ) nên chưa đặt hàng được.',
  ORDERS_CLOSED: 'Sản phẩm đã chốt đơn.',
  OUT_OF_STOCK: 'Không còn đủ số lượng.',
  INVALID_SIZE: 'Chọn size có trong danh sách.',
  INVALID_QUANTITY: 'Số lượng không hợp lệ.',
  INVALID_PRICE: 'Giá không hợp lệ.',
  ORDER_LOCKED: 'Đơn đã được CLB xác nhận, không huỷ được. Liên hệ ban quản trị CLB.',
  PRODUCT_NOT_FOUND: 'Không tìm thấy sản phẩm.',
  ACTIVITY_NOT_PENDING: 'Bài chạy này đã được người khác duyệt.',
  NOT_AUTHORIZED: 'Bạn không có quyền làm việc này.',
  MEMBER_NOT_FOUND: 'Không tìm thấy thành viên này.',
  TARGET_NOT_APPROVED: 'Chỉ áp dụng được với thành viên đã được duyệt.',
  OWNER_CANNOT_LEAVE: 'Hãy trao quyền Chủ nhiệm cho người khác trước khi rời CLB.',
  MUST_ASSIGN_NEW_OWNER: 'Hãy trao quyền Chủ nhiệm cho người khác trước khi rời CLB.',
  LAST_MEMBER_MUST_DELETE: 'Bạn là thành viên cuối cùng. Hãy giải tán CLB thay vì rời đi.',
  CANNOT_TRANSFER_TO_SELF: 'Không thể trao quyền cho chính mình.',
  TARGET_NOT_MEMBER: 'Người được chọn không phải thành viên CLB.',
  CONFIRM_MISMATCH: 'Tên xác nhận không khớp. Hãy gõ đúng tên CLB.',
  NOT_A_MEMBER: 'Bạn cần là thành viên CLB để làm việc này.',
  INSUFFICIENT_FUNDS: 'Số Xu trong ví không đủ.',
  INSUFFICIENT_BALANCE: 'Số Xu trong ví không đủ.',
  INVALID_AMOUNT: 'Số Xu phải lớn hơn 0.',
  INVALID_ROLE: 'Vai trò không hợp lệ.',
  INVALID_STATUS: 'Trạng thái không hợp lệ.',
  INVALID_POLICY: 'Chế độ tham gia không hợp lệ.',
  INVALID_LIMIT: 'Giới hạn thành viên phải từ 2 đến 1000.',
  LIMIT_BELOW_CURRENT: 'Giới hạn mới thấp hơn số thành viên hiện tại.',
  INVALID_COLOR: 'Màu không hợp lệ.',
  AVATAR_TYPE: 'Chỉ nhận ảnh JPG, PNG hoặc WebP.',
  AVATAR_SIZE: 'Ảnh tối đa 2 MB. Hãy chọn ảnh nhẹ hơn.',
  IMAGE_TYPE: 'Chỉ nhận ảnh JPG, PNG hoặc WebP.',
  IMAGE_SIZE: 'Mỗi ảnh tối đa 5 MB.',
  EMPTY_POST: 'Hãy viết gì đó hoặc thêm ảnh.',
  EMPTY_COMMENT: 'Hãy viết bình luận.',
  EMPTY_MESSAGE: 'Tin nhắn đang trống.',
  POST_TOO_LONG: 'Nội dung quá dài.',
  POST_NOT_FOUND: 'Bài đăng không còn tồn tại.',
  INVALID_IMAGE_PATH: 'Ảnh không hợp lệ, hãy tải lại.',
  RATE_LIMITED: 'Bạn gửi hơi nhanh, đợi một chút rồi thử lại nhé.',
  CAPTAIN_LIMIT: 'Gói miễn phí có tối đa 2 Quản trị viên. Nâng cấp CLB Pro để thêm.',
  PRO_REQUIRED: 'Tính năng dành cho CLB Pro.',
  INVALID_SLUG: 'Link riêng dài 3–30 ký tự, chỉ gồm chữ thường không dấu, số và dấu gạch ngang.',
  SLUG_TAKEN: 'Link này đã có CLB khác dùng.',
  BATTLE_EXISTS: 'Hai CLB đang có một trận đấu (hoặc lời mời) chưa kết thúc.',
  BATTLE_NOT_PENDING: 'Lời thách đấu này đã được trả lời.',
  BATTLE_EXPIRED: 'Trận đấu đã hết giờ.',
  BATTLE_NOT_FOUND: 'Không tìm thấy trận đấu.',
  INVALID_OPPONENT: 'Hãy chọn một CLB khác để thách đấu.',
  INVALID_DURATION: 'Trận đấu dài từ 1 ngày đến 2 tháng.',
  START_IN_PAST: 'Giờ bắt đầu đã qua.',
  INVALID_TIME_RANGE: 'Thời gian không hợp lệ.',
  TITLE_REQUIRED: 'Tiêu đề cần 3–120 ký tự.',
  INVALID_URL: 'Link phải bắt đầu bằng https:// (dán link album Google Photos, Drive, Facebook…).',
  ALBUM_EXISTS: 'Link album này đã có trong kho ảnh CLB.',
  ALBUM_NOT_FOUND: 'Album không còn tồn tại.',
  INVALID_DATE: 'Ngày chụp không hợp lệ.',
}

export function clubErrorMessage(e: unknown): string {
  // Lỗi ràng buộc vai trò cũ trên CSDL (migration 005700 chưa chạy)
  if (/club_members_role/.test((e as { message?: string } | null)?.message ?? '')) return 'Hệ thống cần cập nhật (migration 005700) trước khi đổi vai trò / trao quyền. Hãy báo quản trị viên.'
  const err = e as { message?: string; code?: string; details?: string; hint?: string } | null
  // Ghi lỗi gốc ra Console (F12) để chẩn đoán; người dùng chỉ thấy câu tiếng Việt
  console.warn('[CLB] Lỗi gốc:', err?.code, err?.message, err?.details ?? '', err?.hint ?? '')
  const raw = err?.message ?? ''
  const key = Object.keys(MESSAGES).find((k) => raw.includes(k))
  if (key) return MESSAGES[key]
  if (err?.code === '42501') return MESSAGES.FORBIDDEN
  return systemErrorMessage(e, 'Không thực hiện được. Hãy thử lại.')
}
