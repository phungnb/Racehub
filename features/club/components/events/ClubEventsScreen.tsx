'use client'

import Link from 'next/link'
import { useState } from 'react'
import { CalendarPlus, CalendarX2, CheckCircle2, Handshake, MapPin, Plus, Route, Timer, Users, Vote } from 'lucide-react'
import { Button, EmptyState, ErrorState, SectionTitle, SegmentedControl, Skeleton } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { routes } from '@/shared/config/routes'
import type { ClubEvent } from '../../api/eventsApi'
import { useClub } from '../../hooks/useClub'
import { useEvents, usePolls } from '../../hooks/useEvents'
import { eventCountdown, eventDateBadge, eventWhen } from '../../model/events'
import { EventFormSheet } from './EventFormSheet'
import { PollCard, PollFormSheet } from './Polls'

export const RSVP_LABEL = { GOING: 'Tham gia', MAYBE: 'Có thể', NOT_GOING: 'Không đi' } as const

/** Tab Lịch của CLB: sự kiện chạy nhóm (sắp tới / đã qua) + bình chọn */
export function ClubEventsScreen({ clubId }: { clubId: string }) {
  const { isStaff } = useClub(clubId)
  const [scope, setScope] = useState<'UPCOMING' | 'PAST'>('UPCOMING')
  const [creating, setCreating] = useState(false)
  const [polling, setPolling] = useState(false)
  const q = useEvents(clubId, scope)
  const polls = usePolls(clubId)

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <Link href={routes.clubTab(clubId, 'exchange')}
          className="flex items-center gap-3 rounded-2xl border border-brand/30 bg-gradient-to-r from-brand/15 to-transparent px-4 py-3">
          <Handshake className="size-5 shrink-0 text-brand" aria-hidden />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold">Giao lưu CLB</span>
            <span className="block text-xs text-fg-muted">{isStaff ? 'Gửi / trả lời thư mời chạy chung với CLB khác' : 'Các buổi chạy chung với CLB khác'}</span>
          </span>
          <span className="text-fg-subtle" aria-hidden>›</span>
        </Link>
        <div className="flex items-center gap-2">
          <SegmentedControl value={scope} onChange={setScope} className="flex-1"
            options={[{ value: 'UPCOMING', label: 'Sắp tới' }, { value: 'PAST', label: 'Đã qua' }]} />
          {isStaff && (
            <Button className="shrink-0" onClick={() => setCreating(true)}><Plus className="size-4" aria-hidden />Tạo</Button>
          )}
        </div>
        {q.isPending ? (
          <div className="space-y-2">{[0, 1, 2].map((k) => <Skeleton key={k} className="h-28" />)}</div>
        ) : q.isError ? (
          <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        ) : q.data.length === 0 ? (
          <EmptyState icon={scope === 'UPCOMING' ? CalendarPlus : CalendarX2}
            title={scope === 'UPCOMING' ? 'Chưa có buổi chạy nào sắp tới' : 'Chưa có buổi chạy nào'}
            description={scope === 'UPCOMING' ? (isStaff ? 'Tạo buổi chạy nhóm đầu tiên cho CLB.' : 'Ban quản trị sẽ lên lịch buổi chạy nhóm ở đây.') : undefined}
            action={isStaff && scope === 'UPCOMING' ? <Button onClick={() => setCreating(true)}><Plus className="size-4" aria-hidden />Tạo sự kiện</Button> : undefined} />
        ) : (
          <ul className="space-y-2">{q.data.map((e) => <li key={e.id}><EventCard clubId={clubId} event={e} /></li>)}</ul>
        )}
      </section>

      <section>
        <SectionTitle action={<Button size="sm" variant="secondary" onClick={() => setPolling(true)}><Vote className="size-4" aria-hidden />Tạo bình chọn</Button>}>
          Bình chọn
        </SectionTitle>
        {polls.isPending ? <Skeleton className="h-40" />
          : polls.isError ? <ErrorState error={polls.error} onRetry={() => void polls.refetch()} />
          : polls.data.length === 0 ? (
            <EmptyState icon={Vote} title="Chưa có bình chọn" description="Hỏi cả CLB chọn cung đường, giờ chạy, mẫu áo…" />
          ) : (
            <ul className="space-y-2">{polls.data.map((p) => <li key={p.id}><PollCard clubId={clubId} poll={p} /></li>)}</ul>
          )}
      </section>

      {creating && <EventFormSheet clubId={clubId} open onClose={() => setCreating(false)} />}
      {polling && <PollFormSheet clubId={clubId} open onClose={() => setPolling(false)} />}
    </div>
  )
}

function EventCard({ clubId, event: e }: { clubId: string; event: ClubEvent }) {
  const badge = eventDateBadge(e.starts_at)
  const cancelled = e.status === 'CANCELLED'
  const when = eventCountdown(e.starts_at, e.ends_at)
  return (
    <Link href={`${routes.club(clubId)}/events/${e.id}`}
      className={cn('flex gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-3 transition-colors hover:border-fg-subtle', cancelled && 'opacity-60')}>
      <span className="flex w-14 shrink-0 flex-col items-center justify-center rounded-xl bg-brand/10 py-2 text-brand">
        <span className="font-mono text-2xl font-black leading-none">{badge.day}</span>
        <span className="text-xs font-semibold">{badge.month}</span>
      </span>
      <span className="min-w-0 flex-1 space-y-1">
        <span className="flex items-start gap-2">
          <span className={cn('min-w-0 flex-1 truncate font-semibold', cancelled && 'line-through')}>{e.title}</span>
          {cancelled ? <span className="shrink-0 rounded-full bg-danger/15 px-2 py-0.5 text-xs font-semibold text-danger">Đã hủy</span>
            : <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold',
                when === 'Đang diễn ra' ? 'bg-live/15 text-live' : 'bg-surface-2 text-fg-muted')}>{when}</span>}
        </span>
        <span className="block text-sm text-fg-muted">{eventWhen(e.starts_at)}</span>
        <span className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-fg-subtle">
          {e.location_name && <span className="flex min-w-0 items-center gap-1"><MapPin className="size-3.5 shrink-0" aria-hidden /><span className="truncate">{e.location_name}</span></span>}
          {e.distance_km && <span className="flex items-center gap-1"><Route className="size-3.5" aria-hidden />{String(e.distance_km).replace('.', ',')} km</span>}
          {e.pace_text && <span className="flex items-center gap-1"><Timer className="size-3.5" aria-hidden />{e.pace_text}</span>}
          <span className="flex items-center gap-1"><Users className="size-3.5" aria-hidden />{e.going_count}{e.capacity ? `/${e.capacity}` : ''} tham gia</span>
        </span>
        {e.my_checked_in_at ? (
          <span className="flex items-center gap-1 text-xs font-semibold text-brand"><CheckCircle2 className="size-3.5" aria-hidden />Đã điểm danh</span>
        ) : e.my_status && e.my_status !== 'NOT_GOING' && !cancelled ? (
          <span className="text-xs font-semibold text-brand">Bạn: {RSVP_LABEL[e.my_status]}</span>
        ) : null}
      </span>
    </Link>
  )
}
