'use client'

import Link from 'next/link'
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, EyeOff, Store, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button, Card, EmptyState, ErrorState, Input, SegmentedControl, Skeleton } from '@/shared/ui'
import { routes } from '@/shared/config/routes'
import { adminListPartners, contactLinks, marketErrorMessage, PARTNER_KIND, reviewPartner, type Partner, type PartnerStatus } from '@/features/market'

/** Duyệt hồ sơ Chợ Runner: xác minh / từ chối (kèm lý do) / ẩn */
export function PartnersTab() {
  const [status, setStatus] = useState<PartnerStatus>('PENDING')
  const q = useQuery({ queryKey: ['admin', 'partners', status], queryFn: () => adminListPartners(status) })
  return (
    <div className="space-y-3">
      <SegmentedControl value={status} onChange={setStatus}
        options={[{ value: 'PENDING', label: 'Chờ duyệt' }, { value: 'APPROVED', label: 'Đang hiện' }, { value: 'REJECTED', label: 'Từ chối' }, { value: 'HIDDEN', label: 'Đã ẩn' }]} />
      <p className="text-xs text-fg-muted">Kiểm tra: tên / ảnh thật, liên hệ gọi được, không ghi số tài khoản nhận tiền hộ, dịch vụ phù hợp runner. HLV: xem thành tích chạy thật trong hồ sơ.</p>
      {q.isPending ? <Skeleton className="h-32" /> : q.isError ? <ErrorState message={marketErrorMessage(q.error)} error={q.error} onRetry={() => void q.refetch()} />
        : !q.data.length ? <EmptyState icon={Store} title="Không có hồ sơ" description="Hồ sơ HLV / cửa hàng / dịch vụ runner gửi sẽ hiện ở đây." />
        : q.data.map((p) => <PartnerReview key={p.id} p={p} />)}
    </div>
  )
}

function PartnerReview({ p }: { p: Partner }) {
  const qc = useQueryClient()
  const [note, setNote] = useState('')
  const act = useMutation({
    mutationFn: (a: 'APPROVE' | 'REJECT' | 'HIDE') => reviewPartner(p.id, a, note.trim() || null),
    onSuccess: (_, a) => { toast.success(a === 'APPROVE' ? 'Đã xác minh' : a === 'REJECT' ? 'Đã yêu cầu bổ sung' : 'Đã ẩn hồ sơ'); void qc.invalidateQueries({ queryKey: ['admin', 'partners'] }) },
    onError: (e) => toast.error(marketErrorMessage(e)),
  })
  return (
    <Card className="space-y-2 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Link href={routes.partner(p.id)} className="font-semibold underline-offset-2 hover:underline">{p.name}</Link>
        <span className="text-xs text-fg-muted">{PARTNER_KIND[p.kind].label} · {p.area ?? 'chưa chọn tỉnh'} · {p.owner.display_name}</span>
      </div>
      {p.tagline && <p className="text-sm text-fg-muted">{p.tagline}</p>}
      <p className="text-xs text-fg-subtle">{p.services?.length ?? 0} dịch vụ · liên hệ: {contactLinks(p.contacts).map((c) => c.value).join(' · ') || 'chưa có'}
        {p.kind === 'COACH' && p.stats && ` · cấp ${p.stats.level ?? '?'}, ${Math.round(p.stats.km_12m)} km / 12 tháng`}</p>
      {p.review_note && <p className="text-xs text-fg-muted">Ghi chú trước: {p.review_note}</p>}
      <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="Lý do (bắt buộc khi từ chối / ẩn)" aria-label="Lý do" />
      <div className="flex flex-wrap gap-2">
        {p.status !== 'APPROVED' && <Button size="sm" loading={act.isPending && act.variables === 'APPROVE'} onClick={() => act.mutate('APPROVE')}><Check className="size-4" aria-hidden />Xác minh</Button>}
        {p.status === 'PENDING' && <Button size="sm" variant="secondary" loading={act.isPending && act.variables === 'REJECT'} onClick={() => act.mutate('REJECT')}><X className="size-4" aria-hidden />Cần bổ sung</Button>}
        {p.status !== 'HIDDEN' && <Button size="sm" variant="danger" loading={act.isPending && act.variables === 'HIDE'} onClick={() => act.mutate('HIDE')}><EyeOff className="size-4" aria-hidden />Ẩn</Button>}
      </div>
    </Card>
  )
}
