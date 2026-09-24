'use client'

import { isSystemAdmin } from '@/features/admin'
import { useMyProfile } from '@/features/auth'
import { isStaff, useClubInbox } from '@/features/club'

/** Ai được tạo giải: admin hệ thống (giải RaceHub) hoặc ban quản trị CLB (giải của CLB). Quyền thật kiểm tra ở RPC. */
export function useOrganizer() {
  const { profile } = useMyProfile()
  const inbox = useClubInbox()
  const staffClubs = (inbox.data ?? []).filter((c) => c.member_status === 'APPROVED' && isStaff(c.role))
  const isAdmin = isSystemAdmin(profile)
  return { isAdmin, staffClubs, canCreate: isAdmin || staffClubs.length > 0, isLoading: inbox.isLoading }
}
