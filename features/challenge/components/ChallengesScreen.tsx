'use client'

import Link from 'next/link'
import { useState } from 'react'
import { Compass, Plus, Shield, Trophy } from 'lucide-react'
import { Button, EmptyState, ErrorState, SegmentedControl, Skeleton } from '@/shared/ui'
import type { ChallengeTab } from '../api/challengeApi'
import { useChallengeList } from '../hooks/useChallenge'
import { ChallengeCard } from './list/ChallengeCard'

const TABS: { value: ChallengeTab; label: string }[] = [
  { value: 'MINE', label: 'Của tôi' },
  { value: 'DISCOVER', label: 'Khám phá' },
  { value: 'CLUB', label: 'CLB' },
  { value: 'ENDED', label: 'Đã xong' },
]

const EMPTY: Record<ChallengeTab, { title: string; description: string }> = {
  MINE: { title: 'Bạn chưa tham gia thử thách nào', description: 'Vào Khám phá để tìm thử thách hợp sức, hoặc tự tạo một mục tiêu cho riêng mình.' },
  DISCOVER: { title: 'Chưa có thử thách công khai', description: 'Hãy là người đầu tiên tạo thử thách cho cộng đồng.' },
  CLUB: { title: 'CLB của bạn chưa có thử thách', description: 'Ban quản trị CLB có thể tạo thử thách nội bộ, treo thưởng bằng quỹ CLB.' },
  ENDED: { title: 'Chưa có thử thách đã xong', description: 'Kết quả và phần thưởng của các thử thách bạn tham gia sẽ nằm ở đây.' },
}

export function ChallengesScreen() {
  const [tab, setTab] = useState<ChallengeTab>('MINE')
  const q = useChallengeList(tab)

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Thử thách</h1>
          <p className="text-sm text-fg-muted">Cá nhân, đồng đội và cả CLB</p>
        </div>
        <Link href="/challenges/new"><Button size="sm"><Plus className="size-4" aria-hidden />Tạo</Button></Link>
      </div>

      <SegmentedControl value={tab} onChange={setTab} options={TABS} />

      {q.isLoading ? (
        <div className="space-y-3">{Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-32" />)}</div>
      ) : q.isError ? (
        <ErrorState onRetry={() => q.refetch()} />
      ) : !q.data?.length ? (
        <EmptyState icon={tab === 'DISCOVER' ? Compass : tab === 'CLUB' ? Shield : Trophy} {...EMPTY[tab]}
          action={tab === 'MINE'
            ? <Button size="sm" variant="secondary" onClick={() => setTab('DISCOVER')}><Compass className="size-4" aria-hidden />Khám phá</Button>
            : <Link href="/challenges/new"><Button size="sm"><Plus className="size-4" aria-hidden />Tạo thử thách</Button></Link>} />
      ) : (
        <ul className="space-y-3">{q.data.map((c) => <li key={c.id}><ChallengeCard c={c} /></li>)}</ul>
      )}
    </div>
  )
}
