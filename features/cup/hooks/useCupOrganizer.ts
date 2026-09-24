'use client'

import { useMyProfile } from '@/features/auth'
import { isStaff, useClubInbox } from '@/features/club'

/** CLB mình quản trị (tạo dưới tên CLB → mở ngay) + admin hệ thống. Quyền thật kiểm tra ở RPC. */
export function useCupOrganizer() {
  const { profile } = useMyProfile()
  const inbox = useClubInbox()
  const staffClubs = (inbox.data ?? []).filter((c) => c.member_status === 'APPROVED' && isStaff(c.role))
  return { isAdmin: profile?.role === 'SYSTEM_ADMIN', staffClubs, isLoading: inbox.isLoading }
}
