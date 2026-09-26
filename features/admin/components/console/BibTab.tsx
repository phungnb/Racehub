'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Ticket } from 'lucide-react'
import { toast } from 'sonner'
import { Button, Card, EmptyState, ErrorState, Input, SegmentedControl, Skeleton } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { supabase } from '@/shared/lib/supabase'
import { adminErrorMessage } from '../../api/adminApi'

interface Row {
  id: string; kind: 'SELL' | 'BUY'; race_name: string; race_date: string; distance: string; price: number | null; original_price: number | null
  status: string; hidden_reason: string | null; reveals: number; seller: { name: string; runs: number }; contacts?: Record<string, string>
}
const list = async (status: string) => {
  const { data, error } = await supabase.rpc('admin_bib_listings', { p_status: status })
  if (error) throw error
  return (data ?? []) as Row[]
}

/** Quản trị Chợ BIB: xem mọi tin, ẩn tin vi phạm (lừa đảo, phe vé) hoặc hiện lại tin bị báo cáo nhầm */
export function BibTab() {
  const [status, setStatus] = useState('HIDDEN')
  const q = useQuery({ queryKey: ['admin', 'bib', status], queryFn: () => list(status) })
  return (
    <div className="space-y-3">
      <SegmentedControl value={status} onChange={setStatus} options={[{ value: 'HIDDEN', label: 'Bị ẩn' }, { value: 'OPEN', label: 'Đang mở' }, { value: 'ALL', label: 'Tất cả' }]} />
      <p className="text-xs text-fg-muted">Tin bị 3 người báo cáo tự ẩn chờ xem xét. Báo cáo chi tiết nằm ở tab Báo cáo (ngữ cảnh BIB).</p>
      {q.isPending ? <Skeleton className="h-40" />
        : q.isError ? <ErrorState message={adminErrorMessage(q.error)} error={q.error} onRetry={() => void q.refetch()} />
        : q.data.length === 0 ? <EmptyState icon={Ticket} title="Không có tin" />
        : q.data.map((r) => <BibRow key={r.id} r={r} />)}
    </div>
  )
}

function BibRow({ r }: { r: Row }) {
  const qc = useQueryClient()
  const [reason, setReason] = useState('')
  const act = useMutation({
    mutationFn: async (hide: boolean) => {
      const { error } = await supabase.rpc('admin_hide_bib', { p_id: r.id, p_hide: hide, p_reason: reason.trim() || null })
      if (error) throw error
    },
    onSuccess: (_, hide) => { toast.success(hide ? 'Đã ẩn tin' : 'Đã hiện lại tin'); void qc.invalidateQueries({ queryKey: ['admin', 'bib'] }) },
    onError: (e) => toast.error(adminErrorMessage(e)),
  })
  const hidden = r.status === 'HIDDEN'
  return (
    <Card className="space-y-2">
      <div className="flex items-start gap-2">
        <p className="min-w-0 flex-1 font-semibold">{r.kind === 'SELL' ? 'Nhượng' : 'Cần mua'} · {r.race_name}</p>
        <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold', hidden ? 'bg-danger/15 text-danger' : 'bg-surface-2 text-fg-muted')}>{r.status}</span>
      </div>
      <p className="text-xs text-fg-muted">{r.race_date} · {r.distance} · {r.price != null ? `${r.price.toLocaleString('vi-VN')}đ` : '—'}{r.original_price != null ? ` / gốc ${r.original_price.toLocaleString('vi-VN')}đ` : ''} · {r.seller.name} ({r.seller.runs} bài hợp lệ) · {r.reveals} lượt xem liên hệ</p>
      {r.contacts && <p className="text-xs text-fg-subtle">Liên hệ: {Object.values(r.contacts).join(' · ')}</p>}
      {r.hidden_reason && <p className="text-xs text-danger">{r.hidden_reason}</p>}
      {hidden ? <Button size="sm" variant="secondary" loading={act.isPending} onClick={() => act.mutate(false)}>Hiện lại</Button> : (
        <div className="flex gap-2">
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Lý do ẩn (người đăng sẽ thấy)" aria-label="Lý do ẩn" />
          <Button size="sm" variant="danger" disabled={reason.trim().length < 3} loading={act.isPending} onClick={() => act.mutate(true)}>Ẩn</Button>
        </div>
      )}
    </Card>
  )
}
