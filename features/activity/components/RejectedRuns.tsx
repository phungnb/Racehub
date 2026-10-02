'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { SectionTitle } from '@/shared/ui'
import { getFraudReviewStats, listRejectedRuns, restoreErrorMessage, restoreRun } from '../api/reviewApi'
import { PendingRunCard } from './PendingRunCard'

/** Bài bị loại 30 ngày gần đây + khôi phục bài loại nhầm (012500). clubId = null: toàn hệ thống (admin) */
export function RejectedRuns({ clubId }: { clubId: string | null }) {
  const qc = useQueryClient()
  const key = ['rejected-runs', clubId ?? 'all']
  const list = useQuery({ queryKey: key, queryFn: () => listRejectedRuns(clubId) })
  const restore = useMutation({
    mutationFn: (v: { id: string; note: string }) => restoreRun(v.id, v.note),
    onSuccess: () => {
      toast.success('Đã khôi phục — bài được tính Xu, XP và thử thách')
      void qc.invalidateQueries({ queryKey: key })
    },
    onError: (e) => toast.error(restoreErrorMessage(e)),
  })
  if (!list.data?.length) return null
  return (
    <section>
      <SectionTitle>Bài đã loại (30 ngày)</SectionTitle>
      <p className="-mt-1 mb-2 text-xs text-fg-muted">Loại nhầm? Ghi lý do rồi khôi phục — lịch sử quyết định được lưu lại để chỉnh luật.</p>
      <ul className="space-y-2">
        {list.data.map((r) => <PendingRunCard key={r.id} run={r} busy={restore.isPending} onRestore={(note) => restore.mutate({ id: r.id, note })} />)}
      </ul>
    </section>
  )
}

/** Tỷ lệ báo nhầm thật (admin): bài hệ thống giữ lại rồi được người duyệt xác nhận hợp lệ */
export function FraudReviewStatsCard() {
  const q = useQuery({ queryKey: ['fraud-review-stats'], queryFn: () => getFraudReviewStats(90) })
  if (!q.data) return null
  const s = q.data
  const fp = s.false_positive_rate == null ? '—' : `${Math.round(s.false_positive_rate * 100)}%`
  return (
    <div className="rounded-xl border border-border bg-surface p-3 text-sm">
      <p className="font-semibold">Chất lượng chống gian lận (90 ngày)</p>
      <p className="mt-1 text-fg-muted">
        Giữ lại {s.held} bài · hợp lệ sau khi duyệt {s.approved_after_review} · loại {s.rejected} · khôi phục {s.restored} · còn chờ {s.still_pending}
      </p>
      <p className="mt-1">Tỷ lệ báo nhầm: <b className={s.false_positive_rate != null && s.false_positive_rate > 0.3 ? 'text-danger' : 'text-brand'}>{fp}</b></p>
      {!!s.by_rule.length && (
        <p className="mt-1 text-xs text-fg-muted">Theo luật: {s.by_rule.map((r) => `${r.code} ${r.approved}/${r.held} hợp lệ`).join(' · ')}</p>
      )}
    </div>
  )
}
