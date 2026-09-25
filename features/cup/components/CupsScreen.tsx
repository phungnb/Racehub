'use client'

import Link from 'next/link'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, Plus, Swords } from 'lucide-react'
import { Button, EmptyState, ErrorState, SegmentedControl, Skeleton } from '@/shared/ui'
import { listCups, type CupScope } from '../api/cupApi'
import { CupCard } from './CupCard'

const TABS: { value: CupScope; label: string }[] = [
  { value: 'ACTIVE', label: 'Đang mở' },
  { value: 'MINE', label: 'CLB của tôi' },
  { value: 'DONE', label: 'Đã xong' },
]

/** Danh sách Thách đấu CLB (nhiều CLB cùng tranh tài) */
export function CupsScreen() {
  const [scope, setScope] = useState<CupScope>('ACTIVE')
  const [now] = useState(() => Date.now())
  const q = useQuery({ queryKey: ['cups', scope], queryFn: () => listCups(scope) })
  return (
    <div className="space-y-4 animate-fade-in">
      <Link href="/challenges" className="inline-flex items-center gap-1.5 text-sm text-fg-muted hover:text-fg"><ArrowLeft className="size-4" aria-hidden />Thử thách</Link>
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Thách đấu CLB</h1>
          <p className="text-sm text-fg-muted">Nhiều CLB cùng tranh tài — ban quản trị CLB đăng ký cho cả đội</p>
        </div>
        <Link href="/cups/new"><Button size="sm"><Plus className="size-4" aria-hidden />Tạo</Button></Link>
      </div>
      <SegmentedControl value={scope} onChange={setScope} options={TABS} />
      {q.isPending ? <div className="space-y-3">{[0, 1].map((i) => <Skeleton key={i} className="h-28" />)}</div>
        : q.isError ? <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        : !q.data.length ? (
          <EmptyState icon={Swords} title={scope === 'MINE' ? 'CLB của bạn chưa tham gia thách đấu nào' : 'Chưa có thách đấu nào'}
            description="Chủ nhiệm / quản trị viên CLB tạo thách đấu là mở ngay; người dùng khác tạo thì chờ admin duyệt." />
        ) : <ul className="space-y-3">{q.data.map((c) => <li key={c.id}><CupCard c={c} now={now} /></li>)}</ul>}
    </div>
  )
}
