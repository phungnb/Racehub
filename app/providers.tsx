'use client'

import { useState, type ReactNode } from 'react'
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { toast, Toaster } from 'sonner'
import { SessionProvider } from '@/features/auth'
import { PwaBoot } from '@/features/pwa'
import { SystemNoticeBanner } from '@/features/system'
import { describeError, shouldRetry } from '@/shared/lib/errors'
import { noteRequestFailure, noteRequestSuccess } from '@/shared/lib/connection'
import { reportError } from '@/shared/lib/reportError'

/**
 * Lỗi khi tải dữ liệu:
 * - lần đầu (chưa có gì để hiện) → màn tự hiện ErrorState tại chỗ;
 * - đã có dữ liệu mà làm mới thất bại → toast nhỏ báo "đang xem dữ liệu cũ", mỗi loại lỗi chỉ báo 1 lần;
 * - mọi lỗi hệ thống được gửi về Quản trị → Hệ thống (có giới hạn) và cập nhật trạng thái máy chủ.
 */
function makeQueryClient() {
  const track = (e: unknown) => {
    const d = describeError(e)
    noteRequestFailure(d.kind)
    reportError(e)
    return d
  }
  return new QueryClient({
    queryCache: new QueryCache({
      onError: (e, query) => {
        const d = track(e)
        if (query.state.data !== undefined && d.kind !== 'OFFLINE') {
          toast.warning(d.title, { id: `refresh-${d.kind}`, description: 'Đang hiện dữ liệu đã tải trước đó. ' + d.message })
        }
      },
      onSuccess: () => noteRequestSuccess(),
    }),
    mutationCache: new MutationCache({
      // Từng nút bấm tự báo lỗi của nó (onError / try-catch tại chỗ); ở đây chỉ ghi nhận để tránh báo trùng
      onError: (e) => { track(e) },
      onSuccess: () => noteRequestSuccess(),
    }),
    defaultOptions: {
      queries: {
        retry: (count, e) => count < 2 && shouldRetry(e),
        retryDelay: (n) => Math.min(1000 * 2 ** n, 8000),
        refetchOnWindowFocus: false,
      },
    },
  })
}

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(makeQueryClient)
  return (
    <QueryClientProvider client={queryClient}>
      <SystemNoticeBanner />
      <SessionProvider>{children}</SessionProvider>
      <PwaBoot />
      <Toaster theme="dark" position="top-center" richColors closeButton />
    </QueryClientProvider>
  )
}
