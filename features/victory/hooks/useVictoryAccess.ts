'use client'

import { useQuery } from '@tanstack/react-query'
import { getAccess } from '../api/victoryApi'
import { victoryKeys } from './keys'

/** Victory Studio đã mở cho người dùng hiện tại? (theo gói; challengeId: giải của CLB Pro mở cho mọi người tham gia) */
export function useVictoryAccess(challengeId?: string | null) {
  const q = useQuery({ queryKey: victoryKeys.access(challengeId ?? null), queryFn: () => getAccess(challengeId), staleTime: 60_000 })
  return { unlocked: q.data?.unlocked ?? true, via: q.data?.via ?? null, loading: q.isPending }
}
