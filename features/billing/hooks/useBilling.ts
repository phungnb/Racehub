'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { cancelOrder, createOrder, getClubPlanStatus, getMyPlan, getPricing } from '../api/billingApi'

export const billingKeys = {
  pricing: ['billing', 'pricing'] as const,
  mine: ['billing', 'mine'] as const,
  club: (id: string) => ['billing', 'club', id] as const,
}

export const usePricing = () => useQuery({ queryKey: billingKeys.pricing, queryFn: getPricing, staleTime: 5 * 60_000 })
export const useMyPlan = () => useQuery({ queryKey: billingKeys.mine, queryFn: getMyPlan })
export const useClubPlanStatus = (clubId: string) => useQuery({ queryKey: billingKeys.club(clubId), queryFn: () => getClubPlanStatus(clubId) })

export function useCreateOrder() {
  const qc = useQueryClient()
  return useMutation({ mutationFn: createOrder, onSuccess: () => void qc.invalidateQueries({ queryKey: billingKeys.mine }) })
}

export function useCancelOrder() {
  const qc = useQueryClient()
  return useMutation({ mutationFn: cancelOrder, onSuccess: () => void qc.invalidateQueries({ queryKey: billingKeys.mine }) })
}
