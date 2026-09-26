'use client'

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as api from '../api/nearbyApi'

export const nearbyKeys = {
  me: ['nearby', 'me'] as const,
  runners: (f: api.NearbyFilters) => ['nearby', 'runners', f] as const,
  events: (r: number) => ['nearby', 'events', r] as const,
  clubs: (r: number) => ['nearby', 'clubs', r] as const,
  connections: ['nearby', 'connections'] as const,
  event: (id: string) => ['nearby', 'event', id] as const,
  clubPlace: (id: string) => ['nearby', 'club-place', id] as const,
}

export const useDiscovery = () => useQuery({ queryKey: nearbyKeys.me, queryFn: api.getDiscovery })
const ready = (d?: api.Discovery) => !!d?.enabled && !!d.presence

export function useNearbyRunners(f: api.NearbyFilters, d?: api.Discovery) {
  return useInfiniteQuery({
    queryKey: nearbyKeys.runners(f),
    queryFn: ({ pageParam }) => api.nearbyRunners(f, pageParam),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => (pages.length * 30 < last.total ? pages.length * 30 : undefined),
    enabled: ready(d),
    staleTime: 60_000,
  })
}
export const useNearbyEvents = (r: number, enabled = true) => useQuery({ queryKey: nearbyKeys.events(r), queryFn: () => api.nearbyEvents(r), enabled })
export const useNearbyClubs = (r: number, enabled = true) => useQuery({ queryKey: nearbyKeys.clubs(r), queryFn: () => api.nearbyClubs(r), enabled })
export const useConnections = () => useQuery({ queryKey: nearbyKeys.connections, queryFn: api.myConnections })
export const useClubPlace = (clubId: string) => useQuery({ queryKey: nearbyKeys.clubPlace(clubId), queryFn: () => api.getClubPlace(clubId) })
export const usePublicEvent = (id: string) => useQuery({ queryKey: nearbyKeys.event(id), queryFn: () => api.getPublicEvent(id) })

/** Mọi thay đổi → làm mới cả khu Quanh đây */
export function useNearbyMutation<A, R>(fn: (a: A) => Promise<R>) {
  const qc = useQueryClient()
  return useMutation({ mutationFn: fn, onSuccess: () => void qc.invalidateQueries({ queryKey: ['nearby'] }) })
}
