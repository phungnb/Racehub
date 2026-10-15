'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Flag } from 'lucide-react'
import { EmptyState, ErrorState, SegmentedControl, Skeleton } from '@/shared/ui'
import { countPending, listListings, raceCalendar } from '../api/listingApi'
import { ListingCard } from './ListingCard'
import { EditRaceSheet } from './EditRaceSheet'
import { RaceTable } from './RaceTable'

const WHEN = [{ value: 'TABLE', label: 'Bảng tổng hợp' }, { value: 'NEXT', label: 'Tin giải' }, { value: 'PAST', label: 'Đã diễn ra' }] as const

const todayVN = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date())

/** Tin giải chạy offline (ngoài đời): xem và bấm sang trang đăng ký của BTC. */
export function OfflineRaces({ isAdmin }: { isAdmin: boolean }) {
  const [when, setWhen] = useState<'TABLE' | 'NEXT' | 'PAST'>('TABLE')
  const qc = useQueryClient()
  const [editId, setEditId] = useState<string | null>(null)
  const [today] = useState(todayVN)
  const q = useQuery({ queryKey: ['race-listings', when, today], queryFn: () => listListings(when === 'PAST', today), enabled: when !== 'TABLE' })
  const cal = useQuery({ queryKey: ['race-calendar'], queryFn: raceCalendar, enabled: when === 'TABLE' })
  const pending = useQuery({ queryKey: ['race-pending'], queryFn: countPending, enabled: isAdmin, staleTime: 60_000 })
  return (
    <div className="space-y-3">
      {isAdmin && (
        <Link href="/races/listing/queue" className="flex items-center justify-between rounded-xl border border-brand/30 bg-brand/10 px-3 py-2 text-sm font-semibold">
          <span>Duyệt giải tự tìm</span>
          <span className="rounded-full bg-brand px-2 py-0.5 text-xs text-brand-fg">{pending.data ?? 0} chờ</span>
        </Link>
      )}
      <SegmentedControl value={when} onChange={setWhen} options={[...WHEN]} />
      {when === 'TABLE' ? (
        cal.isPending ? <Skeleton className="h-40" /> : cal.isError ? <ErrorState error={cal.error} onRetry={() => void cal.refetch()} />
          : !cal.data.length ? <EmptyState icon={Flag} title="Bảng giải đang trống" description="RaceHub sẽ cập nhật các giải chạy offline và online tại đây." />
          : <RaceTable rows={cal.data} onEdit={isAdmin ? setEditId : undefined} />
      ) : q.isPending ? <div className="space-y-3">{[0, 1].map((i) => <Skeleton key={i} className="h-40" />)}</div>
        : q.isError ? <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        : !q.data.length ? <EmptyState icon={Flag} title={when === 'NEXT' ? 'Chưa có giải sắp tới' : 'Chưa có giải nào'} description="RaceHub sẽ cập nhật các giải chạy ngoài đời tại đây." />
        : <ul className="space-y-3">{q.data.map((l) => <li key={l.id}><ListingCard l={l} isAdmin={isAdmin} /></li>)}</ul>}
      {isAdmin && editId && cal.data?.find((r) => r.id === editId) && (
        <EditRaceSheet key={editId} row={cal.data.find((r) => r.id === editId)!} onClose={() => setEditId(null)}
          onSaved={() => { setEditId(null); void qc.invalidateQueries({ queryKey: ['race-calendar'] }) }} />
      )}
    </div>
  )
}
