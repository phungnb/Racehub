'use client'

import { useSyncExternalStore } from 'react'
import { WifiOff } from 'lucide-react'

const subscribe = (cb: () => void) => {
  window.addEventListener('online', cb)
  window.addEventListener('offline', cb)
  return () => { window.removeEventListener('online', cb); window.removeEventListener('offline', cb) }
}

/** Dải báo "mất mạng" ở đầu màn hình; tự ẩn khi có mạng lại */
export function OfflineBanner() {
  const online = useSyncExternalStore(subscribe, () => navigator.onLine, () => true)
  if (online) return null
  return (
    <div role="status" className="sticky top-0 z-40 flex items-center justify-center gap-2 bg-coin px-4 py-1.5 text-center text-xs font-semibold text-bg">
      <WifiOff className="size-3.5" aria-hidden />Mất kết nối mạng — dữ liệu có thể chưa mới nhất
    </div>
  )
}
