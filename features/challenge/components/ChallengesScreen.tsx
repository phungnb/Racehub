'use client'

import Link from 'next/link'
import { useState } from 'react'
import { ChevronRight, Compass, Flag, Plus, Shield, Swords, Trophy } from 'lucide-react'
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

      <Link href="/races" className="flex items-center gap-3 rounded-[var(--radius-card)] border border-brand/30 bg-gradient-to-r from-brand/15 to-surface p-3 hover:border-brand/60">
        <span className="grid size-10 place-items-center rounded-xl bg-brand/20 text-brand"><Flag className="size-5" aria-hidden /></span>
        <span className="flex-1"><span className="block font-semibold">Giải chạy ảo</span>
          <span className="block text-xs text-fg-muted">Đăng ký nhận BIB · 5K · 10K · Half · Full · giấy chứng nhận</span></span>
        <ChevronRight className="size-5 text-fg-subtle" aria-hidden />
      </Link>
      <Link href="/cups" className="flex items-center gap-3 rounded-[var(--radius-card)] border border-live/30 bg-gradient-to-r from-live/15 to-surface p-3 hover:border-live/60">
        <span className="grid size-10 place-items-center rounded-xl bg-live/20 text-live"><Swords className="size-5" aria-hidden /></span>
        <span className="flex-1"><span className="block font-semibold">Thách đấu CLB</span>
          <span className="block text-xs text-fg-muted">Nhiều CLB tranh tài · ban quản trị CLB đăng ký cho cả đội</span></span>
        <ChevronRight className="size-5 text-fg-subtle" aria-hidden />
      </Link>

      <SegmentedControl value={tab} onChange={setTab} options={TABS} />

      {q.isLoading ? (
        <div className="space-y-3">{Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-32" />)}</div>
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
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
