'use client'

import Link from 'next/link'
import { CalendarDays, Medal, Users } from 'lucide-react'
import { cn } from '@/shared/lib/cn'
import { formatNumber } from '@/shared/lib/format'
import type { Race } from '../api/raceApi'
import { distanceLabel, racePhase } from '../model/race'

export const PHASE: Record<ReturnType<typeof racePhase>, { label: string; tone: string }> = {
  UPCOMING: { label: 'Sắp diễn ra', tone: 'bg-warning/15 text-warning' },
  LIVE: { label: 'Đang diễn ra', tone: 'bg-live/15 text-live' },
  ENDED: { label: 'Đã kết thúc', tone: 'bg-surface-2 text-fg-muted' },
  CANCELLED: { label: 'Đã hủy', tone: 'bg-danger/15 text-danger' },
}
export const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' })

export function RaceCard({ r, now }: { r: Race; now: number }) {
  const phase = racePhase(r, now)
  return (
    <Link href={`/races/${r.id}`} className="block overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface transition-colors hover:border-fg-subtle">
      <div className="relative bg-gradient-to-br from-brand/20 via-surface-2 to-surface p-4">
        <div className="flex items-center justify-between gap-2 text-xs">
          <span className={cn('rounded-full px-2 py-0.5 font-semibold', PHASE[phase].tone)}>{PHASE[phase].label}</span>
          {r.club && <span className="truncate text-fg-muted">{r.club.name}</span>}
        </div>
        <h3 className="mt-2 text-lg font-bold leading-tight">{r.title}</h3>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {r.distances.map((d) => (
            <span key={d} className={cn('rounded-full border px-2 py-0.5 text-xs font-semibold',
              r.me?.distance_km != null && Number(r.me.distance_km) === Number(d) ? 'border-brand bg-brand text-brand-fg' : 'border-border bg-bg/40')}>
              {distanceLabel(d)}
            </span>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-4 px-4 py-3 text-xs text-fg-muted">
        <span className="flex items-center gap-1"><CalendarDays className="size-3.5" aria-hidden />{fmtDate(r.start_at)} – {fmtDate(r.end_at)}</span>
        <span className="flex items-center gap-1"><Users className="size-3.5" aria-hidden />{formatNumber(r.registered)}</span>
        {r.me && (
          <span className={cn('ml-auto flex items-center gap-1 font-semibold', r.me.status === 'FINISHED' ? 'text-coin' : 'text-brand')}>
            <Medal className="size-3.5" aria-hidden />{r.me.status === 'FINISHED' ? 'Đã hoàn thành' : `BIB ${r.me.bib}`}
          </span>
        )}
      </div>
    </Link>
  )
}
