'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Swords } from 'lucide-react'
import { EmptyState, ErrorState, Skeleton } from '@/shared/ui'
import { listCups } from '../api/cupApi'
import { CupCard } from './CupCard'

/** Quản trị → Thách đấu: danh sách thách đấu do người dùng thường tạo, chờ duyệt */
export function CupReviewList() {
  const q = useQuery({ queryKey: ['cups', 'REVIEW'], queryFn: () => listCups('REVIEW') })
  const [now] = useState(() => Date.now())
  if (q.isPending) return <Skeleton className="h-32" />
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />
  if (!q.data.length) return <EmptyState icon={Swords} title="Không có thách đấu chờ duyệt" description="Thách đấu do ban quản trị CLB tạo được mở ngay, không cần duyệt." />
  return (
    <div className="space-y-3">
      <p className="text-sm text-fg-muted">{q.data.length} thách đấu chờ duyệt — bấm vào để xem và duyệt / từ chối.</p>
      <ul className="space-y-3">{q.data.map((c) => <li key={c.id}><CupCard c={c} now={now} /></li>)}</ul>
    </div>
  )
}
