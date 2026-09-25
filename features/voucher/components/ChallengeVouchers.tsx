'use client'

import Link from 'next/link'
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Ticket } from 'lucide-react'
import { Button, Card } from '@/shared/ui'
import { listVouchers, type VoucherCampaign } from '../api/voucherApi'
import { VoucherForm } from './VoucherForm'
import { SponsorLogo } from './VoucherWallet'

/** Khối "Quà tài trợ" trong thử thách: runner thấy điều kiện nhận; BTC thêm / sửa voucher, dán mã */
export function ChallengeVouchers({ challengeId, canManage }: { challengeId: string; canManage: boolean }) {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['vouchers', 'challenge', challengeId], queryFn: () => listVouchers('CHALLENGE', challengeId), retry: false })
  const [edit, setEdit] = useState<VoucherCampaign | 'new' | null>(null)
  const list = q.data ?? []
  if (!list.length && !canManage) return null
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 font-semibold"><Ticket className="size-4 text-coin" aria-hidden />Quà nhà tài trợ</h2>
        {canManage && <Button size="sm" variant="ghost" onClick={() => setEdit('new')}><Plus className="size-4" aria-hidden />Thêm</Button>}
      </div>
      {!list.length && <p className="rounded-xl border border-dashed border-border p-3 text-sm text-fg-muted">Thêm voucher từ nhà tài trợ (shop, HLV, dịch vụ) — runner hoàn thành tự nhận mã.</p>}
      {list.map((v) => (
        <Card key={v.id} className="flex items-center gap-3 p-3">
          <SponsorLogo name={v.sponsor_name} url={v.sponsor_logo} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{v.title}</p>
            <p className="truncate text-xs text-fg-muted">
              {v.sponsor_name} · {v.condition === 'TOP_N' ? `Top ${v.top_n} khi chốt hạng` : 'Hoàn thành thử thách'}
              {v.remaining != null && ` · còn ${v.remaining} mã`}{canManage && ` · đã phát ${v.issued}`}{!v.is_active && ' · đang tắt'}
            </p>
          </div>
          {v.mine ? <Link href="/me/vouchers"><Button size="sm" variant="coin">Mã của bạn</Button></Link>
            : canManage ? <Button size="sm" variant="secondary" onClick={() => setEdit(v)}>Sửa</Button> : null}
        </Card>
      ))}
      {edit && <VoucherForm init={edit === 'new' ? null : edit} target={{ type: 'CHALLENGE', id: challengeId }} onClose={() => setEdit(null)}
        onSaved={() => void qc.invalidateQueries({ queryKey: ['vouchers'] })} />}
    </section>
  )
}
