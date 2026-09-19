// features/club/api.ts
// Lớp truy cập dữ liệu toàn diện cho module CLB (Hợp nhất từ clubApi.ts và clubSettingsApi.ts)

import { supabase } from '@/shared/lib/supabase'

export type ClubRole = 'OWNER' | 'VICE_OWNER' | 'CONTENT_ADMIN' | 'CHALLENGE_ADMIN' | 'CAPTAIN' | 'MEMBER'
export type MemberStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'BANNED'
export type JoinPolicy = 'OPEN' | 'APPROVAL' | 'INVITE_ONLY'

export interface Club {
  id: string
  name: string
  description: string | null
  announcement?: string | null
  avatar_url: string | null
  cover_url?: string | null
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
  xp: number | null
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

export interface ClubAnnouncement {
  id: string
  club_id: string
  author_id: string | null
  title: string
  content: string
  is_pinned: boolean
  status: string
  published_at: string
  created_at: string
  updated_at: string
  author?: MemberProfile | null
}

/* ---------------------------------------------------------------- */
/* Thứ bậc quyền & Phân quyền động (Dynamic Permission System)      */
/* ---------------------------------------------------------------- */

const RANK: Record<string, number> = { 
  OWNER: 5, 
  VICE_OWNER: 4, 
  CONTENT_ADMIN: 3, 
  CHALLENGE_ADMIN: 3, 
  CAPTAIN: 2,
  MEMBER: 1 
}

export const ROLE_LABEL: Record<string, string> = {
  OWNER: 'Chủ nhiệm',
  VICE_OWNER: 'Phó Chủ nhiệm',
  CONTENT_ADMIN: 'Quản trị Nội dung',
  CHALLENGE_ADMIN: 'Quản trị Thử thách',
  CAPTAIN: 'Phó nhóm',
  MEMBER: 'Thành viên',
}

export const JOIN_POLICY_LABEL: Record<JoinPolicy, string> = {
  OPEN: 'Ai cũng vào được ngay',
  APPROVAL: 'Phải được Ban chủ nhiệm duyệt',
  INVITE_ONLY: 'Chỉ nhận qua link mời',
}

export const isStaff = (role?: string | null) => 
  role === 'OWNER' || role === 'VICE_OWNER' || role === 'CONTENT_ADMIN' || role === 'CHALLENGE_ADMIN' || role === 'CAPTAIN'

/** Người có `actor` có được phép tác động lên người có `target` không. */
export const outranks = (actor: string | null | undefined, target: string) =>
  !!actor && (RANK[actor] ?? 0) > (RANK[target] ?? 0)

/** Kiểm tra quyền thông qua hàm RPC has_permission trên Database */
export async function hasPermission(clubId: string, permissionCode: string): Promise<boolean> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return false

  const { data, error } = await supabase.rpc('has_permission', {
    p_user_id: user.id,
    p_club_id: clubId,
    p_permission_code: permissionCode,
  })

  if (error) {
    console.error("Lỗi kiểm tra quyền has_permission:", error.message)
    return false
  }

  return Boolean(data)
}

/* ---------------------------------------------------------------- */
/* Chuẩn hoá dữ liệu join                                          */
/* ---------------------------------------------------------------- */

function normalizeMember(row: any): ClubMember {
  const p = Array.isArray(row?.profile) ? row.profile[0] ?? null : row?.profile ?? row?.profiles ?? null
  return {
    id: row.id,
    club_id: row.club_id,
    user_id: row.user_id,
    role: (row.role ?? 'MEMBER') as ClubRole,
    status: (row.status ?? 'PENDING') as MemberStatus,
    joined_at: row.joined_at,
    profile: p,
  }
}

/* ---------------------------------------------------------------- */
/* Đọc dữ liệu (Reads)                                              */
/* ---------------------------------------------------------------- */

export async function listClubs(search = ''): Promise<Club[]> {
  let q = supabase.from('clubs').select('*').order('member_count', { ascending: false })
  if (search.trim()) q = q.ilike('name', `%${search.trim()}%`)
  const { data, error } = await q
  if (error) throw error
  return (data ?? []) as Club[]
}

export async function getClub(clubId: string): Promise<Club> {
  const { data, error } = await supabase.from('clubs').select('*').eq('id', clubId).single()
  if (error) throw error
  return data as Club
}

export async function listMembers(clubId: string): Promise<ClubMember[]> {
  const { data, error } = await supabase
    .from('club_members')
    .select(`
      id, club_id, user_id, role, status, joined_at,
      profiles ( id, display_name, level, xp, avatar_url )
    `)
    .eq('club_id', clubId)
    .order('joined_at', { ascending: true })

  if (error) throw error
  return (data ?? []).map(normalizeMember)
}

export async function listMyMemberships(userId: string) {
  const { data, error } = await supabase
    .from('club_members')
    .select('club_id, role, status')
    .eq('user_id', userId)
  if (error) throw error
  return (data ?? []) as { club_id: string; role: ClubRole; status: MemberStatus }[]
}

/* ---------------------------------------------------------------- */
/* Bảng tin / Thông báo nhóm (Announcements)                        */
/* ---------------------------------------------------------------- */

export async function listAnnouncements(clubId: string): Promise<ClubAnnouncement[]> {
  const { data, error } = await supabase
    .from('club_announcements')
    .select(`*, author:author_id ( id, display_name, avatar_url, level )`)
    .eq('club_id', clubId)
    .order('is_pinned', { ascending: false })
    .order('created_at', { ascending: false })

  if (error) throw error
  return (data ?? []) as ClubAnnouncement[]
}

export async function createAnnouncement(clubId: string, title: string, content: string, isPinned = false): Promise<ClubAnnouncement> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('AUTH_REQUIRED')

  const { data, error } = await supabase
    .from('club_announcements')
    .insert({ club_id: clubId, author_id: user.id, title, content, is_pinned: isPinned })
    .select()
    .single()

  if (error) throw error
  return data as ClubAnnouncement
}

export async function deleteAnnouncement(announcementId: string): Promise<void> {
  const { error } = await supabase.from('club_announcements').delete().eq('id', announcementId)
  if (error) throw error
}

/* ---------------------------------------------------------------- */
/* Thao tác Ghi & Cài đặt (Writes & RPC Transactions)               */
/* ---------------------------------------------------------------- */

export async function createClub(name: string, description?: string): Promise<Club> {
  const { data, error } = await supabase.rpc('create_club', { p_name: name, p_description: description ?? null })
  if (error) throw error
  return data as Club
}

export async function joinClub(clubId: string): Promise<ClubMember> {
  const { data, error } = await supabase.rpc('join_club', { p_club_id: clubId })
  if (error) throw error
  return normalizeMember(data)
}

export async function joinClubByCode(code: string) {
  // Bắt buộc phải dùng key là 'p_code' vì SQL function đang khai báo nhận biến p_code
  const { data, error } = await supabase.rpc('join_club_by_code', { p_code: code })
  
  if (error) throw error
  return data
}

export async function setMemberStatus(memberId: string, status: MemberStatus) {
  const { error } = await supabase.rpc('set_member_status', { p_member_id: memberId, p_status: status })
  if (error) throw error
}

export async function setMemberRole(memberId: string, role: string) {
  const { error } = await supabase.rpc('set_member_role', { p_member_id: memberId, p_role: role })
  if (error) throw error
}

export async function removeMember(memberId: string) {
  const { error } = await supabase.rpc('remove_member', { p_member_id: memberId })
  if (error) throw error
}

export async function transferOwnership(clubId: string, toUserId: string) {
  const { error } = await supabase.rpc('transfer_ownership', { p_club_id: clubId, p_to_user: toUserId })
  if (error) throw error
}

export async function contributeTreasury(clubId: string, amount: number): Promise<number> {
  const { data, error } = await supabase.rpc('contribute_treasury', { p_club_id: clubId, p_amount: amount })
  if (error) throw error
  return Number(data)
}

/* --- Phần cài đặt & Hồ sơ CLB --- */
export const AVATAR_BUCKET = 'club-avatars'
export const MAX_AVATAR_BYTES = 2 * 1024 * 1024
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp']

export async function uploadClubAvatar(clubId: string, file: File): Promise<Club> {
  if (!ALLOWED_TYPES.includes(file.type)) throw new Error('AVATAR_TYPE')
  if (file.size > MAX_AVATAR_BYTES) throw new Error('AVATAR_SIZE')

  const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg'
  const path = `${clubId}/${Date.now()}.${ext}`

  const { error: upErr } = await supabase.storage
    .from(AVATAR_BUCKET)
    .upload(path, file, { cacheControl: '3600', upsert: false, contentType: file.type })
  if (upErr) throw upErr

  const { data: pub } = supabase.storage.from(AVATAR_BUCKET).getPublicUrl(path)

  const { data, error } = await supabase.rpc('update_club', {
    p_club_id: clubId,
    p_avatar_url: pub.publicUrl,
    p_avatar_path: path,
  })
  if (error) {
    await supabase.storage.from(AVATAR_BUCKET).remove([path])
    throw error
  }
  return data as Club
}

export async function removeClubAvatar(clubId: string): Promise<Club> {
  const { data, error } = await supabase.rpc('update_club', {
    p_club_id: clubId,
    p_avatar_url: '',
    p_avatar_path: '',
  })
  if (error) throw error
  return data as Club
}

export async function updateClub(clubId: string, fields: { name?: string; description?: string }): Promise<Club> {
  const { data, error } = await supabase.rpc('update_club', {
    p_club_id: clubId,
    p_name: fields.name ?? null,
    p_description: fields.description ?? null,
  })
  if (error) throw error
  return data as Club
}

export async function setClubAnnouncement(clubId: string, text: string): Promise<Club> {
  const { data, error } = await supabase.rpc('set_club_announcement', {
    p_club_id: clubId,
    p_text: text,
  })
  if (error) throw error
  return data as Club
}

export async function updateClubPolicy(clubId: string, fields: { joinPolicy?: JoinPolicy; memberLimit?: number }): Promise<Club> {
  const { data, error } = await supabase.rpc('update_club_policy', {
    p_club_id: clubId,
    p_join_policy: fields.joinPolicy ?? null,
    p_member_limit: fields.memberLimit ?? null,
  })
  if (error) throw error
  return data as Club
}

export async function rotateInviteCode(clubId: string): Promise<string> {
  const { data, error } = await supabase.rpc('rotate_invite_code', { p_club_id: clubId })
  if (error) throw error
  return data as string
}

export async function deleteClub(clubId: string): Promise<void> {
  const { error } = await supabase.rpc('delete_club', { p_club_id: clubId })
  if (error) throw error
}

export async function transferClubOwnership(clubId: string, newOwnerId: string): Promise<void> {
  const { error } = await supabase.rpc('transfer_club_ownership', {
    p_club_id: clubId,
    p_new_owner_id: newOwnerId,
  })
  if (error) throw error
}

export async function leaveClub(clubId: string, newOwnerId?: string): Promise<void> {
  const { error } = await supabase.rpc('leave_club', {
    p_club_id: clubId,
    p_new_owner_id: newOwnerId ?? null,
  })
  if (error) throw error
}

/* ---------------------------------------------------------------- */
/* Bản đồ ánh xạ thông báo lỗi tiếng Việt (Error Mapping)           */
/* ---------------------------------------------------------------- */

const MESSAGES: Record<string, string> = {
  AUTH_REQUIRED: 'Bạn cần đăng nhập để thực hiện thao tác này.',
  NAME_REQUIRED: 'Hãy nhập tên Câu lạc bộ.',
  NAME_TOO_LONG: 'Tên Câu lạc bộ tối đa 60 ký tự.',
  NAME_TAKEN: 'Tên này đã có Câu lạc bộ khác dùng. Hãy chọn tên khác.',
  CLUB_NOT_FOUND: 'Câu lạc bộ không còn tồn tại.',
  CLUB_FULL: 'Câu lạc bộ đã đủ số thành viên tối đa.',
  ALREADY_MEMBER: 'Bạn đã ở trong Câu lạc bộ này hoặc đang chờ duyệt.',
  BANNED: 'Bạn đã bị hạn chế tham gia Câu lạc bộ này.',
  INVITE_ONLY: 'Câu lạc bộ này chỉ nhận thành viên qua lời mời.',
  INVALID_INVITE: 'Mã mời không đúng hoặc đã hết hiệu lực.',
  FORBIDDEN: 'Bạn không có quyền thực hiện thao tác này.',
  MEMBER_NOT_FOUND: 'Không tìm thấy thành viên này.',
  TARGET_NOT_APPROVED: 'Chỉ áp dụng được với thành viên đã được duyệt.',
  OWNER_CANNOT_LEAVE: 'Hãy trao quyền Chủ nhiệm cho người khác trước khi rời CLB.',
  NOT_A_MEMBER: 'Bạn cần là thành viên chính thức để góp quỹ.',
  INSUFFICIENT_FUNDS: 'Số Xu trong ví không đủ.',
  INVALID_AMOUNT: 'Số Xu góp phải lớn hơn 0.',
  INVALID_ROLE: 'Vai trò không hợp lệ.',
  INVALID_STATUS: 'Trạng thái không hợp lệ.',
  AVATAR_TYPE: 'Chỉ nhận ảnh JPG, PNG hoặc WebP.',
  AVATAR_SIZE: 'Ảnh tối đa 2 MB. Hãy chọn ảnh nhẹ hơn.',
  DESC_TOO_LONG: 'Mô tả tối đa 300 ký tự.',
  ANNOUNCEMENT_TOO_LONG: 'Thông báo tối đa 500 ký tự.',
  INVALID_POLICY: 'Chế độ tham gia không hợp lệ.',
  INVALID_LIMIT: 'Giới hạn thành viên phải từ 2 đến 1000.',
  LIMIT_BELOW_CURRENT: 'Giới hạn mới thấp hơn số thành viên hiện tại.',
  CONFIRM_MISMATCH: 'Tên xác nhận không khớp. Hãy gõ đúng tên Câu lạc bộ.',
  NOT_AUTHORIZED: 'Bạn không có quyền thực hiện thao tác này.',
  CANNOT_TRANSFER_TO_SELF: 'Không thể trao quyền cho chính mình.',
  TARGET_NOT_MEMBER: 'Người được chọn không phải thành viên CLB.',
  LAST_MEMBER_MUST_DELETE: 'Bạn là thành viên cuối cùng. Hãy giải tán CLB thay vì rời đi.',
  MUST_ASSIGN_NEW_OWNER: 'CLB chưa có Phó chủ nhiệm. Hãy chọn một thành viên để trao quyền trước khi rời.',
}

export function clubErrorMessage(e: any): string {
  const raw: string = e?.message ?? ''
  for (const key of Object.keys(MESSAGES)) {
    if (raw.includes(key)) return MESSAGES[key]
  }
  if (e?.code === '23505') return 'Dữ liệu này đã tồn tại.'
  if (e?.code === '42501') return 'Bạn không có quyền thực hiện thao tác này.'
  return raw || 'Không thực hiện được. Hãy thử lại.'
}
export interface MyClubMembership {
  club: Club
  role: ClubRole
  status: MemberStatus
}

export async function listMyClubMemberships(userId: string): Promise<MyClubMembership[]> {
  const { data, error } = await supabase
    .from('club_members')
    .select('role, status, club:clubs(*)')
    .eq('user_id', userId)
    .in('status', ['APPROVED', 'PENDING', 'BANNED'])
  if (error) throw error
  return (data ?? [])
    .filter((r: any) => r.club)
    .map((r: any) => ({ club: r.club as Club, role: r.role as ClubRole, status: r.status as MemberStatus }))
}
