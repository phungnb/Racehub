'use client'

import { useCallback, useEffect, useSyncExternalStore } from 'react'
import { useRouter } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { supabase } from '@/shared/lib/supabase'
import { describeError } from '@/shared/lib/errors'
import { formatKm } from '@/shared/lib/format'
import { useSession } from '@/features/auth'
import { loadQueue, ownedBy, updateQueue, QUEUE_KEY } from '../model/recovery'

const QUEUED = 'rh-run-queued'          // bài mới vào hàng chờ → thử gửi ngay
const CHANGED = 'rh-run-queue-changed'  // hàng chờ đổi → chỉ cập nhật con số
const MAX_ATTEMPTS = 20
let syncing = false

const subscribe = (cb: () => void) => {
  const onStorage = (e: StorageEvent) => { if (e.key === QUEUE_KEY) cb() }
  window.addEventListener(CHANGED, cb)
  window.addEventListener(QUEUED, cb)
  window.addEventListener('storage', onStorage)
  return () => { window.removeEventListener(CHANGED, cb); window.removeEventListener(QUEUED, cb); window.removeEventListener('storage', onStorage) }
}
/** Số bài chạy của tài khoản này đang chờ gửi lên máy chủ (lưu trên máy vì lúc bấm Lưu bị mất mạng) */
export function usePendingRunCount() {
  const uid = useSession().session?.user.id
  return useSyncExternalStore(subscribe, () => ownedBy(loadQueue(), uid).length, () => 0)
}

/**
 * Gắn một lần trong khung app: có mạng lại / mở app / mỗi phút → gửi các bài chạy đang chờ.
 * Chỉ gửi bài của tài khoản đang đăng nhập (người khác dùng chung máy không nhận nhầm bài).
 * Máy chủ nhận bài trùng thì báo ACTIVITY_DUPLICATE → coi như đã gửi xong.
 */
export function usePendingRunSync() {
  const qc = useQueryClient()
  const router = useRouter()
  const uid = useSession().session?.user.id

  const flush = useCallback(async () => {
    const mine = ownedBy(loadQueue(), uid)
    if (syncing || !navigator.onLine || !mine.length) return
    syncing = true
    try {
      for (const item of mine) {
        const { data, error } = await supabase.rpc('submit_and_process_activity', item.payload)
        const done = !error || error.message.includes('ACTIVITY_DUPLICATE')
        if (done) {
          updateQueue((q) => q.filter((x) => x.id !== item.id))
          // Tóm tắt chất lượng GPS lúc chạy (008800) — tìm bài theo giờ bắt đầu nên gắn được cả khi máy chủ báo trùng
          if (item.quality) void supabase.rpc('activity_attach_gps_quality', { p_started_at: item.payload.p_started_at, p_quality: item.quality })
          const id = (data as { activity_id?: string } | null)?.activity_id
          if (!error) {
            toast.success(`Đã gửi bài chạy ${formatKm(item.payload.p_distance_m)} km lên RaceHub`, {
              description: 'Bài chạy lưu trên máy lúc mất mạng đã được ghi nhận.',
              action: id ? { label: 'Xem', onClick: () => router.push(`/activities/${id}`) } : undefined,
            })
          }
          continue
        }
        const kind = describeError(error).kind
        if (kind === 'AUTH') break
        updateQueue((q) => q.flatMap((x) => {
          if (x.id !== item.id) return [x]
          const attempts = x.attempts + 1
          // Lỗi nghiệp vụ (không phải lỗi mạng) lặp lại quá nhiều lần → bỏ để không kẹt mãi
          if (attempts >= MAX_ATTEMPTS && !['OFFLINE', 'NETWORK', 'TIMEOUT', 'SERVER'].includes(kind)) {
            toast.error('Không gửi được một bài chạy lưu trên máy', { description: error.message.slice(0, 120) })
            return []
          }
          return [{ ...x, attempts, lastError: error.message.slice(0, 200) }]
        }))
        if (['OFFLINE', 'NETWORK', 'TIMEOUT', 'SERVER'].includes(kind)) break
      }
    } finally {
      syncing = false
      window.dispatchEvent(new Event(CHANGED))
      void qc.invalidateQueries({ queryKey: ['activities'] })
      void qc.invalidateQueries({ queryKey: ['game'] })
      void qc.invalidateQueries({ queryKey: ['profile'] })
    }
  }, [qc, router, uid])

  useEffect(() => {
    const kick = () => { void flush() }
    kick()
    const id = setInterval(kick, 60_000)
    window.addEventListener('online', kick)
    window.addEventListener(QUEUED, kick)
    return () => { clearInterval(id); window.removeEventListener('online', kick); window.removeEventListener(QUEUED, kick) }
  }, [flush])

  return flush
}
