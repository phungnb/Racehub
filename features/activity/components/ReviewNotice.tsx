'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, Clock3, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import { Button, Textarea } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { formatKm } from '@/shared/lib/format'
import { acceptVerifiedDistance, explainErrorMessage, explainPendingRun, getReviewInfo, type AcceptResult } from '../api/reviewApi'

type Status = 'APPROVED' | 'PENDING' | 'REJECTED' | string | null | undefined

/**
 * Trạng thái xác thực của bài chạy, viết cho người chạy đọc (009700): gọn, không lộ ngưỡng chống gian lận.
 * Bài chờ xác minh vì mất tín hiệu GPS → nút "Chỉ tính phần có GPS" để được ghi nhận ngay phần đã kiểm chứng.
 */
export function ReviewNotice({ activityId, status, reason, onResolved, compact }: {
  activityId: string | null | undefined; status: Status; reason: string | null | undefined
  onResolved?: (r: AcceptResult) => void; compact?: boolean
}) {
  const qc = useQueryClient()
  const info = useQuery({ queryKey: ['activity', activityId, 'review-info'], queryFn: () => getReviewInfo(activityId!), enabled: !!activityId && status === 'PENDING' })
  const accept = useMutation({
    mutationFn: () => acceptVerifiedDistance(activityId!),
    onSuccess: (r) => {
      toast[r.status === 'APPROVED' ? 'success' : 'info'](r.status === 'APPROVED' ? `Đã ghi nhận ${formatKm(r.distance_m)} km` : 'Không ghi nhận: quãng đường quá ngắn')
      void qc.invalidateQueries({ queryKey: ['activity'] })
      void qc.invalidateQueries({ queryKey: ['activities'] })
      onResolved?.(r)
    },
    onError: () => toast.error('Không thực hiện được. Hãy thử lại.'),
  })

  const v = status === 'APPROVED'
    ? { icon: CheckCircle2, title: 'Đã ghi nhận', tone: 'text-success bg-success/10 border-success/30' }
    : status === 'PENDING'
      ? { icon: Clock3, title: 'Đang chờ xác minh', tone: 'text-warning bg-warning/10 border-warning/30' }
      : { icon: XCircle, title: 'Không ghi nhận', tone: 'text-danger bg-danger/10 border-danger/30' }
  // Bài hợp lệ bình thường không cần giải thích; chỉ hiện ghi chú khi có điều chỉnh (vd. chỉ tính phần có GPS)
  const note = status === 'APPROVED' ? (reason?.startsWith('Chỉ tính phần') ? reason : null) : reason
  const i = info.data
  return (
    <div className={cn('rounded-[var(--radius-card)] border text-center', v.tone, compact ? 'space-y-1.5 p-3 text-left' : 'flex flex-col items-center gap-2 px-4 py-6')}>
      <p className={cn('flex items-center gap-2 font-bold', compact ? 'text-sm' : 'flex-col text-xl')}>
        <v.icon className={compact ? 'size-4' : 'size-12'} aria-hidden />{v.title}
      </p>
      {note && <p className="text-sm text-fg">{note}</p>}
      {status === 'PENDING' && i?.can_accept_verified && (
        <div className={cn('w-full space-y-1.5 pt-1', compact ? '' : 'max-w-sm')}>
          <Button block variant="secondary" loading={accept.isPending} onClick={() => accept.mutate()}>
            Chỉ tính phần có GPS · {formatKm(i.verified_distance_m)} km
          </Button>
        </div>
      )}
      {status === 'PENDING' && activityId && info.data && <ExplainBox activityId={activityId} saved={info.data.owner_note ?? null} compact={compact} />}
    </div>
  )
}

/** 013100: người chạy giải trình (đồng hồ hết pin, GPS lỗi dưới hầm…) — ban quản trị CLB / admin đọc khi duyệt */
function ExplainBox({ activityId, saved, compact }: { activityId: string; saved: string | null; compact?: boolean }) {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [text, setText] = useState(saved ?? '')
  const send = useMutation({
    mutationFn: () => explainPendingRun(activityId, text.trim()),
    onSuccess: () => {
      toast.success('Đã gửi giải trình cho ban quản trị')
      setOpen(false)
      void qc.invalidateQueries({ queryKey: ['activity', activityId, 'review-info'] })
    },
    onError: (e) => toast.error(explainErrorMessage(e)),
  })
  return (
    <div className={cn('w-full space-y-1.5 pt-1 text-left', compact ? '' : 'max-w-sm')}>
      {saved && !open && (
        <p className="rounded-lg bg-surface-2 px-3 py-2 text-sm text-fg"><span className="text-fg-muted">Giải trình của bạn: </span>{saved}</p>
      )}
      {open ? (
        <>
          <Textarea rows={3} maxLength={500} value={text} onChange={(e) => setText(e.target.value)} aria-label="Giải trình"
            placeholder="VD: Đồng hồ mất GPS khi chạy qua hầm, tuyến bị nối thẳng. Tôi chạy đủ vòng hồ." />
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Huỷ</Button>
            <Button size="sm" block loading={send.isPending} disabled={text.trim().length < 5} onClick={() => send.mutate()}>Gửi giải trình</Button>
          </div>
        </>
      ) : (
        <Button size="sm" block variant="ghost" onClick={() => setOpen(true)}>{saved ? 'Sửa giải trình' : 'Gửi giải trình cho ban quản trị'}</Button>
      )}
    </div>
  )
}
