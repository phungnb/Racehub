'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { CalendarClock, ChevronRight, Flag, MapPin } from 'lucide-react'
import { routes } from '@/shared/config/routes'
import { myUpcomingEvents, eventWhen, eventCountdown, type UpcomingEvent } from '@/features/club'
import { bucketChallenges, formatScore, timeLabel, useChallengeList, type ChallengeListItem } from '@/features/challenge'

const RSVP_LABEL = { GOING: 'Đã tham gia', MAYBE: 'Có thể', NOT_GOING: 'Không tham gia' } as const

function EventRow({ e, now }: { e: UpcomingEvent; now: Date }) {
  const needsReply = !e.my_status
  return (
    <Link href={`${routes.club(e.club_id)}/events/${encodeURIComponent(e.id)}`}
      className="flex items-center gap-3 rounded-xl border border-border bg-surface px-3 py-2.5 hover:border-fg-subtle">
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand/15 text-brand"><CalendarClock className="size-5" aria-hidden /></span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">{e.title}</span>
        <span className="block truncate text-xs text-fg-muted">{e.club_name ? `${e.club_name} · ` : ''}{eventWhen(e.starts_at)}</span>
        {e.location_name && <span className="flex items-center gap-1 truncate text-xs text-fg-subtle"><MapPin className="size-3 shrink-0" aria-hidden />{e.location_name}</span>}
      </span>
      <span className="shrink-0 text-right">
        <span className="block text-xs font-semibold text-live">{eventCountdown(e.starts_at, e.ends_at, now)}</span>
        <span className={needsReply ? 'mt-0.5 inline-block rounded-full bg-brand px-2 py-0.5 text-[11px] font-bold text-brand-fg' : 'block text-[11px] text-fg-subtle'}>
          {needsReply ? 'Bấm để đăng ký' : RSVP_LABEL[e.my_status!]}
        </span>
      </span>
    </Link>
  )
}

function ChallengeRow({ c, now }: { c: ChallengeListItem; now: Date }) {
  return (
    <Link href={routes.challenge(c.id)} className="flex items-center gap-3 rounded-xl border border-border bg-surface px-3 py-2.5 hover:border-fg-subtle">
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-live/15 text-live"><Flag className="size-5" aria-hidden /></span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">{c.title}</span>
        <span className="block truncate text-xs text-fg-muted">
          Thử thách đang tham gia{c.my_score != null ? ` · ${formatScore(c.objective, c.my_score)}` : ''}{c.my_rank ? ` · hạng ${c.my_rank}` : ''}
        </span>
      </span>
      <span className="shrink-0 text-xs font-semibold text-live">{timeLabel(c, now)}</span>
    </Link>
  )
}

/** Đầu trang chủ: lịch CLB gần nhất + thử thách đang tham gia, để mở app là thấy việc sắp tới */
export function UpcomingCard() {
  const [now] = useState(() => new Date())
  const events = useQuery({ queryKey: ['my-upcoming-events'], queryFn: () => myUpcomingEvents(5), staleTime: 60_000, refetchOnWindowFocus: true })
  const mine = useChallengeList('MINE')

  // Chỉ thử thách tôi đã tham gia (không tính thử thách tôi chỉ là người tạo)
  const joined = (mine.data ?? []).filter((c) => c.my_status && c.my_status !== 'LEFT')
  const buckets = bucketChallenges(joined, now)
  const challenge = buckets.LIVE[0] ?? buckets.UPCOMING[0] ?? null
  const list = (events.data ?? []).filter((e) => Date.parse(e.ends_at) > now.getTime())
  const shown = list.slice(0, 2)
  if (!shown.length && !challenge) return null

  return (
    <section className="space-y-2" aria-label="Sắp tới">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-bold">Sắp tới của bạn</h2>
        {list.length > shown.length && (
          <Link href={routes.clubs} className="flex items-center text-xs font-semibold text-brand">Còn {list.length - shown.length} lịch khác<ChevronRight className="size-4" aria-hidden /></Link>
        )}
      </div>
      <ul className="space-y-2">
        {shown.map((e) => <li key={e.id}><EventRow e={e} now={now} /></li>)}
        {challenge && <li><ChallengeRow c={challenge} now={now} /></li>}
      </ul>
    </section>
  )
}
