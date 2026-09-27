'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getClientErrors, getSystemNotice, resolveClientError, setSystemNotice } from '../api/systemApi'

export const systemKeys = { notice: ['system', 'notice'] as const, errors: (days: number) => ['system', 'client-errors', days] as const }

// Đọc lại mỗi 5 phút để thông báo bảo trì tới cả người đang mở app
export const useSystemNotice = () =>
  useQuery({ queryKey: systemKeys.notice, queryFn: getSystemNotice, staleTime: 60_000, refetchInterval: 5 * 60_000, retry: false })

export const useClientErrors = (days: number) => useQuery({ queryKey: systemKeys.errors(days), queryFn: () => getClientErrors(days) })

export function useSetSystemNotice() {
  const qc = useQueryClient()
  return useMutation({ mutationFn: setSystemNotice, onSuccess: (n) => qc.setQueryData(systemKeys.notice, n) })
}

/** Admin: đánh dấu lỗi đã xử lý → làm mới danh sách lỗi, số đỏ ở Quản trị và mục Kiểm tra hệ thống */
export function useResolveClientError() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: resolveClientError,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['system', 'client-errors'] })
      void qc.invalidateQueries({ queryKey: ['admin', 'inbox'] })
      void qc.invalidateQueries({ queryKey: ['admin', 'system'] })
    },
  })
}
