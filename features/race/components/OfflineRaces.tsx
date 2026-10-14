'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Flag } from 'lucide-react'
import { EmptyState, ErrorState, SegmentedControl, Skeleton } from '@/shared/ui'
import { listListings } from '../api/listingApi'
import { ListingCard } from './ListingCard'

const WHEN = [{ value: 'NEXT', label: 'Sắp tới' }, { value: 'PAST', label: 'Đã diễn ra' }] as const

const todayVN = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date())

/** Tin giải chạy offline (ngoài đời): xem và bấm sang trang đăng ký của BTC. */
export function OfflineRaces({ isAdmin }: { isAdmin: boolean }) {
  const [when, setWhen] = useState<'NEXT' | 'PAST'>('NEXT')
  const [today] = useState(todayVN)
  const q = useQuery({ queryKey: ['race-listings', when, today], queryFn: () => listListings(when === 'PAST', today) })
  return (
    <div className="space-y-3">
      <SegmentedControl value={when} onChange={setWhen} options={[...WHEN]} />
      {q.isPending ? <div className="space-y-3">{[0, 1].map((i) => <Skeleton key={i} className="h-40" />)}</div>
        : q.isError ? <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        : !q.data.length ? <EmptyState icon={Flag} title={when === 'NEXT' ? 'Chưa có giải sắp tới' : 'Chưa có giải nào'} description="RaceHub sẽ cập nhật các giải chạy ngoài đời tại đây." />
        : <ul className="space-y-3">{q.data.map((l) => <li key={l.id}><ListingCard l={l} isAdmin={isAdmin} /></li>)}</ul>}
    </div>
  )
}
