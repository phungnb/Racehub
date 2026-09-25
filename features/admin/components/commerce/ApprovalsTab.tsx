'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import { Button, Card, ConfirmSheet, EmptyState, ErrorState, Input, SegmentedControl, Skeleton } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { adminErrorMessage } from '../../api/adminApi'
import { decideApproval, listApprovals, type Approval } from '../../api/commerceApi'

const STATUS: Record<Approval['status'], { label: string; tone: string }> = {
  PENDING: { label: 'Chờ duyệt', tone: 'bg-warning/15 text-warning' },
  APPROVED: { label: 'Đã duyệt', tone: 'bg-brand/15 text-brand' },
  REJECTED: { label: 'Từ chối', tone: 'bg-danger/15 text-danger' },
  EXPIRED: { label: 'Hết hạn', tone: 'bg-surface-2 text-fg-subtle' },
}
const fmt = (iso: string) => new Date(iso).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })

/** Phê duyệt hai người: lệnh vượt ngưỡng của một admin chờ admin KHÁC duyệt (người yêu cầu không tự duyệt được) */
export function ApprovalsTab() {
  const qc = useQueryClient()
  const [filter, setFilter] = useState<Approval['status'] | 'ALL'>('PENDING')
  const [sel, setSel] = useState<{ a: Approval; approve: boolean } | null>(null)
  const [note, setNote] = useState('')
  const q = useQuery({ queryKey: ['admin', 'approvals', filter], queryFn: () => listApprovals(filter) })
  const act = useMutation({
    mutationFn: (v: { a: Approval; approve: boolean }) => decideApproval(v.a.id, v.approve, note.trim()),
    onSuccess: (_, v) => { toast.success(v.approve ? 'Đã duyệt và thực hiện' : 'Đã từ chối'); setSel(null); setNote(''); void qc.invalidateQueries({ queryKey: ['admin'] }) },
    onError: (e) => toast.error(adminErrorMessage(e)),
  })
  return (
    <div className="space-y-3">
      <Card className="flex gap-3 text-sm text-fg-muted">
        <ShieldCheck className="size-5 shrink-0 text-brand" aria-hidden />
        <p>Lệnh cộng/trừ Xu lớn, vượt trần ngày, tặng nhiều lượt tạo hoặc cấp gói dài hạn phải có admin thứ hai duyệt.
          Không admin nào tự cấp cho mình hay CLB mình. Ngưỡng chỉ chỉnh được trong SQL Editor.</p>
      </Card>
      <SegmentedControl value={filter} onChange={setFilter} options={[
        { value: 'PENDING', label: 'Chờ duyệt' }, { value: 'APPROVED', label: 'Đã duyệt' }, { value: 'REJECTED', label: 'Từ chối' }, { value: 'ALL', label: 'Tất cả' },
      ]} />
      {q.isPending ? <Skeleton className="h-40" /> : q.isError ? <ErrorState message={adminErrorMessage(q.error)} onRetry={() => void q.refetch()} />
        : !q.data.length ? <EmptyState icon={ShieldCheck} title="Không có yêu cầu nào" />
        : (
          <ul className="divide-y divide-border rounded-xl border border-border bg-surface">
            {q.data.map((a) => (
              <li key={a.id} className="space-y-2 p-3">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold">{a.summary}</p>
                    <p className="text-xs text-fg-muted">{a.requester ?? '—'}{a.mine ? ' (bạn)' : ''} · {fmt(a.created_at)}
                      {typeof a.payload.reason === 'string' ? ` · lý do: ${a.payload.reason}` : ''}</p>
                    {a.decider && <p className="text-xs text-fg-subtle">Xử lý bởi {a.decider}{a.note ? ` — ${a.note}` : ''}</p>}
                  </div>
                  <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold', STATUS[a.status].tone)}>{STATUS[a.status].label}</span>
                </div>
                {a.status === 'PENDING' && (a.mine ? <p className="text-xs text-fg-subtle">Chờ một admin khác duyệt.</p> : (
                  <div className="flex gap-2">
                    <Button size="sm" variant="ghost" onClick={() => setSel({ a, approve: false })}>Từ chối</Button>
                    <Button size="sm" className="flex-1" onClick={() => setSel({ a, approve: true })}>Duyệt & thực hiện</Button>
                  </div>
                ))}
              </li>
            ))}
          </ul>
        )}
      <ConfirmSheet open={!!sel} onClose={() => setSel(null)} loading={act.isPending} danger={!sel?.approve} onConfirm={() => sel && act.mutate(sel)}
        title={sel?.approve ? 'Duyệt yêu cầu này?' : 'Từ chối yêu cầu này?'} confirmLabel={sel?.approve ? 'Duyệt & thực hiện' : 'Từ chối'}
        description={sel?.a.summary}>
        <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="Ghi chú (đã kiểm tra hồ sơ, lý do từ chối…)" aria-label="Ghi chú" />
      </ConfirmSheet>
    </div>
  )
}
