'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Flag } from 'lucide-react'
import { toast } from 'sonner'
import { Button, Card, EmptyState, ErrorState, Input, SegmentedControl, Skeleton } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { formatRelative } from '@/shared/lib/format'
import { adminErrorMessage } from '../../api/adminApi'
import { adminListReports, adminResolveReport, type AdminReport } from '../../api/consoleApi'
import { inboxKey } from './InboxPanel'

const REASON: Record<string, string> = { SPAM: 'Làm phiền / spam', HARASSMENT: 'Quấy rối', FAKE: 'Tài khoản giả', UNSAFE: 'Hành vi nguy hiểm', OTHER: 'Khác' }
const STATUS: Record<AdminReport['status'], string> = { OPEN: 'Chờ xử lý', RESOLVED: 'Đã khoá Quanh đây', DISMISSED: 'Không vi phạm' }

/** Báo cáo người dùng (Runner Nearby): bỏ qua / khoá Quanh đây. Khoá cả tài khoản: tab Người dùng. 3 người báo cáo → tự tạm ẩn. */
export function ReportsTab() {
  const [status, setStatus] = useState<'OPEN' | 'ALL'>('OPEN')
  const q = useQuery({ queryKey: ['admin', 'reports', status], queryFn: () => adminListReports(status) })
  return (
    <div className="space-y-3">
      <SegmentedControl value={status} onChange={setStatus} options={[{ value: 'OPEN', label: 'Chờ xử lý' }, { value: 'ALL', label: 'Tất cả' }]} />
      {q.isPending ? <div className="space-y-2"><Skeleton className="h-32" /><Skeleton className="h-32" /></div>
        : q.isError ? <ErrorState message={adminErrorMessage(q.error)} error={q.error} onRetry={() => void q.refetch()} />
        : q.data.length === 0 ? <EmptyState icon={Flag} title="Không có báo cáo" description="Báo cáo từ Quanh đây sẽ hiện ở đây." />
        : q.data.map((r) => <ReportRow key={r.id} r={r} />)}
    </div>
  )
}

function ReportRow({ r }: { r: AdminReport }) {
  const qc = useQueryClient()
  const [note, setNote] = useState('')
  const act = useMutation({
    mutationFn: (a: 'DISMISS' | 'SUSPEND') => adminResolveReport(r.id, a, note.trim() || null),
    onSuccess: (_, a) => {
      toast.success(a === 'SUSPEND' ? `Đã khoá Quanh đây của ${r.target_name ?? 'người này'}` : 'Đã đánh dấu không vi phạm')
      void qc.invalidateQueries({ queryKey: ['admin', 'reports'] })
      void qc.invalidateQueries({ queryKey: inboxKey })
    },
    onError: (e) => toast.error(adminErrorMessage(e)),
  })
  return (
    <Card className="space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold">{r.target_name ?? 'Người dùng'} <span className="font-mono text-[11px] text-fg-subtle">{r.target.slice(0, 8)}</span></p>
          <p className="text-xs text-fg-muted">bị báo cáo bởi {r.reporter_name ?? '—'} · {formatRelative(r.created_at)} · {r.context}</p>
        </div>
        <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold', r.status === 'OPEN' ? 'bg-danger/15 text-danger' : 'bg-surface-2 text-fg-muted')}>{STATUS[r.status]}</span>
      </div>
      <p className="text-sm"><b>{REASON[r.reason] ?? r.reason}</b>{r.note ? ` — ${r.note}` : ''}</p>
      <p className="text-xs text-fg-muted">
        {r.target_reports} người đã báo cáo người này{r.target_suspended ? ' · đang bị ẩn khỏi Quanh đây' : ''}
      </p>
      {r.resolution && <p className="text-xs text-fg-subtle">Kết quả: {r.resolution}</p>}
      {r.status === 'OPEN' && (
        <>
          <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="Ghi chú xử lý (lưu vào nhật ký)" />
          <div className="grid grid-cols-2 gap-2">
            <Button size="sm" variant="secondary" disabled={act.isPending} onClick={() => act.mutate('DISMISS')}>Không vi phạm</Button>
            <Button size="sm" variant="danger" disabled={act.isPending} onClick={() => act.mutate('SUSPEND')}>Khoá Quanh đây</Button>
          </div>
        </>
      )}
    </Card>
  )
}
