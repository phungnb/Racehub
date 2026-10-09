'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { deleteRejectedRuns, getFraudReviewStats, listRejectedRuns, restoreErrorMessage, restoreRun } from '../api/reviewApi'
import { PendingRunCard } from './PendingRunCard'
import { WarnedRuns } from './WarnedRuns'

/**
 * Bài bị loại 30 ngày gần đây + khôi phục bài loại nhầm (012500), kèm "Bài có cảnh báo" (013400 — đã ghi nhận nhưng GPS nhảy,
 * chạy máy…) để mọi nơi xem lại bài (Quản trị → Duyệt bài, CLB → duyệt bài) đều có. clubId = null: toàn hệ thống (admin)
 */
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
  const del = useMutation({
    mutationFn: (ids: string[]) => deleteRejectedRuns(ids),
    onSuccess: (r) => {
      toast.success(`Đã xóa ${r.deleted} bài bị loại`)
      setSelected(new Set())
      void qc.invalidateQueries({ queryKey: key })
    },
    onError: () => toast.error('Không xóa được. Chỉ admin xóa được bài đang ở trạng thái bị loại — tải lại danh sách rồi thử lại.'),
  })
  const [open, setOpen] = useState(false) // gập sẵn như "Bài có cảnh báo"
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const canDelete = clubId === null // chỉ admin hệ thống (RPC cũng kiểm tra lại)
  const rows = list.data ?? []
  const picked = rows.filter((r) => selected.has(r.id)).map((r) => r.id)
  const toggle = (id: string) => setSelected((prev) => { const n = new Set(prev); if (!n.delete(id)) n.add(id); return n })
  const onDelete = () => {
    if (!picked.length) return
    if (window.confirm(`Xóa ${picked.length} bài chạy bị loại đã chọn? Bài biến khỏi danh sách; không ảnh hưởng Xu, XP hay thử thách (bài bị loại chưa được tính). Không khôi phục từ app được nữa.`)) del.mutate(picked)
  }
  return (
    <>
      {!!rows.length && (
        <section>
          <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}
            className="flex w-full items-center justify-between gap-2 rounded-xl border border-border bg-surface px-3 py-2.5 text-left">
            <span className="text-sm font-semibold">Bài đã loại (30 ngày) · {rows.length} bài</span>
            <ChevronDown className={cn('size-4 shrink-0 text-fg-subtle transition-transform', open && 'rotate-180')} aria-hidden />
          </button>
          {open && (
            <div className="mt-2">
              <p className="mb-2 text-xs text-fg-muted">Loại nhầm? Ghi lý do rồi khôi phục — lịch sử quyết định được lưu lại để chỉnh luật. Bài nhập tay không được ghi nhận.</p>
              {canDelete && (
                <div className="mb-2 flex items-center justify-between gap-2 rounded-xl border border-border bg-surface px-3 py-2">
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" className="size-4" checked={picked.length === rows.length} aria-label="Chọn tất cả bài bị loại"
                      onChange={(e) => setSelected(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())} />
                    Chọn tất cả{picked.length ? ` (${picked.length})` : ''}
                  </label>
                  <Button size="sm" variant="danger" disabled={!picked.length || del.isPending} onClick={onDelete}>
                    <Trash2 className="size-4" aria-hidden />Xóa các bài đã chọn
                  </Button>
                </div>
              )}
              <ul className="space-y-2">
                {rows.map((r) => (
                  <li key={r.id} className="flex items-start gap-2">
                    {canDelete && (
                      <input type="checkbox" className="mt-4 size-4 shrink-0" checked={selected.has(r.id)} onChange={() => toggle(r.id)}
                        aria-label={`Chọn bài của ${r.profiles?.display_name ?? 'Runner'}`} />
                    )}
                    <ul className="min-w-0 flex-1">
                      <PendingRunCard run={r} busy={restore.isPending} onRestore={(note) => restore.mutate({ id: r.id, note })} />
                    </ul>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}
      <WarnedRuns clubId={clubId} />
    </>
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
