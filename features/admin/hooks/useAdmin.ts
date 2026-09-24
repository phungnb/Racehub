'use client'

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useInvalidateProfile } from '@/features/auth'
import type { EconomyPolicy } from '@/shared/lib/economy'
import {
  getOverview, grantPass, grantXu, listAvatarItems, listPasses, saveAvatarItem, setAvatarItemActive, listPendingActivities, publishPolicy, reviewActivity, revokePass, searchAccounts,
} from '../api/adminApi'

export const adminKeys = {
  overview: ['admin', 'overview'] as const,
  search: (q: string) => ['admin', 'search', q] as const,
  passes: ['admin', 'passes'] as const,
  pending: ['admin', 'pending'] as const,
  items: ['admin', 'items'] as const,
}

export const useEconomyOverview = () => useQuery({ queryKey: adminKeys.overview, queryFn: getOverview })

export const useAccountSearch = (q: string, enabled = true) => useQuery({
  queryKey: adminKeys.search(q), queryFn: () => searchAccounts(q), enabled, placeholderData: keepPreviousData, staleTime: 30_000,
})

export const usePasses = () => useQuery({ queryKey: adminKeys.passes, queryFn: listPasses })
export const usePendingActivities = () => useQuery({ queryKey: adminKeys.pending, queryFn: listPendingActivities })

export function useGrantXu() {
  const qc = useQueryClient()
  const refreshProfile = useInvalidateProfile()
  return useMutation({
    mutationFn: grantXu,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin'] })
      refreshProfile()               // admin tự cộng cho mình thì ví trên thanh trên cũng đổi
    },
  })
}

export function useGrantPass() {
  const qc = useQueryClient()
  return useMutation({ mutationFn: grantPass, onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin'] }) })
}

export function useRevokePass() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => revokePass(id, reason),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin'] }),
  })
}

export function usePublishPolicy() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ current, next }: { current: Record<string, unknown>; next: EconomyPolicy }) => publishPolicy(current, next),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: adminKeys.overview })
      void qc.invalidateQueries({ queryKey: ['challenge-quote'] })
    },
  })
}

export function useReviewActivity() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'APPROVED' | 'REJECTED' }) => reviewActivity(id, status),
    onSuccess: () => void qc.invalidateQueries({ queryKey: adminKeys.pending }),
  })
}

export const useAvatarItems = () => useQuery({ queryKey: adminKeys.items, queryFn: listAvatarItems })

/** Sau khi sửa danh mục: làm mới cả danh sách quản trị lẫn tủ đồ của chính admin */
function useRefreshItems() {
  const qc = useQueryClient()
  return () => {
    void qc.invalidateQueries({ queryKey: adminKeys.items })
    void qc.invalidateQueries({ queryKey: ['character'] })
  }
}

export function useSaveAvatarItem() {
  const refresh = useRefreshItems()
  return useMutation({ mutationFn: saveAvatarItem, onSuccess: refresh })
}

export function useSetItemActive() {
  const refresh = useRefreshItems()
  return useMutation({
    mutationFn: ({ code, active }: { code: string; active: boolean }) => setAvatarItemActive(code, active),
    onSuccess: refresh,
  })
}
