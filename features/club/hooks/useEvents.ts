'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as api from '../api/eventsApi'

export const eventKeys = {
  list: (clubId: string, scope: string) => ['club', clubId, 'events', scope] as const,
  one: (eventId: string) => ['club-event', eventId] as const,
  polls: (clubId: string) => ['club', clubId, 'polls'] as const,
  finance: (clubId: string) => ['club', clubId, 'finance'] as const,
  due: (dueId: string) => ['club-due', dueId] as const,
}

export const useEvents = (clubId: string, scope: 'UPCOMING' | 'PAST') =>
  useQuery({ queryKey: eventKeys.list(clubId, scope), queryFn: () => api.listEvents(clubId, scope) })
export const useEvent = (eventId: string) => useQuery({ queryKey: eventKeys.one(eventId), queryFn: () => api.getEvent(eventId) })
export const usePolls = (clubId: string) => useQuery({ queryKey: eventKeys.polls(clubId), queryFn: () => api.listPolls(clubId) })
export const useFinance = (clubId: string) => useQuery({ queryKey: eventKeys.finance(clubId), queryFn: () => api.getFinance(clubId) })
export const useDue = (dueId: string | null) =>
  useQuery({ queryKey: eventKeys.due(dueId ?? ''), queryFn: () => api.getDue(dueId!), enabled: !!dueId })

/** Mutation + làm mới mọi dữ liệu sự kiện / thu chi của CLB */
export function useClubMutation<A, R>(clubId: string, fn: (a: A) => Promise<R>) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['club', clubId] })
      void qc.invalidateQueries({ queryKey: ['club-event'] })
      void qc.invalidateQueries({ queryKey: ['club-due'] })
    },
  })
}
