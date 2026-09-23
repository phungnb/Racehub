// Dữ liệu CLB: thông tin, thành viên, quỹ, cài đặt. Mọi thao tác ghi đi qua RPC.
import { supabase } from '@/shared/lib/supabase'
import type { ClubRole, JoinPolicy, MemberStatus } from '../model/roles'

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
  invite_code: string
  created_at: string
}

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

export async function getClub(clubId: string): Promise<Club> {
  const { data, error } = await supabase.from('clubs').select('*').eq('id', clubId).single()
  if (error) throw error
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
    .select('id, club_id, user_id, role, status, joined_at, profile:profiles ( id, display_name, level, avatar_url )')
    .eq('club_id', clubId)
    .in('status', ['APPROVED', 'PENDING', 'BANNED'])
    .order('joined_at', { ascending: true })
  if (error) throw error
  return ((data ?? []) as unknown as MemberRow[]).map(normalizeMember)
}

/** Tìm CLB để tham gia (theo tên), CLB đông người trước */
export async function searchClubs(search: string, limit = 20): Promise<Club[]> {
  let q = supabase.from('clubs').select('*').neq('join_policy', 'INVITE_ONLY')
    .order('member_count', { ascending: false }).limit(limit)
  if (search.trim()) q = q.ilike('name', `%${search.trim().replace(/[%_]/g, '')}%`)
  const { data, error } = await q
  if (error) throw error
  return (data ?? []) as Club[]
}

export async function listTreasury(clubId: string, limit = 50): Promise<TreasuryEntry[]> {
  const { data, error } = await supabase.from('club_treasury_log')
    .select('id, amount, kind, note, created_at, user:profiles ( id, display_name, level, avatar_url )')
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

export async function setClubAccent(clubId: string, color: string | null) {
  const { error } = await supabase.rpc('set_club_accent', { p_club_id: clubId, p_color: color })
  if (error) throw error
}

export async function updateClubPolicy(clubId: string, fields: { joinPolicy?: JoinPolicy; memberLimit?: number }): Promise<Club> {
  const { data, error } = await supabase.rpc('update_club_policy', {
    p_club_id: clubId, p_join_policy: fields.joinPolicy ?? null, p_member_limit: fields.memberLimit ?? null,
  })
  if (error) throw error
  return data as Club
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
}

export function clubErrorMessage(e: unknown): string {
  const err = e as { message?: string; code?: string } | null
  const raw = err?.message ?? ''
  const key = Object.keys(MESSAGES).find((k) => raw.includes(k))
  if (key) return MESSAGES[key]
  if (err?.code === '42501') return MESSAGES.FORBIDDEN
  return 'Không thực hiện được. Hãy thử lại.'
}
