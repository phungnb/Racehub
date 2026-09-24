'use client'

import { useQuery } from '@tanstack/react-query'
import { isSystemAdmin } from '@/features/admin'
import { useMyProfile } from '@/features/auth'
import { isStaff, useClubInbox } from '@/features/club'
import { getOrganizerRights } from '../api/raceApi'

/**
 * Ai được tạo giải: admin hệ thống (giải RaceHub), cá nhân được admin cấp quyền, hoặc ban quản trị
 * của CLB được admin cấp quyền (migration 003800). Quyền thật kiểm tra ở RPC.
 */
export function useOrganizer() {
  const { profile } = useMyProfile()
  const inbox = useClubInbox()
  const rights = useQuery({ queryKey: ['race', 'organizer'], queryFn: getOrganizerRights, enabled: !!profile, staleTime: 60_000 })
  const isAdmin = isSystemAdmin(profile) || !!rights.data?.admin
  const granted = new Set(rights.data?.clubs ?? [])
  const staffClubs = (inbox.data ?? []).filter((c) => c.member_status === 'APPROVED' && isStaff(c.role) && (isAdmin || granted.has(c.club_id)))
  const personal = !!rights.data?.personal
  return { isAdmin, personal, staffClubs, canCreate: isAdmin || personal || staffClubs.length > 0, isLoading: inbox.isLoading || rights.isLoading }
}
