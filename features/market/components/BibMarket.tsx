'use client'

import { useDeferredValue, useState } from 'react'
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle, BadgeCheck, CalendarDays, Eye, Flag, MapPin, MessageCircle, MoreHorizontal, Pencil, Phone, Plus, Search, ShieldCheck, Tag, Ticket,
} from 'lucide-react'
import { toast } from 'sonner'
import { Avatar, Button, Card, EmptyState, ErrorState, Field, Input, SegmentedControl, Sheet, Skeleton, Textarea } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { PROVINCES } from '@/shared/lib/provinces'
import {
  BIB_DISTANCES, BIB_STATUS, bibErrorMessage, formatVnd, listBibs, reportBib, revealBibContact, saveBib, setBibStatus,
  type BibDistance, type BibFilters, type BibInput, type BibKind, type BibListing, type BibStatus,
} from '../api/bibApi'

const REPORT = { FAKE: 'Lừa đảo / tin giả', SPAM: 'Spam', UNSAFE: 'Bán cao hơn giá / phe vé', OTHER: 'Khác' } as const
const dmy = (d: string) => { const [y, m, dd] = d.slice(0, 10).split('-'); return `${dd}/${m}/${y}` }

/** Chợ BIB: nhượng lại / tìm mua BIB giải chạy thật. Liên hệ trực tiếp, RaceHub không giữ tiền, không bán cao hơn giá gốc. */
export function BibMarket() {
  const [kind, setKind] = useState<'SELL' | 'BUY' | 'MINE'>('SELL')
  const [text, setText] = useState('')
  const q = useDeferredValue(text.trim())
  const [city, setCity] = useState('')
  const [dist, setDist] = useState<BibDistance | ''>('')
  const [edit, setEdit] = useState<Partial<BibListing> | null>(null)
  const f: BibFilters = kind === 'MINE' ? { mine: true } : { kind, q, city: city || null, distance: dist || null }
  const list = useInfiniteQuery({
    queryKey: ['bib', f],
    queryFn: ({ pageParam }) => listBibs(f, pageParam),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => (pages.length * 30 < last.total ? pages.length * 30 : undefined),
  })
  const first = list.data?.pages[0]
  const items = list.data?.pages.flatMap((p) => p.items) ?? []

  return (
    <div className="space-y-3">
      <Card className="space-y-2 border-coin/30 bg-coin/5">
        <p className="flex items-center gap-2 text-sm font-semibold"><ShieldCheck className="size-4 text-coin" aria-hidden />Mua bán BIB an toàn</p>
        <ul className="list-disc space-y-0.5 pl-5 text-xs text-fg-muted">
          <li>Ưu tiên <b className="text-fg">chuyển nhượng chính thức qua BTC</b> (đổi tên VĐV). Chạy BIB mang tên người khác có thể bị loại, mất quyền lợi bảo hiểm.</li>
          <li>Giá nhượng <b className="text-fg">không cao hơn giá gốc</b>. RaceHub không giữ tiền — chỉ chuyển khoản khi BTC đã xác nhận đổi tên.</li>
          <li>Người đăng là runner đã xác minh (≥ 3 bài chạy hợp lệ). Thấy dấu hiệu lừa đảo → bấm Báo cáo.</li>
        </ul>
      </Card>

      <div className="flex items-center gap-2">
        <SegmentedControl className="flex-1" value={kind} onChange={setKind} options={[
          { value: 'SELL', label: 'Nhượng BIB' }, { value: 'BUY', label: 'Cần mua' }, { value: 'MINE', label: 'Tin của tôi', count: first?.open_count || undefined },
        ]} />
      </div>
      <Button block onClick={() => setEdit({ kind: kind === 'BUY' ? 'BUY' : 'SELL', distance: '21K', transfer: 'OFFICIAL' })} disabled={first && !first.eligible}>
        <Plus className="size-4" aria-hidden />Đăng tin BIB
      </Button>
      {first && !first.eligible && <p className="text-center text-xs text-fg-muted">Cần 3 bài chạy hợp lệ để đăng tin (bạn có {first.valid_runs}). Xem tin và liên hệ vẫn được.</p>}

      {kind !== 'MINE' && (
        <>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-subtle" aria-hidden />
            <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Tìm giải: VnExpress, Techcombank, Hà Nội…" aria-label="Tìm giải" className="pl-9" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <select value={dist} onChange={(e) => setDist(e.target.value as BibDistance | '')} aria-label="Cự ly" className="h-11 rounded-xl border border-border bg-bg px-3 text-sm">
              <option value="">Mọi cự ly</option>
              {(Object.keys(BIB_DISTANCES) as BibDistance[]).map((d) => <option key={d} value={d}>{BIB_DISTANCES[d]}</option>)}
            </select>
            <select value={city} onChange={(e) => setCity(e.target.value)} aria-label="Tỉnh / thành" className="h-11 rounded-xl border border-border bg-bg px-3 text-sm">
              <option value="">Mọi tỉnh / thành</option>
              {PROVINCES.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
        </>
      )}

      {list.isPending ? <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-36" />)}</div>
        : list.isError ? <ErrorState message={bibErrorMessage(list.error)} error={list.error} onRetry={() => void list.refetch()} />
        : items.length === 0 ? (
          <EmptyState icon={Ticket} title={kind === 'MINE' ? 'Bạn chưa đăng tin nào' : 'Chưa có tin phù hợp'}
            description={kind === 'BUY' ? 'Chưa ai cần mua BIB giải này. Đăng tin nhượng để người cần tìm thấy bạn.' : 'Thử bỏ bộ lọc, hoặc đăng tin “Cần mua” để người có BIB liên hệ bạn.'} />
        ) : (
          <ul className="space-y-2">{items.map((b) => <li key={b.id}><BibCard b={b} onEdit={setEdit} /></li>)}</ul>
        )}
      {list.hasNextPage && <Button block variant="secondary" loading={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>Xem thêm</Button>}
      {edit && <BibSheet b={edit} onClose={() => setEdit(null)} />}
    </div>
  )
}

function useRefresh() {
  const qc = useQueryClient()
  return () => void qc.invalidateQueries({ queryKey: ['bib'] })
}

function BibCard({ b, onEdit }: { b: BibListing; onEdit: (b: BibListing) => void }) {
  const refresh = useRefresh()
  const [menu, setMenu] = useState(false)
  const [report, setReport] = useState(false)
  const [contacts, setContacts] = useState(b.contacts)
  const reveal = useMutation({ mutationFn: () => revealBibContact(b.id), onSuccess: setContacts, onError: (e) => toast.error(bibErrorMessage(e)) })
  const status = useMutation({ mutationFn: (s: Exclude<BibStatus, 'HIDDEN'>) => setBibStatus(b.id, s), onSuccess: () => { toast.success('Đã cập nhật'); setMenu(false); refresh() }, onError: (e) => toast.error(bibErrorMessage(e)) })
  const discount = b.kind === 'SELL' && b.original_price && b.price != null && b.price < b.original_price ? Math.round(100 - (100 * b.price) / b.original_price) : 0
  return (
    <Card className={cn('space-y-3', b.status === 'RESERVED' && 'opacity-80')}>
      <div className="flex items-start gap-2">
        <span className={cn('grid size-11 shrink-0 place-items-center rounded-xl', b.kind === 'SELL' ? 'bg-brand/15 text-brand' : 'bg-xp/15 text-xp')}><Ticket className="size-5" aria-hidden /></span>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">{b.kind === 'SELL' ? 'Nhượng BIB' : 'Cần mua BIB'} · {BIB_DISTANCES[b.distance]}{b.distance_note ? ` · ${b.distance_note}` : ''}</p>
          <p className="font-semibold leading-snug">{b.race_name}</p>
          <p className="flex flex-wrap gap-x-3 text-xs text-fg-muted">
            <span className="inline-flex items-center gap-1"><CalendarDays className="size-3" aria-hidden />{dmy(b.race_date)}</span>
            {b.city && <span className="inline-flex items-center gap-1"><MapPin className="size-3" aria-hidden />{b.city}</span>}
            {b.shirt_size && <span>Áo {b.shirt_size}</span>}
          </p>
        </div>
        {b.status !== 'OPEN' && <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold', BIB_STATUS[b.status].tone)}>{BIB_STATUS[b.status].label}</span>}
        <button type="button" aria-label="Tuỳ chọn" onClick={() => setMenu(true)} className="-mr-2 -mt-1 grid size-10 shrink-0 place-items-center rounded-full text-fg-subtle hover:bg-surface-2"><MoreHorizontal className="size-5" aria-hidden /></button>
      </div>

      <div className="flex flex-wrap items-end gap-x-3 gap-y-1">
        {b.kind === 'SELL' ? (
          <>
            <p className="font-mono text-xl font-bold text-brand">{b.price === 0 ? 'Tặng lại' : formatVnd(b.price)}</p>
            {b.original_price != null && b.original_price !== b.price && <p className="text-xs text-fg-subtle line-through">{formatVnd(b.original_price)}</p>}
            {discount > 0 && <span className="rounded-full bg-brand/15 px-2 py-0.5 text-[11px] font-semibold text-brand">-{discount}%</span>}
          </>
        ) : <p className="text-sm font-semibold text-xp">{b.price ? `Trả tối đa ${formatVnd(b.price)}` : 'Thương lượng, ≤ giá gốc'}</p>}
        <span className={cn('ml-auto inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold', b.transfer === 'OFFICIAL' ? 'bg-brand/10 text-brand' : 'bg-warning/15 text-warning')}>
          {b.transfer === 'OFFICIAL' ? <><BadgeCheck className="size-3" aria-hidden />Đổi tên qua BTC</> : <><AlertTriangle className="size-3" aria-hidden />Hỏi BTC cách chuyển</>}
        </span>
      </div>
      {b.note && <p className="whitespace-pre-line text-sm text-fg-muted">{b.note}</p>}
      {b.hidden_reason && <p className="rounded-lg bg-danger/10 p-2 text-xs text-danger">{b.hidden_reason}</p>}

      <div className="flex items-center gap-2 border-t border-border pt-2">
        <Avatar src={b.seller.avatar_url} name={b.seller.name} size="sm" />
        <p className="min-w-0 flex-1 truncate text-xs text-fg-muted"><b className="text-fg">{b.seller.name}</b> · {b.seller.runs} bài chạy hợp lệ</p>
        {b.mine ? <span className="inline-flex items-center gap-1 text-[11px] text-fg-subtle"><Eye className="size-3" aria-hidden />{b.reveals ?? 0} lượt xem liên hệ</span>
          : !contacts && <Button size="sm" loading={reveal.isPending} onClick={() => reveal.mutate()}><Phone className="size-4" aria-hidden />Xem liên hệ</Button>}
      </div>
      {contacts && !b.mine && (
        <div className="grid gap-1.5">
          {contacts.phone && <a href={`tel:${contacts.phone}`} className="flex min-h-11 items-center gap-2 rounded-xl border border-border px-3 text-sm font-semibold"><Phone className="size-4 text-brand" aria-hidden />{contacts.phone}</a>}
          {contacts.zalo && <a href={`https://zalo.me/${contacts.zalo.replace(/^\+?84/, '0')}`} target="_blank" rel="noopener noreferrer" className="flex min-h-11 items-center gap-2 rounded-xl border border-border px-3 text-sm font-semibold"><MessageCircle className="size-4 text-sky-400" aria-hidden />Zalo {contacts.zalo}</a>}
          {contacts.facebook && <a href={contacts.facebook} target="_blank" rel="noopener noreferrer nofollow" className="flex min-h-11 items-center gap-2 rounded-xl border border-border px-3 text-sm font-semibold"><MessageCircle className="size-4 text-[#1877F2]" aria-hidden />Facebook</a>}
          <p className="text-[11px] text-fg-subtle">Chỉ chuyển tiền khi BTC đã xác nhận đổi tên sang bạn. Không đặt cọc cho người lạ.</p>
        </div>
      )}

      <Sheet open={menu} onClose={() => setMenu(false)} title={b.race_name}>
        <div className="space-y-1">
          {b.mine ? (
            <>
              {b.status !== 'HIDDEN' && <Button block variant="secondary" onClick={() => { setMenu(false); onEdit(b) }}><Pencil className="size-4" aria-hidden />Sửa tin</Button>}
              {b.status === 'OPEN' && <Button block variant="secondary" loading={status.isPending} onClick={() => status.mutate('RESERVED')}>Đánh dấu đang giao dịch</Button>}
              {b.status === 'RESERVED' && <Button block variant="secondary" loading={status.isPending} onClick={() => status.mutate('OPEN')}>Mở lại tin</Button>}
              {(b.status === 'OPEN' || b.status === 'RESERVED') && <Button block onClick={() => status.mutate('DONE')}><Tag className="size-4" aria-hidden />Đã nhượng / đã mua xong</Button>}
              {(b.status === 'OPEN' || b.status === 'RESERVED') && <Button block variant="ghost" onClick={() => status.mutate('CANCELLED')}>Gỡ tin</Button>}
            </>
          ) : <Button block variant="danger" onClick={() => { setMenu(false); setReport(true) }}><Flag className="size-4" aria-hidden />Báo cáo tin này</Button>}
        </div>
      </Sheet>
      {report && <ReportSheet id={b.id} onClose={() => setReport(false)} />}
    </Card>
  )
}

function ReportSheet({ id, onClose }: { id: string; onClose: () => void }) {
  const [reason, setReason] = useState<keyof typeof REPORT | null>(null)
  const [note, setNote] = useState('')
  const send = useMutation({ mutationFn: () => reportBib(id, reason!, note.trim() || null), onSuccess: () => { toast.success('Đã gửi báo cáo — quản trị viên sẽ xem xét'); onClose() }, onError: (e) => toast.error(bibErrorMessage(e)) })
  return (
    <Sheet open onClose={onClose} title="Báo cáo tin BIB" footer={<Button block variant="danger" disabled={!reason} loading={send.isPending} onClick={() => send.mutate()}>Gửi báo cáo</Button>}>
      <div className="space-y-2">
        {(Object.keys(REPORT) as (keyof typeof REPORT)[]).map((k) => (
          <button key={k} type="button" aria-pressed={reason === k} onClick={() => setReason(k)}
            className={cn('w-full rounded-xl border p-3 text-left text-sm font-semibold', reason === k ? 'border-danger bg-danger/10' : 'border-border')}>{REPORT[k]}</button>
        ))}
        <Textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} rows={2} placeholder="Mô tả thêm (không bắt buộc)" />
      </div>
    </Sheet>
  )
}

const onlyDigits = (s: string) => s.replace(/[^\d]/g, '').slice(0, 9)

function BibSheet({ b, onClose }: { b: Partial<BibListing>; onClose: () => void }) {
  const refresh = useRefresh()
  const [f, setF] = useState<BibInput>({
    id: b.id, kind: b.kind ?? 'SELL', race_name: b.race_name ?? '', race_date: b.race_date ?? '', city: b.city ?? '', distance: b.distance ?? '21K',
    distance_note: b.distance_note ?? '', original_price: b.original_price ?? null, price: b.price ?? null, transfer: b.transfer ?? 'OFFICIAL',
    shirt_size: b.shirt_size ?? '', note: b.note ?? '', contacts: b.contacts ?? {},
  })
  const set = <K extends keyof BibInput>(k: K, v: BibInput[K]) => setF((x) => ({ ...x, [k]: v }))
  const sell = f.kind === 'SELL'
  const over = sell && f.price != null && f.original_price != null && f.price > f.original_price
  const hasContact = !!(f.contacts.phone || f.contacts.zalo || f.contacts.facebook)
  const ok = (f.race_name ?? '').trim().length >= 3 && !!f.race_date && hasContact && !over && (!sell || (f.price != null && f.original_price != null))
  const save = useMutation({ mutationFn: () => saveBib(f), onSuccess: () => { toast.success(b.id ? 'Đã lưu tin' : 'Đã đăng tin BIB'); refresh(); onClose() }, onError: (e) => toast.error(bibErrorMessage(e)) })
  const [today] = useState(() => new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10))
  return (
    <Sheet open onClose={onClose} title={b.id ? 'Sửa tin BIB' : 'Đăng tin BIB'} description="Tin tự ẩn sau ngày giải"
      footer={<Button block disabled={!ok} loading={save.isPending} onClick={() => save.mutate()}>{b.id ? 'Lưu' : 'Đăng tin'}</Button>}>
      <div className="space-y-4">
        <SegmentedControl value={f.kind as BibKind} onChange={(v) => set('kind', v)} options={[{ value: 'SELL', label: 'Tôi nhượng BIB' }, { value: 'BUY', label: 'Tôi cần mua' }]} />
        <Field label="Tên giải" htmlFor="bib-race"><Input id="bib-race" value={f.race_name ?? ''} maxLength={120} onChange={(e) => set('race_name', e.target.value)} placeholder="VnExpress Marathon Hà Nội 2026" /></Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Ngày giải" htmlFor="bib-date"><Input id="bib-date" type="date" min={today} value={f.race_date ?? ''} onChange={(e) => set('race_date', e.target.value)} /></Field>
          <Field label="Tỉnh / thành" htmlFor="bib-city">
            <select id="bib-city" value={f.city ?? ''} onChange={(e) => set('city', e.target.value)} className="h-11 w-full rounded-xl border border-border bg-bg px-3 text-[15px]">
              <option value="">—</option>{PROVINCES.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </Field>
        </div>
        <div className="grid grid-cols-[1fr_7rem] gap-2">
          <Field label="Cự ly" htmlFor="bib-dist">
            <select id="bib-dist" value={f.distance} onChange={(e) => set('distance', e.target.value as BibDistance)} className="h-11 w-full rounded-xl border border-border bg-bg px-3 text-[15px]">
              {(Object.keys(BIB_DISTANCES) as BibDistance[]).map((d) => <option key={d} value={d}>{BIB_DISTANCES[d]}</option>)}
            </select>
          </Field>
          <Field label="Size áo" htmlFor="bib-size"><Input id="bib-size" value={f.shirt_size ?? ''} maxLength={10} onChange={(e) => set('shirt_size', e.target.value)} placeholder="M" /></Field>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Field label={sell ? 'Giá gốc (đ)' : 'Giá gốc BIB (đ)'} htmlFor="bib-orig">
            <Input id="bib-orig" inputMode="numeric" value={f.original_price ?? ''} onChange={(e) => set('original_price', e.target.value ? Number(onlyDigits(e.target.value)) : null)} placeholder="1200000" />
          </Field>
          <Field label={sell ? 'Giá nhượng (đ)' : 'Trả tối đa (đ)'} htmlFor="bib-price" error={over ? 'Không cao hơn giá gốc' : null}>
            <Input id="bib-price" inputMode="numeric" value={f.price ?? ''} onChange={(e) => set('price', e.target.value ? Number(onlyDigits(e.target.value)) : null)} placeholder={sell ? '1000000 (0 = tặng)' : 'Không bắt buộc'} />
          </Field>
        </div>
        <Field label="Cách chuyển BIB">
          <SegmentedControl value={f.transfer as 'OFFICIAL' | 'ASK'} onChange={(v) => set('transfer', v)} options={[{ value: 'OFFICIAL', label: 'Đổi tên qua BTC' }, { value: 'ASK', label: 'Chưa rõ, hỏi BTC' }]} />
        </Field>
        <Field label="Liên hệ (ẩn cho tới khi người khác bấm “Xem liên hệ”)">
          <div className="space-y-2">
            <Input inputMode="tel" value={f.contacts.phone ?? ''} onChange={(e) => set('contacts', { ...f.contacts, phone: e.target.value || undefined })} placeholder="Số điện thoại" aria-label="Số điện thoại" />
            <Input inputMode="tel" value={f.contacts.zalo ?? ''} onChange={(e) => set('contacts', { ...f.contacts, zalo: e.target.value || undefined })} placeholder="Số Zalo" aria-label="Số Zalo" />
            <Input inputMode="url" value={f.contacts.facebook ?? ''} onChange={(e) => set('contacts', { ...f.contacts, facebook: e.target.value || undefined })} placeholder="https://facebook.com/…" aria-label="Link Facebook" />
          </div>
        </Field>
        <Field label="Ghi chú" htmlFor="bib-note"><Textarea id="bib-note" rows={3} maxLength={500} value={f.note ?? ''} onChange={(e) => set('note', e.target.value)} placeholder="Lý do nhượng, hạn BTC cho đổi tên, nhận race kit…" /></Field>
      </div>
    </Sheet>
  )
}
