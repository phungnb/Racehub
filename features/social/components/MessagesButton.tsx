'use client'

import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { MessageCircle } from 'lucide-react'
import { routes } from '@/shared/config/routes'
import { getUnreadMessages } from '../api/socialApi'
import { socialKeys } from '../hooks/keys'

/** Nút Tin nhắn trên thanh trên cùng, kèm số tin chưa đọc (làm mới 60 giây / lần) */
export function MessagesButton() {
  const { data: unread = 0 } = useQuery({ queryKey: socialKeys.unread, queryFn: getUnreadMessages, refetchInterval: 60_000, retry: false })
  return (
    <Link href={routes.messages} aria-label={unread > 0 ? `Tin nhắn, ${unread} chưa đọc` : 'Tin nhắn'}
      className="relative grid size-11 place-items-center rounded-full text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg">
      <MessageCircle className="size-5" aria-hidden />
      {unread > 0 && (
        <span className="absolute right-1.5 top-1.5 grid min-w-5 place-items-center rounded-full bg-live px-1 font-mono text-xs font-bold leading-5 text-white">
          {unread > 99 ? '99+' : unread}
        </span>
      )}
    </Link>
  )
}
