'use client'

import Link from 'next/link'
import { Award, AtSign, Bell, CheckCheck, Coins, HandCoins, Heart, TrendingUp, Megaphone, MessageCircle, Ticket, Trophy, UserCheck, UserPlus, type LucideIcon } from 'lucide-react'
import { Avatar, Button, EmptyState, ErrorState, Skeleton } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { formatRelative } from '@/shared/lib/format'
import { useMarkNotificationsRead, useNotifications } from '../hooks/useNotifications'

const ICONS: Record<string, { icon: LucideIcon; tone: string }> = {
  CLUB_ANNOUNCEMENT: { icon: Megaphone, tone: 'text-coin' },
  CHAT_MENTION: { icon: AtSign, tone: 'text-xp' },
  POST_CHEER: { icon: Heart, tone: 'text-live' },
  POST_COMMENT: { icon: MessageCircle, tone: 'text-xp' },
  CLUB_JOIN_REQUEST: { icon: UserPlus, tone: 'text-brand' },
  CLUB_APPROVED: { icon: UserCheck, tone: 'text-brand' },
  CHALLENGE_NEW: { icon: Trophy, tone: 'text-coin' },
  ADMIN_XU: { icon: Coins, tone: 'text-coin' },
  ADMIN_PASS: { icon: Ticket, tone: 'text-brand' },
  BADGE: { icon: Award, tone: 'text-medal-gold' },
  LEVEL_UP: { icon: TrendingUp, tone: 'text-brand' },
  LEAGUE: { icon: Trophy, tone: 'text-coin' },
  CHEER: { icon: HandCoins, tone: 'text-coin' },
}

export function NotificationsScreen() {
  const { data, isLoading, isError, refetch } = useNotifications()
  const markRead = useMarkNotificationsRead()
  const unread = (data ?? []).filter((n) => !n.read_at).length

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Thông báo</h1>
        {unread > 0 && (
          <Button variant="ghost" size="sm" onClick={() => markRead.mutate(undefined)} loading={markRead.isPending}>
            <CheckCheck className="size-4" aria-hidden /> Đọc hết
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="space-y-2">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-16" />)}</div>
      ) : isError ? (
        <ErrorState onRetry={() => refetch()} />
      ) : !data?.length ? (
        <EmptyState icon={Bell} title="Chưa có thông báo"
          description="Khi CLB có thông báo mới, ai đó nhắc tên hay cổ vũ bạn, bạn sẽ thấy ở đây." />
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface">
          {data.map((n) => {
            const meta = ICONS[n.kind] ?? { icon: Bell, tone: 'text-fg-muted' }
            const Icon = meta.icon
            const content = (
              <div className={cn('flex gap-3 px-4 py-3', !n.read_at && 'bg-brand/5')}>
                <span className="relative">
                  <Avatar src={n.actor?.avatar_url} name={n.actor?.display_name ?? 'RaceHub'} size="md" />
                  <span className={cn('absolute -bottom-1 -right-1 grid size-5 place-items-center rounded-full border-2 border-surface bg-surface-2', meta.tone)}>
                    <Icon className="size-3" aria-hidden />
                  </span>
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium leading-snug">{n.title}</span>
                  {n.body && <span className="mt-0.5 line-clamp-2 block text-sm text-fg-muted">{n.body}</span>}
                  <span className="mt-1 block text-xs text-fg-subtle">{formatRelative(n.created_at)}</span>
                </span>
                {!n.read_at && <span className="mt-2 size-2 shrink-0 rounded-full bg-brand" aria-label="Chưa đọc" />}
              </div>
            )
            return (
              <li key={n.id}>
                {n.link
                  ? <Link href={n.link} onClick={() => !n.read_at && markRead.mutate([n.id])} className="block hover:bg-surface-2">{content}</Link>
                  : content}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
