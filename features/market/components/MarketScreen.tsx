'use client'

import Link from 'next/link'
import { useDeferredValue, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { BadgeCheck, ChevronRight, Clock, Handshake, Mail, Search, Store, UserRound } from 'lucide-react'
import { EmptyState, ErrorState, Input, SegmentedControl, Skeleton } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { routes } from '@/shared/config/routes'
import { PROVINCES } from '@/shared/lib/provinces'
import { SUPPORT_EMAIL } from '@/shared/ui/legal/LegalPage'
import { listPartners, marketErrorMessage, myPartners, type PartnerKind } from '../api/marketApi'
import { BibMarket } from './BibMarket'
import { PartnerCard } from './PartnerBits'

type KindTab = 'ALL' | PartnerKind
type Section = 'partners' | 'bib'
const param = (k: string) => (typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get(k) : null)

/** Chợ Runner: (1) HLV / cửa hàng / dịch vụ đã xác minh, (2) Chợ BIB. RaceHub không thu tiền hộ. */
export function MarketScreen() {
  // ?tab=bib (từ thông báo) · ?kind=COACH|SHOP|SERVICE (từ bài Knowledge)
  const [section, setSection] = useState<Section>(() => (param('tab') === 'bib' ? 'bib' : 'partners'))
  return (
    <div className="space-y-4 animate-fade-in">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold">Chợ Runner</h1>
          <p className="text-sm text-fg-muted">{section === 'bib' ? 'Nhượng lại, tìm mua BIB giải chạy — đúng giá, chuyển tên qua BTC.' : 'HLV, cửa hàng, dịch vụ cho runner — hồ sơ đã được RaceHub xác minh.'}</p>
        </div>
        <Link href={routes.marketMine} aria-label="Hồ sơ đối tác của tôi"
          className="inline-flex h-10 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl border border-border bg-surface-2 px-3 text-sm font-semibold hover:border-fg-subtle">
          <UserRound className="size-4" aria-hidden />Tôi
        </Link>
      </header>
      <div role="tablist" className="grid grid-cols-2 gap-2">
        {([['partners', 'Đối tác', Store], ['bib', 'Chợ BIB', Handshake]] as const).map(([v, label, Icon]) => (
          <button key={v} role="tab" aria-selected={section === v} onClick={() => setSection(v)}
            className={cn('flex h-12 items-center justify-center gap-2 rounded-xl border text-[15px] font-bold',
              section === v ? 'border-brand bg-brand text-brand-fg' : 'border-border bg-surface text-fg-muted')}>
            <Icon className="size-4" aria-hidden />{label}
          </button>
        ))}
      </div>
      {section === 'bib' ? <BibMarket /> : <Partners />}
      <p className="text-center text-xs text-fg-subtle">RaceHub không thu tiền hộ. Hãy trao đổi rõ dịch vụ, giá và cách thanh toán trực tiếp với đối tác / người bán.</p>
    </div>
  )
}

function Partners() {
  const [kind, setKind] = useState<KindTab>(() => {
    const k = param('kind')
    return k === 'COACH' || k === 'SHOP' || k === 'SERVICE' ? k : 'ALL'
  })
  const [area, setArea] = useState('')
  const [text, setText] = useState('')
  const query = useDeferredValue(text.trim())
  const q = useQuery({
    queryKey: ['market', kind, area, query],
    queryFn: () => listPartners({ kind: kind === 'ALL' ? null : kind, area: area || null, query }),
    placeholderData: (prev) => prev,
  })
  return (
    <div className="space-y-4">
      <JoinCard />
      <SegmentedControl value={kind} onChange={setKind}
        options={[{ value: 'ALL', label: 'Tất cả' }, { value: 'COACH', label: 'HLV' }, { value: 'SHOP', label: 'Cửa hàng' }, { value: 'SERVICE', label: 'Dịch vụ' }]} />
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_12rem]">
        <label className="relative block">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-subtle" aria-hidden />
          <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Tìm tên, chuyên môn: marathon, trail, massage…" className="pl-9" aria-label="Tìm đối tác" />
        </label>
        <select value={area} onChange={(e) => setArea(e.target.value)} aria-label="Khu vực" className="h-11 w-full rounded-xl border border-border bg-bg px-3 text-sm">
          <option value="">Mọi tỉnh / thành</option>
          {PROVINCES.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>
      {q.isPending ? <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-24" />)}</div>
        : q.isError ? <ErrorState message={marketErrorMessage(q.error)} error={q.error} onRetry={() => void q.refetch()} />
        : !q.data.length ? <EmptyState icon={Store} title="Chưa có đối tác phù hợp" description="Thử bỏ bớt bộ lọc — hoặc đăng ký hồ sơ nếu bạn là HLV / cửa hàng / dịch vụ." />
        : <ul className="space-y-2">{q.data.map((p) => <li key={p.id}><PartnerCard p={p} /></li>)}</ul>}
    </div>
  )
}

/** Thẻ "Trở thành đối tác": giải thích 3 bước + lối đăng ký / liên hệ RaceHub. Có hồ sơ rồi → hiện trạng thái hồ sơ. */
function JoinCard() {
  const mine = useQuery({ queryKey: ['market', 'mine'], queryFn: myPartners, staleTime: 5 * 60_000 })
  if (mine.isPending || mine.isError) return null
  const pending = mine.data.find((p) => p.status === 'PENDING' || p.status === 'REJECTED')
  if (mine.data.length && !pending) return null
  if (pending) {
    return (
      <Link href={routes.marketMine} className="flex items-center gap-3 rounded-[var(--radius-card)] border border-warning/40 bg-warning/5 p-3">
        <Clock className="size-5 shrink-0 text-warning" aria-hidden />
        <span className="min-w-0 flex-1 text-sm"><b>{pending.name}</b> — {pending.status === 'PENDING' ? 'đang chờ RaceHub xác minh (thường trong 1–2 ngày làm việc)' : 'cần bổ sung thông tin, xem ghi chú của RaceHub'}</span>
        <ChevronRight className="size-4 shrink-0 text-fg-subtle" aria-hidden />
      </Link>
    )
  }
  return (
    <div className="space-y-3 rounded-[var(--radius-card)] border border-brand/30 bg-gradient-to-br from-brand/10 to-surface p-4">
      <div className="flex items-center gap-2">
        <Handshake className="size-5 text-brand" aria-hidden />
        <p className="font-semibold">Bạn là HLV, cửa hàng hay dịch vụ cho runner?</p>
      </div>
      <ol className="space-y-1.5 text-sm text-fg-muted">
        <li className="flex gap-2"><span className="grid size-5 shrink-0 place-items-center rounded-full bg-brand text-[11px] font-bold text-brand-fg">1</span>Tạo hồ sơ miễn phí: giới thiệu, dịch vụ, giá, liên hệ.</li>
        <li className="flex gap-2"><span className="grid size-5 shrink-0 place-items-center rounded-full bg-brand text-[11px] font-bold text-brand-fg">2</span><span>RaceHub xác minh (giấy tờ / chứng chỉ nếu cần) và gắn dấu <b className="whitespace-nowrap text-brand"><BadgeCheck className="mb-0.5 inline size-4" aria-hidden /> Đã xác minh</b>.</span></li>
        <li className="flex gap-2"><span className="grid size-5 shrink-0 place-items-center rounded-full bg-brand text-[11px] font-bold text-brand-fg">3</span>Hiện trên Chợ Runner, bài Kiến thức; runner liên hệ trực tiếp với bạn.</li>
      </ol>
      <div className="grid grid-cols-2 gap-2">
        <Link href={routes.marketMine} className="flex h-11 items-center justify-center rounded-xl bg-brand text-sm font-bold text-brand-fg">Đăng ký hồ sơ</Link>
        {SUPPORT_EMAIL
          ? <a href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('Hợp tác Chợ Runner')}`} className="flex h-11 items-center justify-center gap-1.5 rounded-xl border border-border bg-surface-2 text-sm font-semibold"><Mail className="size-4" aria-hidden />Liên hệ hợp tác</a>
          : <Link href={routes.learn} className="flex h-11 items-center justify-center rounded-xl border border-border bg-surface-2 text-sm font-semibold">Tìm hiểu thêm</Link>}
      </div>
    </div>
  )
}
