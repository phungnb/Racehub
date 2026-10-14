'use client'

import Link from 'next/link'
import { CalendarDays, ExternalLink, MapPin } from 'lucide-react'
import { cn } from '@/shared/lib/cn'
import { fmtDate } from './RaceCard'
import type { RaceListing } from '../api/listingApi'

const STATUS = { DRAFT: 'Nháp', HIDDEN: 'Đã ẩn' } as const

export function ListingCard({ l, isAdmin }: { l: RaceListing; isAdmin: boolean }) {
  return (
    <div className="overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface">
      {l.image_url && <img src={l.image_url} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-36 w-full object-cover" />}
      <div className="space-y-2 p-4">
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-lg font-bold leading-tight">{l.title}</h3>
          {l.status !== 'PUBLISHED' && <span className="shrink-0 rounded-full bg-warning/15 px-2 py-0.5 text-xs font-semibold text-warning">{STATUS[l.status]}</span>}
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-muted">
          <span className="flex items-center gap-1"><CalendarDays className="size-3.5" aria-hidden />{fmtDate(l.race_date)}{l.end_date && l.end_date !== l.race_date ? ` – ${fmtDate(l.end_date)}` : ''}</span>
          {(l.location || l.province) && <span className="flex items-center gap-1"><MapPin className="size-3.5" aria-hidden />{[l.location, l.province].filter(Boolean).join(', ')}</span>}
        </div>
        {l.distances.length > 0 && (
          <div className="flex flex-wrap gap-1.5">{l.distances.map((d) => <span key={d} className="rounded-full border border-border bg-bg/40 px-2 py-0.5 text-xs font-semibold">{d}</span>)}</div>
        )}
        {l.description && <p className="line-clamp-3 text-sm text-fg-muted">{l.description}</p>}
        <div className="flex items-center gap-3 pt-1">
          {l.reg_url && (
            <a href={l.reg_url} target="_blank" rel="noopener noreferrer nofollow"
              className={cn('inline-flex h-9 items-center gap-1.5 rounded-xl bg-brand px-3 text-sm font-semibold text-brand-fg')}>
              Đăng ký / xem chi tiết<ExternalLink className="size-3.5" aria-hidden />
            </a>
          )}
          {isAdmin && <Link href={`/races/listing/${l.id}`} className="text-sm font-semibold text-fg-muted hover:text-fg">Sửa</Link>}
        </div>
      </div>
    </div>
  )
}
