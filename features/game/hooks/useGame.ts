'use client'

import { useEffect } from 'react'
import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useInvalidateProfile } from '@/features/auth'
import { supabase } from '@/shared/lib/supabase'
import {
  buyShield, checkIn, getAchievements, getActivityRewards, getGameState, getLeagueStandings, getWallet, markEventsSeen,
  getGiftCatalog, getGiftWall, getMyQuests, getRunnerForm, redeemPromoCode, sendGift, setWeeklyGoal,
  getChallengeTopSupported, getMyShine, redeemShine, sendThanks,
} from '../api/gameApi'

export const gameKeys = {
  state: ['game', 'state'] as const,
  rewards: (activityId: string) => ['game', 'rewards', activityId] as const,
  achievements: ['game', 'achievements'] as const,
  league: (groupId: string) => ['game', 'league', groupId] as const,
  wallet: ['game', 'wallet'] as const,
}

/** Trạng thái game của tôi; tự làm mới khi có phần thưởng mới (realtime game_events) */
export function useGameState(userId: string | undefined) {
  const qc = useQueryClient()
  const refreshProfile = useInvalidateProfile()
  useEffect(() => {
    if (!userId) return
    const ch = supabase.channel(`game:${userId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'game_events', filter: `user_id=eq.${userId}` }, () => {
        void qc.invalidateQueries({ queryKey: gameKeys.state })
        void qc.invalidateQueries({ queryKey: gameKeys.wallet })
        // Bài chạy mới (Strava / đồng hồ) → danh sách bài chạy, phân tích cũng cập nhật ngay
        void qc.invalidateQueries({ queryKey: ['activities'] })
        void qc.invalidateQueries({ queryKey: ['insights'] })
        refreshProfile()
      })
      .subscribe()
    return () => { void supabase.removeChannel(ch) }
  }, [userId, qc, refreshProfile])
  return useQuery({ queryKey: gameKeys.state, queryFn: getGameState, enabled: !!userId, staleTime: 30_000 })
}

function useRefreshAll() {
  const qc = useQueryClient()
  const refreshProfile = useInvalidateProfile()
  return () => {
    void qc.invalidateQueries({ queryKey: ['game'] })
    refreshProfile()
  }
}

export function useCheckIn() {
  const refresh = useRefreshAll()
  return useMutation({ mutationFn: checkIn, onSuccess: refresh })
}

export function useSetWeeklyGoal() {
  const refresh = useRefreshAll()
  return useMutation({ mutationFn: setWeeklyGoal, onSuccess: refresh })
}

export function useBuyShield() {
  const refresh = useRefreshAll()
  return useMutation({ mutationFn: buyShield, onSuccess: refresh })
}

export function useGiftCatalog(enabled = true) {
  return useQuery({ queryKey: ['game', 'gifts'], queryFn: getGiftCatalog, enabled, staleTime: 60_000 })
}

export const useMyShine = () => useQuery({ queryKey: ['game', 'shine'], queryFn: getMyShine })
export function useRedeemShine() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ code, key }: { code: string; key: string }) => redeemShine(code, key),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['game'] }); void qc.invalidateQueries({ queryKey: ['character'] }); void qc.invalidateQueries({ queryKey: ['billing'] }) },
  })
}
export function useSendThanks() {
  const qc = useQueryClient()
  return useMutation({ mutationFn: sendThanks, onSuccess: () => void qc.invalidateQueries({ queryKey: ['game', 'shine'] }) })
}
export function useChallengeTopSupported(challengeId: string) {
  return useQuery({ queryKey: ['game', 'top-supported', challengeId], queryFn: () => getChallengeTopSupported(challengeId), staleTime: 60_000, retry: false })
}

export function useGiftWall(userId: string | null | undefined) {
  return useQuery({ queryKey: ['game', 'gift-wall', userId], queryFn: () => getGiftWall(userId!), enabled: !!userId, staleTime: 60_000 })
}

export function useSendGift() {
  const qc = useQueryClient()
  const refresh = useRefreshAll()
  return useMutation({
    mutationFn: sendGift,
    onSuccess: () => {
      refresh()   // gồm cả ['game', 'gifts'] và ['game', 'gift-wall']
      // Tổng quà trên bài đăng CLB (chỉ làm mới bảng tin, không đụng chat)
      void qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'club' && q.queryKey[2] === 'posts' })
    },
  })
}

export function useMarkSeen() {
  const qc = useQueryClient()
  return useMutation({ mutationFn: markEventsSeen, onSuccess: () => void qc.invalidateQueries({ queryKey: gameKeys.state }) })
}

export const useActivityRewards = (activityId: string | null | undefined) =>
  useQuery({ queryKey: gameKeys.rewards(activityId ?? ''), queryFn: () => getActivityRewards(activityId!), enabled: !!activityId })

export const useAchievements = () => useQuery({ queryKey: gameKeys.achievements, queryFn: getAchievements })

export const useLeagueStandings = (groupId: string | null | undefined) =>
  useQuery({ queryKey: gameKeys.league(groupId ?? ''), queryFn: () => getLeagueStandings(groupId!), enabled: !!groupId, placeholderData: keepPreviousData })

export function useWallet() {
  return useInfiniteQuery({
    queryKey: gameKeys.wallet,
    queryFn: ({ pageParam }) => getWallet(pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => (last.items.length === 30 ? last.items[last.items.length - 1].created_at : undefined),
  })
}

export function useRunnerForm(userId?: string | null) {
  return useQuery({ queryKey: ['game', 'form', userId ?? 'me'], queryFn: () => getRunnerForm(userId), staleTime: 5 * 60_000 })
}

export function useMyQuests() {
  return useQuery({ queryKey: ['game', 'quests'], queryFn: getMyQuests })
}

export function useRedeemPromo() {
  const refresh = useRefreshAll()
  return useMutation({ mutationFn: redeemPromoCode, onSuccess: () => refresh() })
}
