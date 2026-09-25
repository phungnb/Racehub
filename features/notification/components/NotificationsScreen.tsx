'use client'

import Link from 'next/link'
import { AtSign, Award, Bell, BellRing, CalendarDays, CheckCheck, Coins, Crown, Flag, Footprints, Gift, HandCoins, Heart, Medal, Megaphone, MessageCircle, ShieldAlert, Sparkles, Swords, Ticket, TrendingUp, Trophy, UserCheck, UserPlus, Vote, X, type LucideIcon } from 'lucide-react'
import { useState } from 'react'
import { routes } from '@/shared/config/routes'
import { usePush } from '../hooks/usePush'
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
  CLUB_EVENT: { icon: CalendarDays, tone: 'text-brand' },
  CLUB_DUE: { icon: HandCoins, tone: 'text-coin' },
  CLUB_POLL: { icon: Vote, tone: 'text-xp' },
  PUSH_TEST: { icon: BellRing, tone: 'text-brand' },
  CLUB_BATTLE: { icon: Swords, tone: 'text-live' },
  CLUB_CUP: { icon: Swords, tone: 'text-coin' },
  RACE_FINISHED: { icon: Medal, tone: 'text-coin' },
  RACE_CANCELLED: { icon: Flag, tone: 'text-danger' },
  RUN_REVIEW: { icon: ShieldAlert, tone: 'text-warning' },
  RUN_SYNCED: { icon: Footprints, tone: 'text-brand' },
  CLUB_RUN_REVIEW: { icon: ShieldAlert, tone: 'text-warning' },
  CLUB_PRO: { icon: Crown, tone: 'text-coin' },
  VIP: { icon: Crown, tone: 'text-coin' },
  GIFT: { icon: Gift, tone: 'text-coin' },
  REFERRAL: { icon: UserPlus, tone: 'text-brand' },
  PROMO: { icon: Gift, tone: 'text-coin' },
  SHINE: { icon: Sparkles, tone: 'text-coin' },
  THANKS: { icon: Heart, tone: 'text-danger' },
  HONOR: { icon: Crown, tone: 'text-coin' },
  CLUB_ROLE: { icon: Crown, tone: 'text-coin' },
  VOUCHER: { icon: Ticket, tone: 'text-danger' },
}

/** Gợi ý bật thông báo đẩy khi thiết bị hỗ trợ mà chưa bật (ẩn được trong phiên) */
function PushPrompt() {
  const push = usePush()
  const [hidden, setHidden] = useState(false)
  const [busy, setBusy] = useState(false)
  const show = !hidden && push.subscribed === false && push.permission !== 'denied' && (push.support === 'ok' || push.support === 'ios-install')
  if (!show) return null
  return (
    <div className="relative flex items-center gap-3 rounded-[var(--radius-card)] border border-brand/30 bg-brand/10 p-3">
      <BellRing className="size-6 shrink-0 text-brand" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">Không bỏ lỡ buổi chạy nào</p>
        <p className="text-xs text-fg-muted">{push.support === 'ios-install' ? 'Cài app lên màn hình chính để nhận thông báo trên iPhone' : 'Bật thông báo để nhận nhắc lịch chạy, thu quỹ ngay trên điện thoại'}</p>
      </div>
      {push.support === 'ok' ? (
        <Button size="sm" loading={busy} onClick={() => { setBusy(true); void push.enable().catch(() => {}).finally(() => setBusy(false)) }}>Bật</Button>
      ) : (
        <Link href={routes.settings}><Button size="sm" variant="secondary">Cách cài</Button></Link>
      )}
      <button type="button" aria-label="Ẩn" onClick={() => setHidden(true)} className="grid size-8 shrink-0 place-items-center rounded-full text-fg-subtle hover:bg-surface-2">
        <X className="size-4" aria-hidden />
      </button>
    </div>
  )
}

export function NotificationsScreen() {
  const { data, isLoading, isError, error, refetch } = useNotifications()
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

      <PushPrompt />

      {isLoading ? (
        <div className="space-y-2">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-16" />)}</div>
      ) : isError ? (
        <ErrorState error={error} onRetry={() => refetch()} />
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
