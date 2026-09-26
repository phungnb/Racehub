'use client'

import Link from 'next/link'
import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Copy, Download, ImagePlus, Minus, Package, Pencil, Plus, ShoppingBag } from 'lucide-react'
import { toast } from 'sonner'
import { Button, Card, EmptyState, ErrorState, Field, Input, SegmentedControl, Sheet, Skeleton, Textarea } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { routes } from '@/shared/config/routes'
import { useSession } from '@/features/auth'
import { clubErrorMessage } from '../../api/clubApi'
import { uploadReceipt } from '../../api/eventsApi'
import {
  cancelMyOrder, getClubShop, getProductOrders, ORDER_STATUS, ordersCsv, placeOrder, saveProduct, setOrderStatus,
  type ClubBank, type ClubOrder, type ClubProduct, type OrderItem, type ProductInput, type ProductStatus,
} from '../../api/shopApi'
import { bankName, formatVnd, parseVnd, vietQrUrl } from '../../model/finance'

const key = (clubId: string) => ['club', clubId, 'shop'] as const
const fmtDate = (d: string) => new Date(d).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

/** Tab Cửa hàng (migration 007900): RaceHub chỉ ghi đơn — tiền chuyển thẳng vào tài khoản ngân hàng của CLB */
export function ClubShopScreen({ clubId }: { clubId: string }) {
  const q = useQuery({ queryKey: key(clubId), queryFn: () => getClubShop(clubId) })
  const [open, setOpen] = useState<ClubProduct | null>(null)
  const [edit, setEdit] = useState<ClubProduct | 'new' | null>(null)
  const [orders, setOrders] = useState<ClubProduct | null>(null)
  const [pay, setPay] = useState<(ClubOrder & { bank: ClubBank }) | null>(null)
  if (q.isPending) return <div className="grid grid-cols-2 gap-3"><Skeleton className="h-56" /><Skeleton className="h-56" /></div>
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />
  const s = q.data
  return (
    <div className="space-y-5 pb-10">
      {s.is_staff && (
        <div className="flex items-center gap-2">
          <p className="min-w-0 flex-1 text-sm text-fg-muted">Thành viên đặt trong app, chuyển khoản thẳng vào tài khoản CLB. RaceHub không thu phí, không giữ tiền.</p>
          <Button size="sm" onClick={() => setEdit('new')}><Plus className="size-4" aria-hidden />Sản phẩm</Button>
        </div>
      )}
      {s.is_staff && !s.bank && (
        <Card className="border-warning/40 bg-warning/10 text-sm">
          Chưa khai tài khoản nhận tiền nên thành viên chưa đặt được. <Link href={routes.clubTab(clubId, 'treasury')} className="font-semibold text-brand">Khai ở tab Quỹ →</Link>
        </Card>
      )}
      {s.products.length === 0 ? (
        <EmptyState icon={ShoppingBag} title="Cửa hàng chưa có sản phẩm" description={s.is_staff ? 'Đăng áo, BIB, mũ… để thành viên đặt và chuyển khoản trong app.' : 'Ban quản trị CLB sẽ mở bán áo, đồ CLB tại đây.'} />
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {s.products.map((p) => (
            <button key={p.id} type="button" onClick={() => (s.is_staff ? setOrders(p) : setOpen(p))}
              className="overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface text-left hover:border-fg-subtle">
              <div className="relative aspect-square bg-surface-2">
                {/* eslint-disable-next-line @next/next/no-img-element -- ảnh sản phẩm từ kho CLB */}
                {p.image_url ? <img src={p.image_url} alt="" className="size-full object-cover" /> : <Package className="absolute inset-0 m-auto size-10 text-fg-subtle" aria-hidden />}
                <span className={cn('absolute left-2 top-2 rounded-full px-2 py-0.5 text-[11px] font-bold',
                  p.open ? 'bg-brand text-brand-fg' : 'bg-bg/80 text-fg-muted')}>{p.status === 'HIDDEN' ? 'Ẩn' : p.open ? 'Đang nhận đơn' : 'Đã chốt'}</span>
              </div>
              <div className="space-y-0.5 p-3">
                <p className="line-clamp-2 text-sm font-semibold leading-snug">{p.title}</p>
                <p className="font-mono font-bold text-coin">{formatVnd(p.price_vnd)}</p>
                <p className="text-[11px] text-fg-subtle">
                  {p.order_deadline ? `Chốt ${fmtDate(p.order_deadline)}` : 'Không hạn chốt'}{p.stock ? ` · còn ${Math.max(p.stock - p.sold, 0)}` : ''}
                </p>
                {s.is_staff && <p className="text-[11px] font-semibold text-brand">{p.pending ?? 0} chờ CK · {p.paid ?? 0} đã trả</p>}
              </div>
            </button>
          ))}
        </div>
      )}

      {s.my_orders.length > 0 && (
        <section className="space-y-2">
          <h2 className="font-semibold">Đơn của tôi</h2>
          {s.my_orders.map((o) => <MyOrder key={o.id} clubId={clubId} o={o} bank={s.bank} onPay={setPay} />)}
        </section>
      )}

      {open && <OrderSheet product={open} onClose={() => setOpen(null)} onPlaced={(o) => { setOpen(null); setPay(o) }} />}
      {pay && <PaySheet order={pay} onClose={() => setPay(null)} />}
      {edit && <ProductEditor clubId={clubId} initial={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
      {orders && <OrdersSheet product={orders} onClose={() => setOrders(null)} onEdit={() => { setEdit(orders); setOrders(null) }} onBuy={() => { setOpen(orders); setOrders(null) }} />}
    </div>
  )
}

function MyOrder({ clubId, o, bank, onPay }: { clubId: string; o: ClubOrder; bank: ClubBank | null; onPay: (o: ClubOrder & { bank: ClubBank }) => void }) {
  const qc = useQueryClient()
  const cancel = useMutation({
    mutationFn: () => cancelMyOrder(o.id),
    onSuccess: () => { toast.success('Đã huỷ đơn'); void qc.invalidateQueries({ queryKey: key(clubId) }) },
    onError: (e) => toast.error(clubErrorMessage(e)),
  })
  return (
    <Card className="space-y-2 p-3 text-sm">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate font-semibold">{o.product_title}</span>
        <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold', ORDER_STATUS[o.status].tone)}>{ORDER_STATUS[o.status].label}</span>
      </div>
      <p className="text-fg-muted">{o.items.map((i) => `${i.size ?? ''}×${i.qty}`).join(' · ')} · <b className="text-fg">{formatVnd(o.amount_vnd)}</b> · mã <span className="font-mono">{o.code}</span></p>
      {o.status_note && <p className="text-xs text-fg-subtle">{o.status_note}</p>}
      {o.status === 'PENDING' && (
        <div className="flex gap-2">
          {bank && <Button size="sm" onClick={() => onPay({ ...o, bank })}>Xem mã chuyển khoản</Button>}
          <Button size="sm" variant="ghost" loading={cancel.isPending} onClick={() => cancel.mutate()}>Huỷ đơn</Button>
        </div>
      )}
    </Card>
  )
}

function OrderSheet({ product: p, onClose, onPlaced }: { product: ClubProduct; onClose: () => void; onPlaced: (o: ClubOrder & { bank: ClubBank }) => void }) {
  const sizes = p.sizes.length ? p.sizes : ['']
  const [qty, setQty] = useState<Record<string, number>>(() => ({ [sizes[0]]: 1 }))
  const [note, setNote] = useState('')
  const total = Object.values(qty).reduce((a, b) => a + b, 0)
  const left = p.stock ? p.stock - p.sold : Infinity
  const place = useMutation({
    mutationFn: () => placeOrder(p.id, Object.entries(qty).filter(([, n]) => n > 0).map(([size, n]): OrderItem => ({ size: size || null, qty: n })), note.trim() || null),
    onSuccess: (o) => { toast.success('Đã ghi đơn — chuyển khoản để CLB xác nhận'); onPlaced(o) },
    onError: (e) => toast.error(clubErrorMessage(e)),
  })
  const bump = (s: string, d: number) => setQty((x) => ({ ...x, [s]: Math.max(0, (x[s] ?? 0) + d) }))
  return (
    <Sheet open onClose={onClose} title={p.title} description={`${formatVnd(p.price_vnd)} / sản phẩm${p.order_deadline ? ` · chốt ${fmtDate(p.order_deadline)}` : ''}`}
      footer={<Button block disabled={!p.open || total < 1 || total > p.max_per_order || total > left} loading={place.isPending} onClick={() => place.mutate()}>
        {p.open ? `Đặt ${total} · ${formatVnd(p.price_vnd * total)}` : 'Đã chốt đơn'}</Button>}>
      <div className="space-y-4">
        {/* eslint-disable-next-line @next/next/no-img-element -- ảnh sản phẩm */}
        {p.image_url && <img src={p.image_url} alt="" className="max-h-72 w-full rounded-xl object-cover" />}
        {p.description && <p className="whitespace-pre-line text-sm text-fg-muted">{p.description}</p>}
        <div className="space-y-2">
          {sizes.map((s) => (
            <div key={s || 'one'} className="flex items-center gap-3 rounded-xl border border-border px-3 py-2">
              <span className="flex-1 font-semibold">{s ? `Size ${s}` : 'Số lượng'}</span>
              <Button size="sm" variant="secondary" aria-label="Bớt" onClick={() => bump(s, -1)}><Minus className="size-4" aria-hidden /></Button>
              <span className="w-6 text-center font-mono font-bold">{qty[s] ?? 0}</span>
              <Button size="sm" variant="secondary" aria-label="Thêm" disabled={total >= p.max_per_order} onClick={() => bump(s, 1)}><Plus className="size-4" aria-hidden /></Button>
            </div>
          ))}
          <p className="text-xs text-fg-subtle">Tối đa {p.max_per_order} mỗi đơn{Number.isFinite(left) ? ` · còn ${left}` : ''}</p>
        </div>
        <Field label="Ghi chú cho CLB (không bắt buộc)" htmlFor="so-note"><Input id="so-note" value={note} maxLength={200} placeholder="In tên sau lưng: MINH ANH" onChange={(e) => setNote(e.target.value)} /></Field>
      </div>
    </Sheet>
  )
}

function PaySheet({ order: o, onClose }: { order: ClubOrder & { bank: ClubBank }; onClose: () => void }) {
  const copy = (v: string, what: string) => { void navigator.clipboard?.writeText(v).then(() => toast.success(`Đã sao chép ${what}`)) }
  return (
    <Sheet open onClose={onClose} title={`Chuyển khoản · ${formatVnd(o.amount_vnd)}`} description="Quét bằng app ngân hàng. Tiền vào thẳng tài khoản CLB; ban quản trị xác nhận sau khi nhận.">
      <div className="space-y-3 text-center">
        {/* eslint-disable-next-line @next/next/no-img-element -- ảnh VietQR */}
        <img src={vietQrUrl(o.bank, o.amount_vnd, o.code)} alt={`Mã VietQR chuyển ${formatVnd(o.amount_vnd)} nội dung ${o.code}`} className="mx-auto w-64 rounded-xl bg-white p-2" />
        <div className="space-y-1.5 rounded-xl bg-surface-2 p-3 text-left text-sm">
          <p className="flex items-center justify-between gap-2"><span className="text-fg-muted">{bankName(o.bank.bin)}</span></p>
          <p className="flex items-center justify-between gap-2"><span className="font-mono font-bold">{o.bank.account_no}</span>
            <Button size="sm" variant="ghost" aria-label="Sao chép số tài khoản" onClick={() => copy(o.bank.account_no, 'số tài khoản')}><Copy className="size-4" aria-hidden /></Button></p>
          <p className="text-fg-muted">{o.bank.account_name}</p>
          <p className="flex items-center justify-between gap-2"><span>Nội dung: <b className="font-mono">{o.code}</b></span>
            <Button size="sm" variant="ghost" aria-label="Sao chép nội dung" onClick={() => copy(o.code, 'nội dung')}><Copy className="size-4" aria-hidden /></Button></p>
        </div>
        <p className="text-xs text-fg-subtle">Giữ đúng nội dung <b>{o.code}</b> để CLB đối soát. RaceHub không thu hay giữ khoản tiền này.</p>
      </div>
    </Sheet>
  )
}

function OrdersSheet({ product: p, onClose, onEdit, onBuy }: { product: ClubProduct; onClose: () => void; onEdit: () => void; onBuy: () => void }) {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['club', p.club_id, 'shop', p.id, 'orders'], queryFn: () => getProductOrders(p.id) })
  const [filter, setFilter] = useState<'ALL' | 'PENDING' | 'PAID'>('ALL')
  const set = useMutation({
    mutationFn: ({ id, status }: { id: string; status: ClubOrder['status'] }) => setOrderStatus(id, status),
    onSuccess: () => { void q.refetch(); void qc.invalidateQueries({ queryKey: key(p.club_id) }) },
    onError: (e) => toast.error(clubErrorMessage(e)),
  })
  const csv = () => {
    if (!q.data) return
    const url = URL.createObjectURL(new Blob([ordersCsv(q.data.orders)], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a'); a.href = url; a.download = `don-hang-${p.title.replace(/\s+/g, '-')}.csv`; a.click(); URL.revokeObjectURL(url)
  }
  const rows = (q.data?.orders ?? []).filter((o) => filter === 'ALL' ? o.status !== 'CANCELLED' : filter === 'PENDING' ? o.status === 'PENDING' : o.status === 'PAID' || o.status === 'DELIVERED')
  return (
    <Sheet open onClose={onClose} title={p.title} description={`${formatVnd(p.price_vnd)} · đã đặt ${p.sold}${p.stock ? `/${p.stock}` : ''}`}>
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={onEdit}><Pencil className="size-4" aria-hidden />Sửa</Button>
          <Button size="sm" variant="secondary" onClick={csv} disabled={!q.data?.orders.length}><Download className="size-4" aria-hidden />CSV</Button>
          {p.open && <Button size="sm" variant="ghost" onClick={onBuy}>Tự đặt</Button>}
        </div>
        {q.isPending ? <Skeleton className="h-40" /> : q.isError ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : (
          <>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <Card className="p-3"><p className="text-xs text-fg-subtle">Đã nhận</p><p className="font-mono font-bold text-brand">{formatVnd(q.data.totals.paid_vnd)}</p></Card>
              <Card className="p-3"><p className="text-xs text-fg-subtle">Chờ chuyển khoản</p><p className="font-mono font-bold text-warning">{formatVnd(q.data.totals.pending_vnd)}</p></Card>
            </div>
            {q.data.sizes.length > 0 && (
              <div className="flex flex-wrap gap-1.5 text-xs">
                {q.data.sizes.map((s) => <span key={s.size} className="rounded-full bg-surface-2 px-2.5 py-1"><b>{s.size}</b> × {s.qty}{s.paid_qty < s.qty ? ` (đã trả ${s.paid_qty})` : ''}</span>)}
              </div>
            )}
            <SegmentedControl value={filter} onChange={setFilter} options={[{ value: 'ALL', label: 'Tất cả' }, { value: 'PENDING', label: 'Chờ CK' }, { value: 'PAID', label: 'Đã trả' }]} />
            {rows.length === 0 ? <p className="py-6 text-center text-sm text-fg-subtle">Chưa có đơn</p> : rows.map((o) => (
              <div key={o.id} className="space-y-1.5 rounded-xl border border-border p-3 text-sm">
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate font-semibold">{o.buyer}</span>
                  <span className="font-mono text-xs">{o.code}</span>
                  <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold', ORDER_STATUS[o.status].tone)}>{ORDER_STATUS[o.status].label}</span>
                </div>
                <p className="text-fg-muted">{o.items.map((i) => `${i.size ?? ''}×${i.qty}`).join(' · ')} · {formatVnd(o.amount_vnd)}{o.note ? ` · “${o.note}”` : ''}</p>
                <div className="flex flex-wrap gap-1.5">
                  {o.status === 'PENDING' && <Button size="sm" onClick={() => set.mutate({ id: o.id, status: 'PAID' })}>Đã nhận tiền</Button>}
                  {o.status === 'PAID' && <Button size="sm" onClick={() => set.mutate({ id: o.id, status: 'DELIVERED' })}>Đã giao</Button>}
                  {(o.status === 'PENDING' || o.status === 'PAID') && <Button size="sm" variant="ghost" onClick={() => set.mutate({ id: o.id, status: 'CANCELLED' })}>Huỷ</Button>}
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    </Sheet>
  )
}

function ProductEditor({ clubId, initial, onClose }: { clubId: string; initial: ClubProduct | null; onClose: () => void }) {
  const qc = useQueryClient()
  const { session } = useSession()
  const fileRef = useRef<HTMLInputElement>(null)
  const [f, setF] = useState<ProductInput>(() => initial
    ? { id: initial.id, club_id: clubId, title: initial.title, description: initial.description, image_url: initial.image_url, price_vnd: initial.price_vnd,
        sizes: initial.sizes, stock: initial.stock, max_per_order: initial.max_per_order, order_deadline: initial.order_deadline, status: initial.status }
    : { club_id: clubId, title: '', description: '', image_url: null, price_vnd: 0, sizes: ['S', 'M', 'L', 'XL'], stock: null, max_per_order: 5, order_deadline: null, status: 'OPEN' })
  const [uploading, setUploading] = useState(false)
  const set = <K extends keyof ProductInput>(k: K, v: ProductInput[K]) => setF((x) => ({ ...x, [k]: v }))
  const save = useMutation({
    mutationFn: () => saveProduct(f),
    onSuccess: () => { toast.success(initial ? 'Đã lưu sản phẩm' : 'Đã mở bán — cả CLB được báo'); void qc.invalidateQueries({ queryKey: key(clubId) }); onClose() },
    onError: (e) => toast.error(clubErrorMessage(e)),
  })
  const upload = async (file: File) => {
    if (!session?.user.id) return
    setUploading(true)
    try { set('image_url', await uploadReceipt(clubId, session.user.id, file, 'receipt')) } catch (e) { toast.error(clubErrorMessage(e)) } finally { setUploading(false) }
  }
  const toLocal = (iso: string | null) => (iso ? new Date(new Date(iso).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '')
  return (
    <Sheet open onClose={onClose} title={initial ? 'Sửa sản phẩm' : 'Sản phẩm mới'}
      footer={<Button block loading={save.isPending} disabled={f.title.trim().length < 2 || uploading} onClick={() => save.mutate()}>{initial ? 'Lưu' : 'Mở bán'}</Button>}>
      <div className="space-y-4">
        <button type="button" onClick={() => fileRef.current?.click()} className="grid aspect-video w-full place-items-center overflow-hidden rounded-xl border border-dashed border-border bg-surface-2">
          {/* eslint-disable-next-line @next/next/no-img-element -- xem trước ảnh sản phẩm */}
          {f.image_url ? <img src={f.image_url} alt="" className="size-full object-cover" /> : <span className="flex items-center gap-2 text-sm text-fg-muted"><ImagePlus className="size-5" aria-hidden />{uploading ? 'Đang tải…' : 'Ảnh sản phẩm'}</span>}
        </button>
        <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) void upload(file); e.target.value = '' }} />
        <Field label="Tên" htmlFor="pe-title"><Input id="pe-title" value={f.title} maxLength={80} placeholder="Áo CLB 2026" onChange={(e) => set('title', e.target.value)} /></Field>
        <Field label="Mô tả" htmlFor="pe-desc"><Textarea id="pe-desc" value={f.description ?? ''} maxLength={1000} rows={3} placeholder="Chất vải, bảng size, thời gian giao…" onChange={(e) => set('description', e.target.value)} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Giá (đ)" htmlFor="pe-price"><Input id="pe-price" inputMode="numeric" value={f.price_vnd ? f.price_vnd.toLocaleString('vi-VN') : ''} onChange={(e) => set('price_vnd', parseVnd(e.target.value) || 0)} /></Field>
          <Field label="Tối đa mỗi đơn" htmlFor="pe-max"><Input id="pe-max" inputMode="numeric" value={String(f.max_per_order)} onChange={(e) => set('max_per_order', Math.min(50, Math.max(1, Number(e.target.value.replace(/\D/g, '')) || 1)))} /></Field>
          <Field label="Tổng số lượng (trống = không giới hạn)" htmlFor="pe-stock"><Input id="pe-stock" inputMode="numeric" value={f.stock ?? ''} onChange={(e) => set('stock', Number(e.target.value.replace(/\D/g, '')) || null)} /></Field>
          <Field label="Hạn chốt đơn" htmlFor="pe-deadline"><Input id="pe-deadline" type="datetime-local" value={toLocal(f.order_deadline)} onChange={(e) => set('order_deadline', e.target.value ? new Date(e.target.value).toISOString() : null)} /></Field>
        </div>
        <Field label="Size (cách nhau bằng dấu phẩy, trống = không có size)" htmlFor="pe-sizes">
          <Input id="pe-sizes" value={f.sizes.join(', ')} onChange={(e) => set('sizes', e.target.value.split(',').map((x) => x.trim()).filter(Boolean).slice(0, 12))} />
        </Field>
        <SegmentedControl value={f.status} onChange={(v: ProductStatus) => set('status', v)} options={[{ value: 'OPEN', label: 'Nhận đơn' }, { value: 'CLOSED', label: 'Chốt đơn' }, { value: 'HIDDEN', label: 'Ẩn' }]} />
      </div>
    </Sheet>
  )
}
