'use client'

import Link from 'next/link'
import { Bell } from 'lucide-react'
import { routes } from '@/shared/config/routes'
import { useNotificationStream, useUnreadCount } from '../hooks/useNotifications'

export function NotificationBell({ userId }: { userId: string | undefined }) {
  useNotificationStream(userId)
  const { data: unread = 0 } = useUnreadCount(!!userId)
  const label = unread > 0 ? `Thông báo, ${unread} chưa đọc` : 'Thông báo'
  return (
    <Link href={routes.notifications} aria-label={label}
      className="relative grid size-11 place-items-center rounded-full text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg">
      <Bell className="size-5" aria-hidden />
      {unread > 0 && (
        <span className="absolute right-1.5 top-1.5 grid min-w-5 place-items-center rounded-full bg-live px-1 font-mono text-xs font-bold leading-5 text-white">
          {unread > 99 ? '99+' : unread}
        </span>
      )}
    </Link>
  )
}
