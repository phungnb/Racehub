'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { MessageSquareHeart } from 'lucide-react'
import { toast } from 'sonner'
import { Button, Card, EmptyState, ErrorState, Input, SegmentedControl, Skeleton } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { formatRelative } from '@/shared/lib/format'
import { FEEDBACK_KINDS, RATINGS } from '@/features/feedback'
import { adminErrorMessage } from '../../api/adminApi'
import { adminFeedbackList, adminFeedbackSetStatus, consoleErrorMessage, type AdminFeedback } from '../../api/consoleApi'

type Filter = 'NEW' | 'DONE' | 'ALL'
const KIND = Object.fromEntries(FEEDBACK_KINDS.map((k) => [k.value, k.label])) as Record<string, string>

/** Hộp thư góp ý từ bong bóng trong app: xem, ghi chú, đánh dấu đã xử lý */
export function FeedbackTab() {
  const [filter, setFilter] = useState<Filter>('NEW')
  const q = useQuery({ queryKey: ['admin', 'feedback', filter], queryFn: () => adminFeedbackList(filter) })
  return (
    <div className="space-y-3">
      {q.data && (
        <div className="grid grid-cols-3 gap-2 text-center">
          <Card className="p-2"><p className="text-lg font-bold">{q.data.new_count}</p><p className="text-[11px] text-fg-muted">Chưa xử lý</p></Card>
          <Card className="p-2"><p className="text-lg font-bold">{q.data.avg_rating ?? '—'}<span className="text-xs font-normal text-fg-muted"> /5</span></p><p className="text-[11px] text-fg-muted">Hài lòng TB</p></Card>
          <Card className="p-2"><p className="text-lg font-bold">{q.data.rating_count}</p><p className="text-[11px] text-fg-muted">Lượt chấm điểm</p></Card>
        </div>
      )}
      <SegmentedControl value={filter} onChange={setFilter} options={[{ value: 'NEW', label: 'Chưa xử lý' }, { value: 'DONE', label: 'Đã xử lý' }, { value: 'ALL', label: 'Tất cả' }]} />
      {q.isPending ? <div className="space-y-2"><Skeleton className="h-28" /><Skeleton className="h-28" /></div>
        : q.isError ? <ErrorState message={adminErrorMessage(q.error)} error={q.error} onRetry={() => void q.refetch()} />
        : q.data.items.length === 0 ? <EmptyState icon={MessageSquareHeart} title="Chưa có góp ý" description="Góp ý gửi từ bong bóng trong app sẽ hiện ở đây." />
        : q.data.items.map((f) => <FeedbackRow key={f.id} f={f} />)}
    </div>
  )
}

function FeedbackRow({ f }: { f: AdminFeedback }) {
  const qc = useQueryClient()
  const [note, setNote] = useState(f.admin_note ?? '')
  const act = useMutation({
    mutationFn: (s: 'NEW' | 'DONE') => adminFeedbackSetStatus(f.id, s, note.trim() || null),
    onSuccess: (_, s) => { toast.success(s === 'DONE' ? 'Đã đánh dấu đã xử lý' : 'Đã mở lại góp ý'); void qc.invalidateQueries({ queryKey: ['admin', 'feedback'] }) },
    onError: (e) => toast.error(consoleErrorMessage(e)),
  })
  const rating = RATINGS.find((r) => r.value === f.rating)
  return (
    <Card className="space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-semibold">{f.name ?? 'Người dùng'}{f.email && <span className="ml-1.5 text-xs font-normal text-fg-muted">{f.email}</span>}</p>
          <p className="text-xs text-fg-muted">{formatRelative(f.created_at)}{f.platform ? ` · ${f.platform}` : ''}{f.page ? ` · ${f.page}` : ''}</p>
        </div>
        <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold', f.status === 'NEW' ? 'bg-brand/15 text-brand' : 'bg-surface-2 text-fg-muted')}>
          {f.status === 'NEW' ? 'Mới' : 'Đã xử lý'}
        </span>
      </div>
      <p className="text-sm">
        <b>{KIND[f.kind] ?? f.kind}</b>{rating && <span title={rating.label}> · {rating.emoji} {f.rating}/5</span>}
      </p>
      {f.body && <p className="whitespace-pre-wrap break-words text-sm">{f.body}</p>}
      {f.status === 'DONE' && f.handled_by && <p className="text-xs text-fg-subtle">Xử lý bởi {f.handled_by}{f.handled_at ? ` · ${formatRelative(f.handled_at)}` : ''}</p>}
      <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="Ghi chú nội bộ (tùy chọn)" aria-label="Ghi chú nội bộ" />
      <div className="grid grid-cols-1">
        {f.status === 'NEW'
          ? <Button size="sm" disabled={act.isPending} onClick={() => act.mutate('DONE')}>Đánh dấu đã xử lý</Button>
          : <Button size="sm" variant="secondary" disabled={act.isPending} onClick={() => act.mutate('NEW')}>Mở lại</Button>}
      </div>
    </Card>
  )
}
