'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Ticket } from 'lucide-react'
import { Button, Card, EmptyState, ErrorState, Field, Skeleton } from '@/shared/ui'
import { adminListVouchers, VoucherForm, voucherErrorMessage, type VoucherCampaign } from '@/features/voucher'
import { listQuests } from '../../api/commerceApi'

/** Voucher tài trợ toàn hệ thống: xem mọi chiến dịch; gắn voucher cho nhiệm vụ (BTC tự gắn cho thử thách của họ) */
export function AdminVouchers() {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['vouchers', 'admin'], queryFn: adminListVouchers })
  const quests = useQuery({ queryKey: ['admin', 'quests'], queryFn: listQuests })
  const [quest, setQuest] = useState('')
  const [edit, setEdit] = useState<{ v: VoucherCampaign | null; type: 'CHALLENGE' | 'QUEST'; id: string } | null>(null)
  return (
    <div className="space-y-3">
      <Card className="space-y-2">
        <p className="text-sm font-semibold">Gắn voucher cho nhiệm vụ</p>
        <Field label="Nhiệm vụ" htmlFor="av-q">
          <select id="av-q" value={quest} onChange={(e) => setQuest(e.target.value)} className="h-11 w-full rounded-xl border border-border bg-surface-2 px-3 text-sm">
            <option value="">— Chọn nhiệm vụ —</option>
            {(quests.data ?? []).map((x) => <option key={x.id} value={x.id}>{x.title}</option>)}
          </select>
        </Field>
        <Button size="sm" disabled={!quest} onClick={() => setEdit({ v: null, type: 'QUEST', id: quest })}><Plus className="size-4" aria-hidden />Thêm voucher</Button>
        <p className="text-xs text-fg-muted">Voucher cho thử thách: Ban tổ chức tự thêm trong trang thử thách (mục “Quà nhà tài trợ”).</p>
      </Card>
      {q.isPending ? <Skeleton className="h-32" /> : q.isError ? <ErrorState message={voucherErrorMessage(q.error)} error={q.error} onRetry={() => void q.refetch()} />
        : !q.data.length ? <EmptyState icon={Ticket} title="Chưa có voucher tài trợ" description="Voucher do nhà tài trợ đưa, phát tự động khi runner đạt điều kiện." />
        : q.data.map((v) => (
          <Card key={v.id} className="flex items-center gap-3 p-3">
            <Ticket className="size-5 shrink-0 text-coin" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{v.sponsor_name} · {v.title}</p>
              <p className="truncate text-xs text-fg-muted">{v.target_type === 'CHALLENGE' ? 'Thử thách' : 'Nhiệm vụ'}: {v.target_name ?? v.target_id}
                {' · '}đã phát {v.issued}{v.remaining != null ? ` · còn ${v.remaining}/${v.total ?? 0} mã` : ` · mã chung ${v.shared_code ?? ''}`}{!v.is_active && ' · đang tắt'}</p>
            </div>
            <Button size="sm" variant="ghost" onClick={() => setEdit({ v, type: v.target_type, id: v.target_id })}>Sửa</Button>
          </Card>
        ))}
      {edit && <VoucherForm init={edit.v} target={{ type: edit.type, id: edit.id }} onClose={() => setEdit(null)} onSaved={() => void qc.invalidateQueries({ queryKey: ['vouchers'] })} />}
    </div>
  )
}
