'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { Avatar } from '@/shared/ui'
import { formatKm } from '@/shared/lib/format'
import { cn } from '@/shared/lib/cn'
import { listWarnedRuns, type WarnedRun } from '../api/reviewApi'
import { FLAG_LABEL, SOURCE_LABEL, TIER } from './PendingRunCard'

type Filter = 'ALL' | 'GPS' | 'MACHINE' | 'OTHER'
const FILTERS: { key: Filter; label: string }[] = [
  { key: 'ALL', label: 'Tất cả' }, { key: 'GPS', label: 'GPS nhảy' }, { key: 'MACHINE', label: 'Chạy máy / không GPS' }, { key: 'OTHER', label: 'Khác' },
]
const kindOf = (r: WarnedRun): Exclude<Filter, 'ALL'>[] => {
  const k = new Set<Exclude<Filter, 'ALL'>>()
  for (const w of r.warnings) k.add(w.gpsJump ? 'GPS' : w.code === 'TREADMILL' ? 'MACHINE' : 'OTHER')
  return [...k]
}
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '')

/**
 * Bài có cảnh báo (013400, Chỉnh sửa lần 7): bài ĐÃ ghi nhận nhưng có cảnh báo — GPS nhảy, chạy máy / không có GPS…
 * Không cần duyệt; để ban quản trị nắm và xem lại khi cần. clubId = null: toàn hệ thống (admin); có clubId: thành viên CLB.
 */
export function WarnedRuns({ clubId }: { clubId: string | null }) {
  const [filter, setFilter] = useState<Filter>('ALL')
  const [open, setOpen] = useState(false) // gập sẵn: danh sách có thể dài tới 300 bài
  const q = useQuery({ queryKey: ['warned-runs', clubId ?? 'all'], queryFn: () => listWarnedRuns(clubId) })
  if (!q.data?.length) return null
  const rows = filter === 'ALL' ? q.data : q.data.filter((r) => kindOf(r).includes(filter))
  return (
    <section>
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 rounded-xl border border-border bg-surface px-3 py-2.5 text-left">
        <span className="text-sm font-semibold">Bài có cảnh báo (30 ngày) · {q.data.length} bài</span>
        <ChevronDown className={cn('size-4 shrink-0 text-fg-subtle transition-transform', open && 'rotate-180')} aria-hidden />
      </button>
      {open && (<div className="mt-2">
      <p className="mb-2 text-xs text-fg-muted">
        Đã ghi nhận, không cần duyệt — GPS nhảy vẫn ghi nhận nếu bài có GPS; chạy máy / không có GPS ghi nhận kèm cảnh báo. Km giữ nguyên theo Strava.
      </p>
      <div className="mb-2 flex flex-wrap gap-1.5" role="group" aria-label="Lọc cảnh báo">
        {FILTERS.map((f) => (
          <button key={f.key} type="button" onClick={() => setFilter(f.key)} aria-pressed={filter === f.key}
            className={cn('rounded-full border px-2.5 py-1 text-xs', filter === f.key ? 'border-brand bg-brand/10 font-semibold text-brand' : 'border-border text-fg-muted')}>
            {f.label}
          </button>
        ))}
      </div>
      {rows.length ? (
        <ul className="space-y-2">
          {rows.map((r) => (
            <li key={r.id}>
              <Link href={`/activities/${r.id}`} className="flex items-start gap-3 rounded-xl border border-border bg-surface p-3">
                <Avatar src={r.profiles?.avatar_url} name={r.profiles?.display_name ?? 'Runner'} size="sm" />
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="truncate font-semibold">{r.profiles?.display_name ?? 'Runner'}</p>
                    <p className="shrink-0 font-mono font-semibold">{formatKm(r.distance_m)} km</p>
                  </div>
                  <p className="truncate text-xs text-fg-muted">
                    {day(r.started_at ?? r.created_at)} · {r.title || 'Buổi chạy'}{r.source ? ` · ${SOURCE_LABEL[r.source] ?? r.source}` : ''}{r.reviewed ? ' · đã duyệt' : ''}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {r.warnings.map((w, i) => (
                      <span key={i} title={w.message ?? undefined} className={cn('rounded-full border px-2 py-0.5 text-[11px]', (TIER[w.tier] ?? TIER.WARN).tone)}>
                        {FLAG_LABEL[w.code] ?? w.code}{w.gpsJump && w.code !== 'GPS_TELEPORT' ? ' (GPS nhảy)' : ''}
                      </span>
                    ))}
                  </div>
                </div>
                <ChevronRight className="mt-1 size-4 shrink-0 text-fg-subtle" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      ) : <p className="text-xs text-fg-subtle">Không có bài nào trong nhóm này.</p>}
      </div>)}
    </section>
  )
}
