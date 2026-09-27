'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getClientErrors, getConfigHistory, getOpsPolicy, getSystemNotice, publishOpsPolicy, resolveClientError, rollbackConfig, setSystemNotice, type ConfigKey } from '../api/systemApi'
import { DEFAULT_OPS, type FeatureKey, type OpsPolicy } from '@/shared/lib/ops'

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

export const opsKey = ['system', 'ops-policy'] as const

/** Chính sách vận hành (bật / tắt tính năng, ghi bài chạy, nội dung) — đọc lại mỗi 5 phút; lỗi / chưa có → mặc định */
export function useOpsPolicy(): OpsPolicy {
  const q = useQuery({ queryKey: opsKey, queryFn: getOpsPolicy, staleTime: 5 * 60_000, refetchInterval: 10 * 60_000, retry: 1 })
  return q.data ?? DEFAULT_OPS
}

/** Tính năng đang bật cho người dùng? (mặc định bật khi chưa đọc được máy chủ) */
export const useFeature = (key: FeatureKey) => useOpsPolicy().features[key] !== false

export function usePublishOps() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ p, note }: { p: Parameters<typeof publishOpsPolicy>[0]; note: string }) => publishOpsPolicy(p, note),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: opsKey }); void qc.invalidateQueries({ queryKey: ['system', 'config-history'] }) },
  })
}

export const useConfigHistory = (key: ConfigKey, enabled = true) =>
  useQuery({ queryKey: ['system', 'config-history', key], queryFn: () => getConfigHistory(key), enabled })

export function useRollbackConfig() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ key, version }: { key: ConfigKey; version: number }) => rollbackConfig(key, version),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: opsKey })
      void qc.invalidateQueries({ queryKey: ['system', 'config-history'] })
      void qc.invalidateQueries({ queryKey: ['admin'] })
      void qc.invalidateQueries({ queryKey: ['economy'] })
    },
  })
}
