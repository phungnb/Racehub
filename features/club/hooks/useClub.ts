'use client'

import { useQuery } from '@tanstack/react-query'
import { useMyProfile, useSession } from '@/features/auth'
import { isSystemAdmin } from '@/features/admin'
import { getClub, getMyMembership, listMembers, listTreasury } from '../api/clubApi'
import { listInbox } from '../api/hubApi'
import { isStaff } from '../model/roles'
import { clubKeys } from './keys'

/** Thông tin CLB + vai trò của tôi trong CLB */
export function useClub(clubId: string) {
  const { session } = useSession()
  const uid = session?.user.id
  const club = useQuery({ queryKey: clubKeys.club(clubId), queryFn: () => getClub(clubId) })
  const membership = useQuery({
    queryKey: clubKeys.membership(clubId, uid),
    queryFn: () => getMyMembership(clubId, uid!),
    enabled: !!uid,
  })
  const { profile } = useMyProfile()
  const admin = isSystemAdmin(profile)
  const ownRole = membership.data?.status === 'APPROVED' ? membership.data.role : null
  // Admin hệ thống toàn quyền ở mọi CLB (migration 007100): coi như Chủ nhiệm khi không phải thành viên
  const role = ownRole ?? (admin ? 'OWNER' : null)
  return {
    uid,
    club: club.data,
    membership: membership.data ?? null,
    role,
    /** Có thật trong danh sách thành viên (admin xem hộ thì false) */
    isRealMember: ownRole !== null,
    isAdmin: admin,
    isMember: role !== null,
    isStaff: isStaff(role),
    isLoading: club.isLoading || membership.isLoading,
    isError: club.isError || membership.isError,
    error: club.error ?? membership.error,
    refetch: () => { void club.refetch(); void membership.refetch() },
  }
}

export function useClubMembers(clubId: string, enabled = true) {
  return useQuery({ queryKey: clubKeys.members(clubId), queryFn: () => listMembers(clubId), enabled })
}

export function useClubInbox() {
  return useQuery({ queryKey: clubKeys.inbox, queryFn: listInbox, refetchOnWindowFocus: true })
}

export function useTreasury(clubId: string, enabled = true) {
  return useQuery({ queryKey: clubKeys.treasury(clubId), queryFn: () => listTreasury(clubId), enabled })
}
