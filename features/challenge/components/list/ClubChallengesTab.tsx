'use client'

import Link from 'next/link'
import { useState } from 'react'
import { Plus, Trophy } from 'lucide-react'
import { isStaff, useClubInbox } from '@/features/club'
import { Button, EmptyState, ErrorState, SegmentedControl, Skeleton } from '@/shared/ui'
import { useChallengeList } from '../../hooks/useChallenge'
import { BUCKET_LABEL, bucketChallenges, defaultBucket, type ChallengeBucket } from '../../model/challenge'
import { ChallengeCard } from './ChallengeCard'

const BUCKETS: ChallengeBucket[] = ['UPCOMING', 'LIVE', 'ENDED']
const BUCKET_EMPTY: Record<ChallengeBucket, string> = {
  UPCOMING: 'Chưa có thử thách nào sắp diễn ra.',
  LIVE: 'Không có thử thách nào đang diễn ra.',
  ENDED: 'Chưa có thử thách nào kết thúc gần đây (60 ngày).',
}

/** Tab "Thử thách" trong không gian CLB: thử thách nội bộ chia theo Sắp diễn ra · Đang diễn ra · Đã kết thúc; ban quản trị tạo mới */
export function ClubChallengesTab({ clubId }: { clubId: string }) {
  const q = useChallengeList('CLUB', clubId)
  const inbox = useClubInbox()
  const staff = isStaff(inbox.data?.find((c) => c.club_id === clubId)?.role)
  // Chưa chọn thì mở nhóm có thử thách (ưu tiên đang diễn ra)
  const [picked, setPicked] = useState<ChallengeBucket | null>(null)
  const [now] = useState(() => new Date())
  const create = <Link href={`/challenges/new?club=${clubId}`}><Button size="sm"><Plus className="size-4" aria-hidden />Tạo thử thách CLB</Button></Link>

  const buckets = bucketChallenges(q.data ?? [], now)
  const tab = picked ?? defaultBucket(buckets)
  return (
    <div className="space-y-3">
      {staff && <div className="flex justify-end">{create}</div>}
      {q.isLoading ? (
        <div className="space-y-3">{Array.from({ length: 2 }, (_, i) => <Skeleton key={i} className="h-32" />)}</div>
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data?.length ? (
        <EmptyState icon={Trophy} title="CLB chưa có thử thách nào"
          description={staff
            ? 'Tạo thử thách tháng, chia đội trong CLB và treo thưởng bằng quỹ CLB để cả nhóm cùng chạy.'
            : 'Khi ban quản trị tạo thử thách nội bộ, bạn sẽ nhận thông báo và thấy ở đây.'}
          action={staff ? create : undefined} />
      ) : (
        <>
          <SegmentedControl value={tab} onChange={setPicked}
            options={BUCKETS.map((b) => ({ value: b, label: BUCKET_LABEL[b], count: buckets[b].length }))} />
          {buckets[tab].length
            ? <ul className="space-y-3">{buckets[tab].map((c) => <li key={c.id}><ChallengeCard c={c} /></li>)}</ul>
            : <p className="py-8 text-center text-sm text-fg-muted">{BUCKET_EMPTY[tab]}</p>}
        </>
      )}
    </div>
  )
}
