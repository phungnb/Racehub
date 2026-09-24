'use client'

import Link from 'next/link'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Flag, Plus } from 'lucide-react'
import { Button, EmptyState, ErrorState, SegmentedControl, Skeleton } from '@/shared/ui'
import { listRaces, type RaceScope } from '../api/raceApi'
import { RaceCard } from './RaceCard'

const TABS: { value: RaceScope; label: string }[] = [
  { value: 'UPCOMING', label: 'Sắp & đang diễn ra' },
  { value: 'MINE', label: 'Của tôi' },
  { value: 'PAST', label: 'Đã xong' },
]

export function RacesScreen({ canCreate }: { canCreate: boolean }) {
  const [scope, setScope] = useState<RaceScope>('UPCOMING')
  const [now] = useState(() => Date.now())
  const q = useQuery({ queryKey: ['races', scope], queryFn: () => listRaces(scope) })
  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Giải chạy ảo</h1>
          <p className="text-sm text-fg-muted">Đăng ký, nhận BIB, chạy ở đâu cũng được</p>
        </div>
        {canCreate && <Link href="/races/new"><Button size="sm"><Plus className="size-4" aria-hidden />Tạo giải</Button></Link>}
      </div>
      <SegmentedControl value={scope} onChange={setScope} options={TABS} />
      {q.isPending ? <div className="space-y-3">{[0, 1].map((i) => <Skeleton key={i} className="h-36" />)}</div>
        : q.isError ? <ErrorState onRetry={() => void q.refetch()} />
        : !q.data.length ? (
          <EmptyState icon={Flag} title={scope === 'MINE' ? 'Bạn chưa đăng ký giải nào' : 'Chưa có giải nào'}
            description={canCreate ? 'Tạo giải chạy ảo cho CLB: chọn cự ly, hạn đăng ký, số BIB — kết quả tự cập nhật từ bài chạy.' : 'Giải chạy ảo do CLB hoặc RaceHub tổ chức sẽ hiện ở đây.'} />
        ) : <ul className="space-y-3">{q.data.map((r) => <li key={r.id}><RaceCard r={r} now={now} /></li>)}</ul>}
    </div>
  )
}
