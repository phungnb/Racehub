'use client'

import Link from 'next/link'
import { Plus, Trophy } from 'lucide-react'
import { isStaff, useClubInbox } from '@/features/club'
import { Button, EmptyState, ErrorState, Skeleton } from '@/shared/ui'
import { useChallengeList } from '../../hooks/useChallenge'
import { ChallengeCard } from './ChallengeCard'

/** Tab "Thử thách" trong không gian CLB: thử thách nội bộ, ban quản trị tạo mới (thưởng trích quỹ CLB) */
export function ClubChallengesTab({ clubId }: { clubId: string }) {
  const q = useChallengeList('CLUB', clubId)
  const inbox = useClubInbox()
  const staff = isStaff(inbox.data?.find((c) => c.club_id === clubId)?.role)
  const create = <Link href={`/challenges/new?club=${clubId}`}><Button size="sm"><Plus className="size-4" aria-hidden />Tạo thử thách CLB</Button></Link>

  return (
    <div className="space-y-3">
      {staff && <div className="flex justify-end">{create}</div>}
      {q.isLoading ? (
        <div className="space-y-3">{Array.from({ length: 2 }, (_, i) => <Skeleton key={i} className="h-32" />)}</div>
      ) : q.isError ? (
        <ErrorState onRetry={() => q.refetch()} />
      ) : !q.data?.length ? (
        <EmptyState icon={Trophy} title="CLB chưa có thử thách nào"
          description={staff
            ? 'Tạo thử thách tháng, chia đội trong CLB và treo thưởng bằng quỹ CLB để cả nhóm cùng chạy.'
            : 'Khi ban quản trị tạo thử thách nội bộ, bạn sẽ nhận thông báo và thấy ở đây.'}
          action={staff ? create : undefined} />
      ) : (
        <ul className="space-y-3">{q.data.map((c) => <li key={c.id}><ChallengeCard c={c} /></li>)}</ul>
      )}
    </div>
  )
}
