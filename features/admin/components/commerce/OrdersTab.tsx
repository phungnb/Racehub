'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Receipt } from 'lucide-react'
import { toast } from 'sonner'
import { Button, ConfirmSheet, EmptyState, ErrorState, Input, SegmentedControl, Skeleton } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { formatVnd } from '@/shared/lib/economy'
import { orderTitle, STATUS_META, type Order, type OrderStatus } from '@/features/billing'
import { adminErrorMessage } from '../../api/adminApi'
import { cancelOrderAdmin, confirmOrder, listOrders } from '../../api/commerceApi'

type Filter = OrderStatus | 'ALL'
const fmt = (iso: string) => new Date(iso).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })

/** Đơn hàng: đối soát sao kê theo mã đơn (nội dung chuyển khoản) rồi xác nhận → kích hoạt gói / cộng Xu */
export function OrdersTab() {
  const qc = useQueryClient()
  const [filter, setFilter] = useState<Filter>('PENDING')
  const [sel, setSel] = useState<{ order: Order; action: 'confirm' | 'cancel' } | null>(null)
  const [note, setNote] = useState('')
  const [now] = useState(() => Date.now())
  const q = useQuery({ queryKey: ['admin', 'orders', filter], queryFn: () => listOrders(filter) })
  const act = useMutation({
    mutationFn: ({ order, action }: { order: Order; action: 'confirm' | 'cancel' }) =>
      action === 'confirm' ? confirmOrder(order.id, note.trim()) : cancelOrderAdmin(order.id),
    onSuccess: (o, v) => {
      toast.success(v.action === 'confirm' ? `Đã xác nhận ${o.code} — đã kích hoạt cho ${o.owner_name ?? 'người mua'}` : `Đã hủy ${o.code}`)
      setSel(null); setNote('')
      void qc.invalidateQueries({ queryKey: ['admin'] })
    },
    onError: (e) => toast.error(adminErrorMessage(e)),
  })

  return (
    <div className="space-y-3">
      <SegmentedControl value={filter} onChange={setFilter} options={[
        { value: 'PENDING', label: 'Chờ xác nhận' }, { value: 'PAID', label: 'Đã xác nhận' }, { value: 'CANCELLED', label: 'Đã hủy' }, { value: 'ALL', label: 'Tất cả' },
      ]} />
      <p className="text-xs text-fg-muted">Đối chiếu sao kê ngân hàng: nội dung chuyển khoản = mã đơn, số tiền khớp thì bấm Xác nhận.</p>
      {q.isPending ? <Skeleton className="h-40" /> : q.isError ? <ErrorState message={adminErrorMessage(q.error)} onRetry={() => void q.refetch()} />
        : !q.data.length ? <EmptyState icon={Receipt} title="Không có đơn nào" />
        : (
          <ul className="divide-y divide-border rounded-xl border border-border bg-surface">
            {q.data.map((o) => {
              const s = STATUS_META[o.status]
              const expired = o.status === 'PENDING' && Date.parse(o.expires_at) <= now
              return (
                <li key={o.id} className="space-y-2 p-3">
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{orderTitle(o)}</p>
                      <p className="text-xs text-fg-muted"><span className="font-mono font-semibold text-fg">{o.code}</span> · {o.buyer_name ?? '—'} · {fmt(o.created_at)}</p>
                    </div>
                    <div className="text-right">
                      <p className="font-mono text-sm font-bold">{formatVnd(o.amount_vnd)}</p>
                      <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold', s.tone)}>{expired ? 'Quá hạn' : s.label}</span>
                    </div>
                  </div>
                  {o.status === 'PENDING' && (
                    <div className="flex gap-2">
                      <Button size="sm" variant="ghost" onClick={() => setSel({ order: o, action: 'cancel' })}>Hủy</Button>
                      <Button size="sm" className="flex-1" onClick={() => setSel({ order: o, action: 'confirm' })}>Xác nhận đã nhận tiền</Button>
                    </div>
                  )}
                  {o.note && <p className="text-xs text-fg-subtle">Ghi chú: {o.note}</p>}
                </li>
              )
            })}
          </ul>
        )}
      <ConfirmSheet open={!!sel} onClose={() => setSel(null)} loading={act.isPending} danger={sel?.action === 'cancel'}
        onConfirm={() => sel && act.mutate(sel)}
        title={sel?.action === 'confirm' ? `Xác nhận đơn ${sel?.order.code}?` : `Hủy đơn ${sel?.order.code}?`}
        confirmLabel={sel?.action === 'confirm' ? 'Xác nhận & kích hoạt' : 'Hủy đơn'}
        description={sel ? `${orderTitle(sel.order)} · ${formatVnd(sel.order.amount_vnd)}` : ''}>
        {sel?.action === 'confirm' && (
          <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="Ghi chú (mã giao dịch ngân hàng…)" aria-label="Ghi chú" />
        )}
      </ConfirmSheet>
    </div>
  )
}
