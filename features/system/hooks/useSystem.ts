'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getClientErrors, getSystemNotice, setSystemNotice } from '../api/systemApi'

export const systemKeys = { notice: ['system', 'notice'] as const, errors: (days: number) => ['system', 'client-errors', days] as const }

// Đọc lại mỗi 5 phút để thông báo bảo trì tới cả người đang mở app
export const useSystemNotice = () =>
  useQuery({ queryKey: systemKeys.notice, queryFn: getSystemNotice, staleTime: 60_000, refetchInterval: 5 * 60_000, retry: false })

export const useClientErrors = (days: number) => useQuery({ queryKey: systemKeys.errors(days), queryFn: () => getClientErrors(days) })

export function useSetSystemNotice() {
  const qc = useQueryClient()
  return useMutation({ mutationFn: setSystemNotice, onSuccess: (n) => qc.setQueryData(systemKeys.notice, n) })
}
