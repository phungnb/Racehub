'use client'

import { useQuery } from '@tanstack/react-query'
import { getLeaderboard, type LeaderboardPeriod } from '../api/hubApi'
import { clubKeys } from './keys'

export function useClubLeaderboard(clubId: string, period: LeaderboardPeriod, enabled = true) {
  return useQuery({
    queryKey: clubKeys.leaderboard(clubId, period),
    queryFn: () => getLeaderboard(clubId, period),
    enabled,
    staleTime: 60_000,
  })
}
