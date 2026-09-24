'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { SectionTitle } from '@/shared/ui'
import { PendingRunCard } from '@/features/activity'
import { clubErrorMessage, listClubPendingRuns, reviewRun } from '../../api/clubApi'

/** Ban quản trị CLB: bài chạy của thành viên bị hệ thống nghi gian lận, chờ xác minh */
export function ClubRunReview({ clubId }: { clubId: string }) {
  const qc = useQueryClient()
  const key = ['club', clubId, 'pending-runs']
  const list = useQuery({ queryKey: key, queryFn: () => listClubPendingRuns(clubId) })
  const review = useMutation({
    mutationFn: (v: { id: string; status: 'APPROVED' | 'REJECTED' }) => reviewRun(v.id, v.status),
    onSuccess: (_, v) => {
      toast.success(v.status === 'APPROVED' ? 'Đã xác nhận hợp lệ — bài được tính thưởng và thử thách' : 'Đã đánh dấu không hợp lệ')
      void qc.invalidateQueries({ queryKey: key })
    },
    onError: (e) => toast.error(clubErrorMessage(e)),
  })
  if (!list.data?.length) return null
  return (
    <section id="review">
      <SectionTitle>Bài chạy chờ duyệt <span className="ml-1 rounded-full bg-warning px-2 text-sm text-bg">{list.data.length}</span></SectionTitle>
      <p className="-mt-1 mb-2 text-xs text-fg-muted">Hệ thống chống gian lận nghi ngờ các bài dưới đây. Xem lý do rồi xác nhận — bài hợp lệ được tính ngay.</p>
      <ul className="space-y-2">
        {list.data.map((r) => <PendingRunCard key={r.id} run={r} busy={review.isPending} onReview={(status) => review.mutate({ id: r.id, status })} />)}
      </ul>
    </section>
  )
}
