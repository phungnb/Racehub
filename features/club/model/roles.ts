// Vai trò trong CLB — khớp với DB (club_members.role, club_rank()).
export type ClubRole = 'OWNER' | 'CAPTAIN' | 'MEMBER'
export type MemberStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'BANNED'
export type JoinPolicy = 'OPEN' | 'APPROVAL' | 'INVITE_ONLY'

export const ROLE_LABEL: Record<ClubRole, string> = {
  OWNER: 'Chủ nhiệm',
  CAPTAIN: 'Quản trị viên',
  MEMBER: 'Thành viên',
}

export const JOIN_POLICY_LABEL: Record<JoinPolicy, { title: string; hint: string }> = {
  OPEN: { title: 'Mở', hint: 'Ai có link hoặc tìm thấy CLB đều vào được ngay' },
  APPROVAL: { title: 'Cần duyệt', hint: 'Ban quản trị duyệt từng người xin vào' },
  INVITE_ONLY: { title: 'Chỉ qua link mời', hint: 'Không ai tự xin vào được, chỉ vào bằng link mời' },
}

const RANK: Record<string, number> = { OWNER: 3, CAPTAIN: 2, MEMBER: 1 }
export const clubRank = (role: string | null | undefined) => (role ? RANK[role] ?? 0 : 0)
export const isStaff = (role: string | null | undefined) => role === 'OWNER' || role === 'CAPTAIN'

/** Người có vai trò `actor` có được quản lý (duyệt, cấm, xóa) người có vai trò `target` không */
export const canManage = (actor: string | null | undefined, target: string | null | undefined) =>
  isStaff(actor) && clubRank(actor) > clubRank(target)

/** Bảng màu gợi ý cho màu nhận diện CLB (đủ tương phản trên nền tối) */
export const CLUB_ACCENTS = ['#b6ff3b', '#38bdf8', '#f472b6', '#fb923c', '#a78bfa', '#facc15', '#34d399', '#f87171'] as const
export const DEFAULT_ACCENT = CLUB_ACCENTS[0]
export const accentOf = (c: { accent_color?: string | null } | null | undefined) => c?.accent_color || DEFAULT_ACCENT
