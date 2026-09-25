'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { supabase } from '@/shared/lib/supabase'
import { countUnread, listNotifications, markNotificationsRead, type AppNotification } from '../api/notificationApi'

export const notificationKeys = {
  all: ['notifications'] as const,
  list: ['notifications', 'list'] as const,
  unread: ['notifications', 'unread'] as const,
}

export function useNotifications() {
  return useQuery({ queryKey: notificationKeys.list, queryFn: () => listNotifications() })
}

export function useUnreadCount(enabled = true) {
  return useQuery({ queryKey: notificationKeys.unread, queryFn: countUnread, enabled, staleTime: 30_000 })
}

export function useMarkNotificationsRead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (ids?: string[]) => markNotificationsRead(ids),
    onSuccess: () => qc.invalidateQueries({ queryKey: notificationKeys.all }),
  })
}

/** Lắng nghe thông báo mới (realtime) cho người đang đăng nhập; hiện toast ngắn. Gắn một lần trong khung app. */
export function useNotificationStream(userId: string | undefined) {
  const qc = useQueryClient()
  const router = useRouter()
  useEffect(() => {
    if (!userId) return
    const channel = supabase
      .channel(`notifications:${userId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` },
        (payload) => {
          const n = payload.new as AppNotification
          qc.invalidateQueries({ queryKey: notificationKeys.all })
          // Được duyệt vào CLB → mở khóa ngay không gian CLB đang xem (không cần tải lại trang)
          if (n.kind === 'CLUB_APPROVED' && n.club_id) {
            qc.invalidateQueries({ queryKey: ['club', n.club_id] })
            qc.invalidateQueries({ queryKey: ['clubs'] })
          }
          // Không làm phiền khi đang ở đúng màn hình mà thông báo trỏ tới
          if (n.link && window.location.pathname === n.link.split('?')[0]) return
          const link = n.link
          toast(n.title, {
            description: n.body ?? undefined,
            duration: n.kind === 'RUN_SYNCED' ? 10_000 : undefined,
            action: link ? { label: n.kind === 'RUN_SYNCED' ? 'Nhận thưởng' : 'Xem', onClick: () => router.push(link) } : undefined,
          })
        })
      .subscribe()
    return () => { void supabase.removeChannel(channel) }
  }, [userId, qc, router])
}
