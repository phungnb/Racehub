'use client'

import { CheckCircle2, Check, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button, EmptyState, ErrorState, Skeleton } from '@/shared/ui'
import { formatKm, formatRelative } from '@/shared/lib/format'
import { adminErrorMessage } from '../api/adminApi'
import { usePendingActivities, useReviewActivity } from '../hooks/useAdmin'

/** Duyệt bài chạy bị hệ thống gắn cờ (pace bất thường, GPS nhảy...) */
export function ReviewTab() {
  const list = usePendingActivities()
  const review = useReviewActivity()
  const act = async (id: string, status: 'APPROVED' | 'REJECTED') => {
    try {
      await review.mutateAsync({ id, status })
      toast.success(status === 'APPROVED' ? 'Đã duyệt, Xu và XP được cộng' : 'Đã từ chối bài chạy')
    } catch (e) {
      toast.error(adminErrorMessage(e))
    }
  }

  if (list.isPending) return <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-24" />)}</div>
  if (list.isError) return <ErrorState message={adminErrorMessage(list.error)} onRetry={() => void list.refetch()} />
  if (!list.data.length) return <EmptyState icon={CheckCircle2} title="Không có bài chờ duyệt" description="Bài chạy bị gắn cờ sẽ xuất hiện ở đây." />
  return (
    <ul className="space-y-2">
      {list.data.map((a) => (
        <li key={a.id} className="space-y-3 rounded-xl border border-border bg-surface p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate font-semibold">{a.title || 'Buổi chạy'}</p>
              <p className="text-xs text-fg-muted">{a.profiles?.display_name ?? 'Runner'} · {formatRelative(a.started_at ?? a.created_at)}</p>
            </div>
            <p className="font-mono font-semibold">{formatKm(a.distance_m)} km</p>
          </div>
          <div className="flex gap-2">
            <Button size="sm" block onClick={() => act(a.id, 'APPROVED')} disabled={review.isPending}><Check className="size-4" aria-hidden />Duyệt</Button>
            <Button size="sm" block variant="danger" onClick={() => act(a.id, 'REJECTED')} disabled={review.isPending}><X className="size-4" aria-hidden />Từ chối</Button>
          </div>
        </li>
      ))}
    </ul>
  )
}
