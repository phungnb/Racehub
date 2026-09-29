'use client'

import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { MessageCircle } from 'lucide-react'
import { Avatar, EmptyState, ErrorState, PageHeader, Skeleton } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { routes } from '@/shared/config/routes'
import { formatRelative } from '@/shared/lib/format'
import { getInbox } from '../api/socialApi'
import { socialKeys } from '../hooks/keys'

/** Hộp thư: các cuộc trò chuyện 1-1, mới nhất trước, đậm nếu có tin chưa đọc */
export function InboxScreen() {
  const q = useQuery({ queryKey: socialKeys.inbox, queryFn: getInbox, refetchInterval: 15_000 })
  return (
    <div className="space-y-4 animate-fade-in">
      <PageHeader title="Tin nhắn" subtitle="Nhắn riêng với runner bạn theo dõi, bạn kết nối hoặc cùng CLB" />
      {q.isPending ? (
        <div className="space-y-2">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-16" />)}</div>
      ) : q.isError ? (
        <ErrorState message="Không tải được hộp thư." error={q.error} onRetry={() => void q.refetch()} />
      ) : !q.data.length ? (
        <EmptyState icon={MessageCircle} title="Chưa có tin nhắn"
          description="Mở hồ sơ một runner rồi bấm Nhắn tin. Bạn nhắn được khi người đó theo dõi bạn, là bạn kết nối, hoặc cùng CLB." />
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
          {q.data.map((t) => (
            <li key={t.user.id}>
              <Link href={routes.message(t.user.id)} className="flex min-h-16 items-center gap-3 px-3 py-2.5 hover:bg-surface-2">
                <Avatar src={t.user.avatar_url} name={t.user.display_name} size="md" />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-2">
                    <span className={cn('min-w-0 flex-1 truncate', t.unread ? 'font-bold' : 'font-semibold')}>{t.user.display_name ?? 'Runner'}</span>
                    <span className="shrink-0 text-xs text-fg-subtle">{formatRelative(t.last_message_at)}</span>
                  </span>
                  <span className={cn('block truncate text-sm', t.unread ? 'font-semibold text-fg' : 'text-fg-muted')}>
                    {t.last ? `${t.last.mine ? 'Bạn: ' : ''}${t.last.deleted ? 'Tin nhắn đã được thu hồi' : t.last.body}` : ''}
                  </span>
                </span>
                {t.unread > 0 && (
                  <span className="grid min-w-6 place-items-center rounded-full bg-live px-1.5 text-xs font-bold leading-6 text-white" aria-label={`${t.unread} tin chưa đọc`}>
                    {t.unread > 99 ? '99+' : t.unread}
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
