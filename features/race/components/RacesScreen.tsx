'use client'

import Link from 'next/link'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Flag, Plus } from 'lucide-react'
import { Button, EmptyState, ErrorState, PageHeader, SegmentedControl, Skeleton } from '@/shared/ui'
import { listRaces, type RaceScope } from '../api/raceApi'
import { RaceCard } from './RaceCard'
import { OfflineRaces } from './OfflineRaces'
import { useOrganizer } from '../hooks/useOrganizer'

const TABS: { value: RaceScope; label: string }[] = [
  { value: 'UPCOMING', label: 'Sắp & đang diễn ra' },
  { value: 'MINE', label: 'Của tôi' },
  { value: 'PAST', label: 'Đã xong' },
]

const KINDS = [{ value: 'OFFLINE', label: 'Giải ngoài đời' }, { value: 'APP', label: 'Giải trên app' }] as const

export function RacesScreen({ canCreate }: { canCreate: boolean }) {
  const [kind, setKind] = useState<'OFFLINE' | 'APP'>('OFFLINE')
  const { isAdmin } = useOrganizer()
  const [scope, setScope] = useState<RaceScope>('UPCOMING')
  const [now] = useState(() => Date.now())
  const q = useQuery({ queryKey: ['races', scope], queryFn: () => listRaces(scope) })
  return (
    <div className="space-y-4 animate-fade-in">
      <PageHeader title="Race" subtitle={kind === 'OFFLINE' ? 'Lịch các giải chạy ngoài đời' : 'Đăng ký, nhận BIB, chạy ở đâu cũng được'}
        action={kind === 'OFFLINE'
          ? (isAdmin ? <Link href="/races/listing/new" className="shrink-0 pt-1"><Button size="sm"><Plus className="size-4" aria-hidden />Đăng giải</Button></Link> : undefined)
          : (canCreate ? <Link href="/races/new" className="shrink-0 pt-1"><Button size="sm"><Plus className="size-4" aria-hidden />Tạo giải</Button></Link> : undefined)} />
      <SegmentedControl value={kind} onChange={setKind} options={[...KINDS]} />
      {kind === 'OFFLINE' ? <OfflineRaces isAdmin={isAdmin} /> : <>
      <SegmentedControl value={scope} onChange={setScope} options={TABS} />
      {q.isPending ? <div className="space-y-3">{[0, 1].map((i) => <Skeleton key={i} className="h-36" />)}</div>
        : q.isError ? <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        : !q.data.length ? (
          <EmptyState icon={Flag} title={scope === 'MINE' ? 'Bạn chưa đăng ký giải nào' : 'Chưa có giải nào'}
            description={canCreate ? 'Tạo giải chạy cho CLB: chọn cự ly, hạn đăng ký, số BIB — kết quả tự cập nhật từ bài chạy.' : 'Giải chạy do CLB hoặc RaceHub tổ chức sẽ hiện ở đây.'} />
        ) : <ul className="space-y-3">{q.data.map((r) => <li key={r.id}><RaceCard r={r} now={now} /></li>)}</ul>}
      </>}
    </div>
  )
}
