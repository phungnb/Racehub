'use client'

import { useQuery } from '@tanstack/react-query'
import { useSession } from '@/features/auth'
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
  const role = membership.data?.status === 'APPROVED' ? membership.data.role : null
  return {
    uid,
    club: club.data,
    membership: membership.data ?? null,
    role,
    isMember: role !== null,
    isStaff: isStaff(role),
    isLoading: club.isLoading || membership.isLoading,
    isError: club.isError || membership.isError,
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
