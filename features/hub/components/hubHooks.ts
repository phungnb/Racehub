'use client'

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as api from '../api/hubApi'

export const hubKeys = {
  me: ['hub', 'me'] as const,
  runners: (f: api.HubFilters) => ['hub', 'runners', f] as const,
  feed: (f: api.FeedFilters) => ['hub', 'feed', f] as const,
  interested: (id: string) => ['hub', 'interested', id] as const,
}

export const useMyHub = () => useQuery({ queryKey: hubKeys.me, queryFn: api.myHub })

export function useHubRunners(f: api.HubFilters) {
  return useInfiniteQuery({
    queryKey: hubKeys.runners(f),
    queryFn: ({ pageParam }) => api.hubRunners(f, pageParam),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => (pages.length * 30 < last.total ? pages.length * 30 : undefined),
    staleTime: 60_000,
  })
}

export function useHubFeed(f: api.FeedFilters, enabled = true) {
  return useInfiniteQuery({
    queryKey: hubKeys.feed(f),
    queryFn: ({ pageParam }) => api.hubFeed(f, pageParam),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => (pages.length * 30 < last.total ? pages.length * 30 : undefined),
    enabled,
    staleTime: 30_000,
  })
}

export const useInterested = (id: string) => useQuery({ queryKey: hubKeys.interested(id), queryFn: () => api.hubInterested(id) })

/** Mọi thay đổi → làm mới Hội quán (và Quanh đây: hồ sơ / bài gần đây dùng chung) */
export function useHubMutation<A, R>(fn: (a: A) => Promise<R>) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['hub'] }); void qc.invalidateQueries({ queryKey: ['nearby'] }) },
  })
}
