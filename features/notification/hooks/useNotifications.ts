'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { supabase } from '@/shared/lib/supabase'
import { countUnread, deleteNotifications, listNotifications, markNotificationsRead, type AppNotification } from '../api/notificationApi'

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

/** Xóa thông báo: bỏ khỏi danh sách ngay, lỗi thì tải lại */
export function useDeleteNotifications() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (v: { ids: string[] | null; readOnly?: boolean }) => deleteNotifications(v.ids, v.readOnly),
    onMutate: (v) => qc.setQueryData<AppNotification[]>(notificationKeys.list, (list) =>
      list?.filter((n) => (v.ids ? !v.ids.includes(n.id) : !(v.readOnly && n.read_at)))),
    onError: () => { toast.error('Chưa xóa được thông báo. Thử lại sau.') },
    onSettled: () => qc.invalidateQueries({ queryKey: notificationKeys.all }),
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
          // Tin nhắn / theo dõi mới → làm mới hộp thư, số chưa đọc, trạng thái theo dõi
          if (n.kind === 'DM' || n.kind === 'FOLLOW') qc.invalidateQueries({ queryKey: ['social'] })
          // Không làm phiền khi đang ở đúng màn hình mà thông báo trỏ tới
          if (n.link && window.location.pathname === n.link.split('?')[0]) return
          const link = n.link
          toast(n.title, {
            description: n.body ?? undefined,
            duration: n.kind === 'RUN_SYNCED' ? 10_000 : undefined,
            action: link ? { label: n.kind === 'RUN_SYNCED' ? 'Nhận thưởng' : n.kind === 'DM' ? 'Trả lời' : 'Xem', onClick: () => router.push(link) } : undefined,
          })
        })
      .subscribe()
    return () => { void supabase.removeChannel(channel) }
  }, [userId, qc, router])
}
