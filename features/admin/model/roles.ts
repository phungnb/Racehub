// Phân quyền (một nguồn duy nhất: cột profiles.role).
// Chỉ để ẩn/hiện giao diện. Quyền thật được kiểm tra trong DB (RLS + RPC is_system_admin).
export type Role = 'SYSTEM_ADMIN' | 'CLUB_ADMIN' | string

/** Khớp public.is_system_admin() trong DB: role SYSTEM_ADMIN hoặc cờ is_admin */
export const isSystemAdmin = (profile?: { role?: Role | null; is_admin?: boolean | null } | null) =>
  profile?.role === 'SYSTEM_ADMIN' || profile?.is_admin === true
