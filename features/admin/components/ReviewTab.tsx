'use client'

import { AlertTriangle, CheckCircle2, Check, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button, EmptyState, ErrorState, Skeleton } from '@/shared/ui'
import { formatKm, formatRelative } from '@/shared/lib/format'
import { cn } from '@/shared/lib/cn'
import { adminErrorMessage } from '../api/adminApi'
import { usePendingActivities, useReviewActivity } from '../hooks/useAdmin'

const FLAG_LABEL: Record<string, string> = {
  MANUAL: 'Nhập tay', TREADMILL: 'Chạy máy', SUSTAINED_SPEED: 'Tốc độ duy trì', VEHICLE_BURST: 'Giống đi xe',
  GPS_TELEPORT: 'GPS nhảy', STRIDE: 'Sải chân', HR_PACE: 'Tim thấp / pace nhanh', HISTORY: 'Khác thường ngày',
}
const RISK_LABEL = { LOW: 'thấp', MEDIUM: 'trung bình', HIGH: 'cao', CRITICAL: 'rất cao' } as const
const RISK_TONE = { LOW: 'bg-surface-2 text-fg-muted', MEDIUM: 'bg-warning/15 text-warning', HIGH: 'bg-danger/15 text-danger', CRITICAL: 'bg-danger text-bg' } as const
const pace = (s: number, m: number) => { const p = Math.round(s / (m / 1000)); return `${Math.floor(p / 60)}:${String(p % 60).padStart(2, '0')}` }

/** Duyệt bài chạy bị hệ thống gắn cờ (pace bất thường, GPS nhảy, giống đi xe, sải chân / nhịp tim bất thường...) */
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
            <div className="text-right">
              <p className="font-mono font-semibold">{formatKm(a.distance_m)} km</p>
              {a.moving_time_s && a.distance_m > 0 && <p className="font-mono text-xs text-fg-muted">{pace(a.moving_time_s, a.distance_m)}/km</p>}
            </div>
          </div>
          {a.validation_reason && (
            <p className="flex items-start gap-2 rounded-lg bg-warning/10 p-2 text-xs text-warning">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              <span>{a.validation_reason}</span>
            </p>
          )}
          {!!a.risk_flags?.length && (
            <div className="flex flex-wrap items-center gap-1.5">
              {a.risk_level && <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-bold', RISK_TONE[a.risk_level])}>Rủi ro {RISK_LABEL[a.risk_level]}{a.risk_score != null ? ` · ${a.risk_score}` : ''}</span>}
              {a.risk_flags.map((f, i) => (
                <span key={i} title={f.message} className={cn('rounded-full border px-2 py-0.5 text-[11px]', f.severity === 'SEVERE' ? 'border-danger/50 text-danger' : 'border-border text-fg-muted')}>
                  {FLAG_LABEL[f.code] ?? f.code}
                </span>
              ))}
            </div>
          )}
          <div className="flex gap-2">
            <Button size="sm" block onClick={() => act(a.id, 'APPROVED')} disabled={review.isPending}><Check className="size-4" aria-hidden />Duyệt</Button>
            <Button size="sm" block variant="danger" onClick={() => act(a.id, 'REJECTED')} disabled={review.isPending}><X className="size-4" aria-hidden />Từ chối</Button>
          </div>
        </li>
      ))}
    </ul>
  )
}
