'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import { captureInstallPrompt } from '../model/pwa'
import { shouldRefreshOnResume } from '../model/resume'

let booted = false

/**
 * Chạy một lần khi app mở: bắt sự kiện "cài app" của trình duyệt và đăng ký service worker.
 * Service worker chỉ đăng ký ở bản production (ở `next dev` nó sẽ cache nhầm mã đang sửa).
 */
export function PwaBoot() {
  const router = useRouter()
  const qc = useQueryClient()

  // Quay lại app sau ≥ 20 giây, hoặc vừa có mạng lại → tải lại dữ liệu đang hiện (bài chạy mới, Xu, thông báo…)
  useEffect(() => {
    let hiddenAt: number | null = null
    const refresh = () => void qc.invalidateQueries({ refetchType: 'active' })
    const onVis = () => {
      if (document.visibilityState === 'hidden') { hiddenAt = Date.now(); return }
      if (shouldRefreshOnResume(hiddenAt, Date.now())) refresh()
      hiddenAt = null
    }
    // iOS: mở lại PWA từ bộ nhớ đệm trang (bfcache) không phát visibilitychange
    const onShow = (e: PageTransitionEvent) => { if (e.persisted) refresh() }
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('pageshow', onShow)
    window.addEventListener('online', refresh)
    return () => {
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('pageshow', onShow)
      window.removeEventListener('online', refresh)
    }
  }, [qc])

  useEffect(() => {
    if (!booted) {
      booted = true
      captureInstallPrompt()
      if ('serviceWorker' in navigator && process.env.NODE_ENV === 'production') {
        navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' }).catch(() => {})
      }
    }
    if (!('serviceWorker' in navigator)) return
    // Bấm vào thông báo khi app đang mở: service worker nhờ trang tự chuyển tới đúng màn
    const onMessage = (e: MessageEvent) => {
      if (e.data?.type === 'navigate' && typeof e.data.url === 'string') {
        const u = new URL(e.data.url)
        if (u.origin === location.origin) router.push(u.pathname + u.search)
      }
    }
    navigator.serviceWorker.addEventListener('message', onMessage)
    return () => navigator.serviceWorker.removeEventListener('message', onMessage)
  }, [router])
  return null
}
