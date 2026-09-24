import Link from 'next/link'
import { CalendarDays, Shield, Swords, Users } from 'lucide-react'
import { Card } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import type { Cup } from '../api/cupApi'
import { cupPhase, METRIC_LABEL, PHASE_LABEL, type CupPhase } from '../model/cup'

export const fmtDay = (iso: string) => { const d = new Date(iso); return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}` }
export const fmtTime = (iso: string) => {
  const d = new Date(iso)
  return `${fmtDay(iso)} · ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

const TONE: Record<CupPhase, string> = {
  REVIEW: 'bg-warning/15 text-warning', REJECTED: 'bg-danger/15 text-danger', CANCELLED: 'bg-surface-2 text-fg-muted',
  REGISTRATION: 'bg-brand/15 text-brand', LIVE: 'bg-danger/15 text-danger', SETTLING: 'bg-surface-2 text-fg-muted', FINISHED: 'bg-surface-2 text-fg-muted',
}

export function PhaseChip({ c, now }: { c: Cup; now: number }) {
  const p = cupPhase(c, now)
  return <span className={cn('shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-bold', TONE[p])}>{PHASE_LABEL[p]}</span>
}

export function CupCard({ c, now }: { c: Cup; now: number }) {
  return (
    <Link href={`/cups/${c.id}`} className="block">
      <Card className="space-y-2 p-4 transition-colors hover:border-fg-subtle">
        <div className="flex items-start justify-between gap-2">
          <p className="font-semibold leading-snug">{c.title}</p>
          <PhaseChip c={c} now={now} />
        </div>
        <p className="flex items-center gap-1.5 text-xs text-fg-muted">
          {c.host ? <><Shield className="size-3.5" aria-hidden />{c.host.name} tổ chức</> : <><Swords className="size-3.5" aria-hidden />{c.creator?.display_name ?? 'RaceHub'} tổ chức</>}
        </p>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-muted">
          <span className="flex items-center gap-1"><CalendarDays className="size-3.5" aria-hidden />{fmtDay(c.start_at)} – {fmtDay(c.end_at)}</span>
          <span className="flex items-center gap-1"><Users className="size-3.5" aria-hidden />{c.clubs}/{c.max_clubs} CLB</span>
          <span>{METRIC_LABEL[c.metric].title}</span>
        </div>
      </Card>
    </Link>
  )
}
