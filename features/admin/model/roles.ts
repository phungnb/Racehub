// Phân quyền (một nguồn duy nhất: cột profiles.role).
// Chỉ để ẩn/hiện giao diện. Quyền thật được kiểm tra trong DB (RLS + RPC is_system_admin).
export type Role = 'SYSTEM_ADMIN' | 'CLUB_ADMIN' | string

export const isSystemAdmin = (profile?: { role?: Role | null } | null) => profile?.role === 'SYSTEM_ADMIN'
