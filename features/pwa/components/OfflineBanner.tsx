'use client'

import { useEffect, useSyncExternalStore } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { CloudOff, WifiOff } from 'lucide-react'
import { toast } from 'sonner'
import { getServerHealth, onServerHealth } from '@/shared/lib/connection'

const subscribe = (cb: () => void) => {
  window.addEventListener('online', cb)
  window.addEventListener('offline', cb)
  return () => { window.removeEventListener('online', cb); window.removeEventListener('offline', cb) }
}

/**
 * Dải báo ở đầu màn hình: "mất mạng" (thiết bị ngoại tuyến) hoặc "máy chủ không phản hồi" (nhiều yêu cầu liên tiếp lỗi).
 * Tự ẩn khi ổn lại và báo "đã kết nối lại"; bấm "Thử lại" để tải lại các màn đang lỗi.
 */
export function OfflineBanner() {
  const qc = useQueryClient()
  const online = useSyncExternalStore(subscribe, () => navigator.onLine, () => true)
  const health = useSyncExternalStore(onServerHealth, getServerHealth, () => 'ok' as const)

  useEffect(() => {
    const onOnline = () => toast.success('Đã có mạng trở lại', { id: 'conn' })
    window.addEventListener('online', onOnline)
    const off = onServerHealth((h, prev) => { if (h === 'ok' && prev === 'degraded') toast.success('Đã kết nối lại máy chủ', { id: 'conn' }) })
    return () => { window.removeEventListener('online', onOnline); off() }
  }, [])

  if (!online) {
    return (
      <div role="status" className="sticky top-0 z-40 flex items-center justify-center gap-2 bg-coin px-4 py-1.5 text-center text-xs font-semibold text-bg">
        <WifiOff className="size-3.5" aria-hidden />Mất kết nối mạng — dữ liệu có thể chưa mới nhất
      </div>
    )
  }
  if (health === 'degraded') {
    return (
      <div role="alert" className="sticky top-0 z-40 flex items-center justify-center gap-2 bg-danger px-4 py-1.5 text-center text-xs font-semibold text-white">
        <CloudOff className="size-3.5 shrink-0" aria-hidden />
        <span>Máy chủ đang không phản hồi — dữ liệu có thể chưa mới nhất</span>
        <button onClick={() => void qc.refetchQueries({ type: 'active' })}
          className="shrink-0 whitespace-nowrap rounded-md bg-white/20 px-2 py-0.5 hover:bg-white/30">Thử lại</button>
      </div>
    )
  }
  return null
}
