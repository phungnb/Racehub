'use client'

import { CheckCircle2 } from 'lucide-react'
import { toast } from 'sonner'
import { EmptyState, ErrorState, Skeleton } from '@/shared/ui'
import { PendingRunCard } from '@/features/activity'
import { adminErrorMessage } from '../api/adminApi'
import { usePendingActivities, useReviewActivity } from '../hooks/useAdmin'

/** Duyệt bài chạy bị hệ thống chống gian lận gắn cờ (mọi CLB) */
export function ReviewTab() {
  const list = usePendingActivities()
  const review = useReviewActivity()
  const act = async (id: string, status: 'APPROVED' | 'REJECTED') => {
    try {
      await review.mutateAsync({ id, status })
      toast.success(status === 'APPROVED' ? 'Đã xác nhận hợp lệ — Xu, XP và thử thách được cộng' : 'Đã đánh dấu không hợp lệ')
    } catch (e) {
      toast.error(adminErrorMessage(e))
    }
  }

  if (list.isPending) return <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-24" />)}</div>
  if (list.isError) return <ErrorState message={adminErrorMessage(list.error)} onRetry={() => void list.refetch()} />
  if (!list.data.length) return <EmptyState icon={CheckCircle2} title="Không có bài chờ duyệt" description="Chỉ bài nghi gian lận mới xuất hiện ở đây." />
  return (
    <ul className="space-y-2">
      {list.data.map((a) => <PendingRunCard key={a.id} run={a} busy={review.isPending} onReview={(s) => act(a.id, s)} />)}
    </ul>
  )
}
