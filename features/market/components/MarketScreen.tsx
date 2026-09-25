'use client'

import Link from 'next/link'
import { useDeferredValue, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Search, Store, UserPlus } from 'lucide-react'
import { Button, EmptyState, ErrorState, Input, SegmentedControl, Skeleton } from '@/shared/ui'
import { routes } from '@/shared/config/routes'
import { PROVINCES } from '@/shared/lib/provinces'
import { listPartners, marketErrorMessage, type PartnerKind } from '../api/marketApi'
import { PartnerCard } from './PartnerBits'

type KindTab = 'ALL' | PartnerKind

/** Chợ Runner: HLV / cửa hàng / dịch vụ đã được RaceHub xác minh. Liên hệ và thanh toán trực tiếp với đối tác. */
export function MarketScreen() {
  const [kind, setKind] = useState<KindTab>('ALL')
  const [area, setArea] = useState('')
  const [text, setText] = useState('')
  const query = useDeferredValue(text.trim())
  const q = useQuery({
    queryKey: ['market', kind, area, query],
    queryFn: () => listPartners({ kind: kind === 'ALL' ? null : kind, area: area || null, query }),
    placeholderData: (prev) => prev,
  })
  return (
    <div className="space-y-4 animate-fade-in">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Chợ Runner</h1>
          <p className="text-sm text-fg-muted">Huấn luyện viên, cửa hàng, dịch vụ cho runner — hồ sơ đã được RaceHub xác minh.</p>
        </div>
        <Link href={routes.marketMine}><Button size="sm" variant="secondary"><UserPlus className="size-4" aria-hidden />Hồ sơ của tôi</Button></Link>
      </header>
      <SegmentedControl value={kind} onChange={setKind}
        options={[{ value: 'ALL', label: 'Tất cả' }, { value: 'COACH', label: 'HLV' }, { value: 'SHOP', label: 'Cửa hàng' }, { value: 'SERVICE', label: 'Dịch vụ' }]} />
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_12rem]">
        <label className="relative block">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-subtle" aria-hidden />
          <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Tìm tên, chuyên môn: marathon, trail, massage…" className="pl-9" aria-label="Tìm đối tác" />
        </label>
        <select value={area} onChange={(e) => setArea(e.target.value)} aria-label="Khu vực"
          className="h-11 w-full rounded-xl border border-border bg-bg px-3 text-sm">
          <option value="">Mọi tỉnh / thành</option>
          {PROVINCES.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>
      {q.isPending ? <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-24" />)}</div>
        : q.isError ? <ErrorState message={marketErrorMessage(q.error)} error={q.error} onRetry={() => void q.refetch()} />
        : !q.data.length ? <EmptyState icon={Store} title="Chưa có đối tác phù hợp" description="Thử bỏ bớt bộ lọc — hoặc đăng ký hồ sơ nếu bạn là HLV / cửa hàng / dịch vụ." />
        : <ul className="space-y-2">{q.data.map((p) => <li key={p.id}><PartnerCard p={p} /></li>)}</ul>}
      <p className="text-center text-xs text-fg-subtle">RaceHub không thu tiền hộ. Hãy trao đổi rõ dịch vụ, giá và cách thanh toán trực tiếp với đối tác.</p>
    </div>
  )
}
