'use client'

import Link from 'next/link'
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, Download, ExternalLink, Package, Phone, Plus, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button, Card, EmptyState, ErrorState, Field, Input, SegmentedControl, Sheet, Skeleton, Textarea } from '@/shared/ui'
import { SwitchRow } from '@/shared/ui/Switch'
import { cn } from '@/shared/lib/cn'
import { routes } from '@/shared/config/routes'
import { BANKS, formatVnd } from '@/features/club'
import { FileButton } from '@/shared/design/studio/bits'
import { uploadPartnerImage } from '../../api/marketApi'
import {
  deleteProduct, getShop, ORDER_STATUS, ordersCsv, PAY_LABEL, saveProduct, saveShopSettings, setOrderStatus, shopErrorMessage, shopOrders,
  type OrderStatus, type Product, type ProductInput, type ShopOrder, type ShopSettings,
} from '../../api/shopApi'
import { OrderLines, ProductCard, Thumb } from './ShopBits'

type Tab = 'products' | 'orders' | 'settings'
const fmtDate = (d: string) => new Date(d).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
const digits = (s: string) => s.replace(/\D/g, '')
const toInt = (s: string) => (s.trim() === '' ? null : Number(digits(s)))

/** Quản lý cửa hàng của đối tác: đăng / sửa sản phẩm, xử lý đơn, cài đặt thanh toán & giao hàng */
export function ShopManager({ partnerId }: { partnerId: string }) {
  const shop = useQuery({ queryKey: ['market', 'shop', partnerId], queryFn: () => getShop(partnerId) })
  const orders = useQuery({ queryKey: ['market', 'shop-orders', partnerId], queryFn: () => shopOrders(partnerId), refetchInterval: 60_000 })
  const [tab, setTab] = useState<Tab>('products')
  const back = <Link href={routes.marketMine} className="inline-flex items-center gap-1 text-sm text-fg-muted"><ChevronLeft className="size-4" aria-hidden />Hồ sơ của tôi</Link>
  if (shop.isPending) return <div className="space-y-4">{back}<Skeleton className="h-24" /><Skeleton className="h-48" /></div>
  if (shop.isError) return <div className="space-y-4">{back}<ErrorState message={shopErrorMessage(shop.error)} error={shop.error} onRetry={() => void shop.refetch()} /></div>
  const { partner, settings, products } = shop.data
  if (!partner.is_mine) return <div className="space-y-4">{back}<ErrorState message="Bạn không phải chủ cửa hàng này." /></div>
  const todo = (orders.data?.totals.pending ?? 0) + (orders.data?.totals.paid ?? 0)
  const setupMissing = !settings.bank_ready && !settings.cod_enabled
  return (
    <div className="space-y-4 animate-fade-in">
      {back}
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-bold">Cửa hàng · {partner.name}</h1>
          <p className="text-sm text-fg-muted">{partner.status === 'APPROVED' ? 'Cửa hàng đang hiện trên Chợ Runner.' : 'Bạn có thể đăng sản phẩm ngay; khách chỉ thấy sau khi RaceHub xác minh hồ sơ.'}</p>
        </div>
        <Link href={routes.partner(partner.id)}><Button size="sm" variant="secondary"><ExternalLink className="size-4" aria-hidden />Xem</Button></Link>
      </header>
      {partner.status !== 'APPROVED' && <Card className="border-warning/40 bg-warning/5 p-3 text-sm">Hồ sơ đang ở trạng thái <b>{partner.status === 'PENDING' ? 'chờ xác minh' : partner.status === 'REJECTED' ? 'cần bổ sung' : 'bị ẩn'}</b> — khách chưa thấy cửa hàng.</Card>}
      {setupMissing && tab !== 'settings' && (
        <button type="button" onClick={() => setTab('settings')} className="w-full rounded-[var(--radius-card)] border border-warning/40 bg-warning/5 p-3 text-left text-sm">
          <b>Chưa thiết lập thanh toán.</b> Khách chưa đặt hàng được — thêm tài khoản ngân hàng nhận tiền hoặc bật COD.
        </button>
      )}
      <SegmentedControl value={tab} onChange={setTab} options={[
        { value: 'products', label: 'Sản phẩm', count: products.length || undefined },
        { value: 'orders', label: 'Đơn hàng', count: todo || undefined },
        { value: 'settings', label: 'Cài đặt' },
      ]} />
      {tab === 'products' && <ProductsTab partnerId={partnerId} products={products} />}
      {tab === 'orders' && <OrdersTab partnerId={partnerId} q={orders} />}
      {tab === 'settings' && <SettingsTab partnerId={partnerId} s={settings} />}
    </div>
  )
}

/* ------------------------------ Sản phẩm ------------------------------ */
function ProductsTab({ partnerId, products }: { partnerId: string; products: Product[] }) {
  const [edit, setEdit] = useState<Product | 'new' | null>(null)
  const active = products.filter((p) => p.status === 'ACTIVE').length
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-fg-muted">{products.length} sản phẩm · {active} đang bán</p>
        <Button size="sm" onClick={() => setEdit('new')}><Plus className="size-4" aria-hidden />Đăng sản phẩm</Button>
      </div>
      {!products.length ? (
        <EmptyState icon={Package} title="Chưa có sản phẩm" description="Đăng sản phẩm đầu tiên: ảnh, giá, size / màu và số lượng tồn kho." action={<Button onClick={() => setEdit('new')}><Plus className="size-4" aria-hidden />Đăng sản phẩm</Button>} />
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {products.map((p) => (
            <li key={p.id} className="space-y-1.5">
              <ProductCard p={p} />
              <Button size="sm" variant="secondary" block onClick={() => setEdit(p)}>Sửa</Button>
            </li>
          ))}
        </ul>
      )}
      {edit && <ProductForm key={edit === 'new' ? 'new' : edit.id} partnerId={partnerId} initial={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
    </div>
  )
}

interface VarDraft { id?: string; name: string; price: string; stock: string }
function ProductForm({ partnerId, initial, onClose }: { partnerId: string; initial: Product | null; onClose: () => void }) {
  const qc = useQueryClient()
  const [title, setTitle] = useState(initial?.title ?? '')
  const [desc, setDesc] = useState(initial?.description ?? '')
  const [category, setCategory] = useState(initial?.category ?? '')
  const [images, setImages] = useState<string[]>(initial?.images ?? [])
  const [price, setPrice] = useState(initial ? String(initial.price_vnd) : '')
  const [compare, setCompare] = useState(initial?.compare_price_vnd ? String(initial.compare_price_vnd) : '')
  const [sku, setSku] = useState(initial?.sku ?? '')
  const [stock, setStock] = useState(initial?.stock != null ? String(initial.stock) : '')
  const [hidden, setHidden] = useState(initial?.status === 'HIDDEN')
  const [vars, setVars] = useState<VarDraft[]>((initial?.variants ?? []).map((v) => ({ id: v.id, name: v.name, price: v.own_price != null ? String(v.own_price) : '', stock: v.stock != null ? String(v.stock) : '' })))
  const [busy, setBusy] = useState(false)
  const priceN = toInt(price) ?? 0
  const compareN = toInt(compare)
  const upload = async (f: File | undefined) => {
    if (!f || images.length >= 8) return
    setBusy(true)
    try { const u = await uploadPartnerImage(f); setImages((x) => [...x, u]) } catch (e) { toast.error(shopErrorMessage(e)) } finally { setBusy(false) }
  }
  const setVar = (i: number, p: Partial<VarDraft>) => setVars((x) => x.map((v, j) => (j === i ? { ...v, ...p } : v)))
  const save = useMutation({
    mutationFn: () => saveProduct({
      id: initial?.id, partner_id: partnerId, title: title.trim(), description: desc.trim() || null, images, category: category.trim() || null,
      price_vnd: priceN, compare_price_vnd: compareN && compareN > priceN ? compareN : null, sku: sku.trim() || null,
      stock: vars.length ? null : toInt(stock), status: hidden ? 'HIDDEN' : 'ACTIVE',
      variants: vars.filter((v) => v.name.trim()).map((v) => ({ id: v.id, name: v.name.trim(), price_vnd: toInt(v.price), stock: toInt(v.stock) })),
    } satisfies ProductInput),
    onSuccess: () => { toast.success(initial ? 'Đã lưu sản phẩm' : 'Đã đăng sản phẩm'); void qc.invalidateQueries({ queryKey: ['market'] }); onClose() },
    onError: (e) => toast.error(shopErrorMessage(e)),
  })
  const del = useMutation({
    mutationFn: () => deleteProduct(initial!.id),
    onSuccess: () => { toast.success('Đã xoá sản phẩm'); void qc.invalidateQueries({ queryKey: ['market'] }); onClose() },
    onError: (e) => toast.error(shopErrorMessage(e)),
  })
  const bad = title.trim().length < 2 || priceN > 50_000_000 || (!!compareN && compareN <= priceN && compare !== '')
  return (
    <Sheet open onClose={onClose} title={initial ? 'Sửa sản phẩm' : 'Đăng sản phẩm'}
      footer={<Button block loading={save.isPending} disabled={bad || busy} onClick={() => save.mutate()}>{initial ? 'Lưu sản phẩm' : 'Đăng sản phẩm'}</Button>}>
      <div className="space-y-4">
        <div className="space-y-1">
          <p className="text-sm font-medium text-fg-muted">Ảnh sản phẩm ({images.length}/8) — ảnh đầu tiên là ảnh bìa</p>
          <div className="flex flex-wrap gap-2">
            {images.map((u, i) => (
              <span key={u} className="relative">
                <Thumb src={u} alt={`Ảnh ${i + 1}`} className="size-20 rounded-xl" />
                <button type="button" aria-label={`Bỏ ảnh ${i + 1}`} onClick={() => setImages((x) => x.filter((y) => y !== u))} className="absolute -right-1 -top-1 grid size-6 place-items-center rounded-full bg-bg ring-1 ring-border"><X className="size-3.5" aria-hidden /></button>
                {i > 0 && <button type="button" onClick={() => setImages((x) => [u, ...x.filter((y) => y !== u)])} className="absolute inset-x-0 bottom-0 rounded-b-xl bg-bg/80 text-[10px] font-semibold">Đặt làm bìa</button>}
              </span>
            ))}
            {images.length < 8 && (
              <FileButton onPick={(f) => void upload(f)} disabled={busy} label="Thêm ảnh" className="grid size-20 place-items-center rounded-xl border border-dashed border-border bg-surface-2 text-xs text-fg-muted">
                {busy ? 'Đang tải…' : <Plus className="size-5" aria-hidden />}
              </FileButton>
            )}
          </div>
        </div>
        <Field label="Tên sản phẩm" htmlFor="pf-title"><Input id="pf-title" value={title} maxLength={100} onChange={(e) => setTitle(e.target.value)} placeholder="Giày chạy bộ Alpha Pro" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Giá bán (đ)" htmlFor="pf-price"><Input id="pf-price" inputMode="numeric" value={price ? Number(digits(price)).toLocaleString('vi-VN') : ''} onChange={(e) => setPrice(digits(e.target.value))} /></Field>
          <Field label="Giá gốc (đ)" htmlFor="pf-cmp" hint="Để trống nếu không giảm giá." error={compare && compareN !== null && compareN <= priceN ? 'Phải cao hơn giá bán' : undefined}>
            <Input id="pf-cmp" inputMode="numeric" value={compare ? Number(digits(compare)).toLocaleString('vi-VN') : ''} onChange={(e) => setCompare(digits(e.target.value))} />
          </Field>
          <Field label="Danh mục" htmlFor="pf-cat"><Input id="pf-cat" value={category} maxLength={30} onChange={(e) => setCategory(e.target.value)} placeholder="Giày, Áo, Dinh dưỡng…" /></Field>
          <Field label="Mã SKU" htmlFor="pf-sku"><Input id="pf-sku" value={sku} maxLength={40} onChange={(e) => setSku(e.target.value)} /></Field>
        </div>
        <Field label="Mô tả" htmlFor="pf-desc" hint="Chất liệu, bảng size, bảo hành, thời gian giao…">
          <Textarea id="pf-desc" rows={4} value={desc} maxLength={2000} onChange={(e) => setDesc(e.target.value)} />
        </Field>

        <div className="space-y-2 rounded-xl border border-border p-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold">Phân loại (size, màu…)</p>
            <Button size="sm" variant="secondary" disabled={vars.length >= 30} onClick={() => setVars((x) => [...x, { name: '', price: '', stock: '' }])}><Plus className="size-4" aria-hidden />Thêm</Button>
          </div>
          {vars.length === 0 ? (
            <Field label="Số lượng tồn kho" htmlFor="pf-stock" hint="Để trống = không giới hạn. Hết hàng khách không đặt được.">
              <Input id="pf-stock" inputMode="numeric" value={stock} onChange={(e) => setStock(digits(e.target.value))} />
            </Field>
          ) : (
            <>
              <p className="text-xs text-fg-subtle">Mỗi phân loại có tồn kho riêng. Giá để trống = dùng giá bán ở trên. Ví dụ: “Đen / 42”.</p>
              {vars.map((v, i) => (
                <div key={v.id ?? i} className="grid grid-cols-[1fr_6.5rem_5rem_auto] items-center gap-1.5">
                  <Input aria-label="Tên phân loại" value={v.name} maxLength={60} placeholder="Tên" onChange={(e) => setVar(i, { name: e.target.value })} />
                  <Input aria-label="Giá riêng" inputMode="numeric" value={v.price ? Number(digits(v.price)).toLocaleString('vi-VN') : ''} placeholder="Giá" onChange={(e) => setVar(i, { price: digits(e.target.value) })} />
                  <Input aria-label="Tồn kho" inputMode="numeric" value={v.stock} placeholder="Kho" onChange={(e) => setVar(i, { stock: digits(e.target.value) })} />
                  <Button size="sm" variant="ghost" aria-label="Xoá phân loại" onClick={() => setVars((x) => x.filter((_, j) => j !== i))}><Trash2 className="size-4" aria-hidden /></Button>
                </div>
              ))}
            </>
          )}
        </div>
        <SwitchRow checked={!hidden} onChange={(v) => setHidden(!v)} label="Đang bán" description="Tắt để ẩn sản phẩm khỏi cửa hàng (không xoá)." />
        {initial && <Button variant="danger" block loading={del.isPending} onClick={() => { if (window.confirm('Xoá hẳn sản phẩm này? Đơn đã đặt vẫn được giữ.')) del.mutate() }}><Trash2 className="size-4" aria-hidden />Xoá sản phẩm</Button>}
      </div>
    </Sheet>
  )
}

/* ------------------------------ Đơn hàng ------------------------------ */
type Filter = 'TODO' | 'SHIPPING' | 'DONE' | 'CANCELLED' | 'ALL'
function OrdersTab({ partnerId, q }: { partnerId: string; q: ReturnType<typeof useQuery<Awaited<ReturnType<typeof shopOrders>>>> }) {
  const qc = useQueryClient()
  const [filter, setFilter] = useState<Filter>('TODO')
  const [ship, setShip] = useState<ShopOrder | null>(null)
  const set = useMutation({
    mutationFn: (a: { id: string; status: OrderStatus; note?: string | null; tracking?: string | null }) => setOrderStatus(a.id, a.status, a.note, a.tracking),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['market', 'shop-orders', partnerId] }); void qc.invalidateQueries({ queryKey: ['market', 'shop', partnerId] }) },
    onError: (e) => toast.error(shopErrorMessage(e)),
  })
  if (q.isPending) return <Skeleton className="h-48" />
  if (q.isError) return <ErrorState message={shopErrorMessage(q.error)} error={q.error} onRetry={() => void q.refetch()} />
  const { orders, totals } = q.data
  const rows = orders.filter((o) => filter === 'ALL' ? true : filter === 'TODO' ? o.status === 'PENDING' || o.status === 'PAID' : o.status === filter)
  const csv = () => {
    const url = URL.createObjectURL(new Blob([ordersCsv(orders)], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a'); a.href = url; a.download = 'don-hang.csv'; a.click(); URL.revokeObjectURL(url)
  }
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2 text-center text-sm">
        <Card className="p-3"><p className="text-xs text-fg-subtle">Cần xử lý</p><p className="text-lg font-bold">{totals.pending + totals.paid}</p></Card>
        <Card className="p-3"><p className="text-xs text-fg-subtle">Chờ nhận tiền</p><p className="font-mono text-sm font-bold text-warning">{formatVnd(totals.awaiting_vnd)}</p></Card>
        <Card className="p-3"><p className="text-xs text-fg-subtle">Doanh thu</p><p className="font-mono text-sm font-bold text-brand">{formatVnd(totals.revenue_vnd)}</p></Card>
      </div>
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1"><SegmentedControl value={filter} onChange={setFilter} options={[
          { value: 'TODO', label: 'Cần xử lý' }, { value: 'SHIPPING', label: 'Đang giao' }, { value: 'DONE', label: 'Xong' }, { value: 'CANCELLED', label: 'Huỷ' }, { value: 'ALL', label: 'Tất cả' }]} /></div>
        <Button size="sm" variant="secondary" aria-label="Tải danh sách đơn (Excel)" disabled={!orders.length} onClick={csv}><Download className="size-4" aria-hidden /></Button>
      </div>
      {rows.length === 0 ? <p className="py-8 text-center text-sm text-fg-subtle">Không có đơn</p> : rows.map((o) => (
        <Card key={o.id} className="space-y-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm font-bold">{o.code}</span>
            <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold', ORDER_STATUS[o.status].tone)}>{ORDER_STATUS[o.status].label}</span>
            <span className="ml-auto text-xs text-fg-subtle">{fmtDate(o.created_at)}</span>
          </div>
          <OrderLines o={o} />
          <div className="space-y-1 rounded-xl bg-surface-2 p-2.5 text-sm">
            <p className="font-semibold">{o.buyer_name}</p>
            <a href={`tel:${o.buyer_phone}`} className="inline-flex items-center gap-1.5 text-brand"><Phone className="size-3.5" aria-hidden />{o.buyer_phone}</a>
            <p className="text-fg-muted">{o.ship_address}</p>
            {o.note && <p className="text-xs text-fg-muted">Ghi chú: “{o.note}”</p>}
          </div>
          <p className="flex justify-between text-sm"><span className="text-fg-muted">{PAY_LABEL[o.payment_method]} · phí giao {o.ship_fee_vnd ? formatVnd(o.ship_fee_vnd) : '0đ'}</span><b className="text-coin">{formatVnd(o.amount_vnd)}</b></p>
          {o.tracking_code && <p className="text-xs">Mã vận đơn: <b className="font-mono">{o.tracking_code}</b></p>}
          <div className="flex flex-wrap gap-1.5">
            {o.status === 'PENDING' && o.payment_method === 'BANK' && <Button size="sm" loading={set.isPending && set.variables?.id === o.id} onClick={() => set.mutate({ id: o.id, status: 'PAID' })}>Đã nhận tiền</Button>}
            {((o.status === 'PENDING' && o.payment_method === 'COD') || o.status === 'PAID') && <Button size="sm" onClick={() => setShip(o)}>Giao hàng</Button>}
            {(o.status === 'SHIPPING' || o.status === 'PAID') && <Button size="sm" variant={o.status === 'SHIPPING' ? 'primary' : 'secondary'} onClick={() => set.mutate({ id: o.id, status: 'DONE' })}>Hoàn tất</Button>}
            {o.status !== 'DONE' && o.status !== 'CANCELLED' && (
              <Button size="sm" variant="ghost" onClick={() => { if (window.confirm(`Huỷ đơn ${o.code}? Số lượng sẽ được trả lại kho.`)) set.mutate({ id: o.id, status: 'CANCELLED', note: 'Cửa hàng huỷ đơn' }) }}>Huỷ</Button>
            )}
          </div>
        </Card>
      ))}
      {ship && <ShipSheet order={ship} onClose={() => setShip(null)} onConfirm={(tracking) => { set.mutate({ id: ship.id, status: 'SHIPPING', tracking }); setShip(null) }} />}
    </div>
  )
}

function ShipSheet({ order, onClose, onConfirm }: { order: ShopOrder; onClose: () => void; onConfirm: (tracking: string | null) => void }) {
  const [t, setT] = useState('')
  return (
    <Sheet open onClose={onClose} title={`Giao đơn ${order.code}`} description={`${order.buyer_name} · ${order.buyer_phone}`}
      footer={<Button block onClick={() => onConfirm(t.trim() || null)}>Xác nhận đã giao cho vận chuyển</Button>}>
      <Field label="Mã vận đơn (không bắt buộc)" htmlFor="sh-track" hint="Khách sẽ thấy mã này trong “Đơn của tôi” và được báo.">
        <Input id="sh-track" value={t} maxLength={60} onChange={(e) => setT(e.target.value)} placeholder="GHN123456" />
      </Field>
    </Sheet>
  )
}

/* ------------------------------ Cài đặt ------------------------------ */
function SettingsTab({ partnerId, s }: { partnerId: string; s: ShopSettings }) {
  const qc = useQueryClient()
  const [fee, setFee] = useState(String(s.ship_fee_vnd || ''))
  const [free, setFree] = useState(s.free_ship_over_vnd != null ? String(s.free_ship_over_vnd) : '')
  const [cod, setCod] = useState(s.cod_enabled)
  const [policy, setPolicy] = useState(s.shop_policy ?? '')
  const [bin, setBin] = useState(s.bank?.bin ?? '')
  const [acc, setAcc] = useState(s.bank?.account_no ?? '')
  const [name, setName] = useState(s.bank?.account_name ?? '')
  const save = useMutation({
    mutationFn: () => saveShopSettings(partnerId, {
      ship_fee_vnd: toInt(fee) ?? 0, free_ship_over_vnd: toInt(free), cod_enabled: cod, shop_policy: policy.trim() || null,
      bank: bin && acc.trim() ? { bin, account_no: acc.trim(), account_name: name.trim() } : null,
    }),
    onSuccess: () => { toast.success('Đã lưu cài đặt cửa hàng'); void qc.invalidateQueries({ queryKey: ['market'] }) },
    onError: (e) => toast.error(shopErrorMessage(e)),
  })
  const bankPartial = (!!bin || !!acc.trim()) && !(bin && acc.trim() && name.trim().length >= 2)
  return (
    <div className="space-y-4">
      <Card className="space-y-3">
        <h2 className="font-semibold">Nhận chuyển khoản</h2>
        <p className="text-xs text-fg-muted">Khách quét VietQR, tiền vào thẳng tài khoản của bạn (RaceHub không giữ tiền). Nội dung chuyển khoản là mã đơn để bạn đối soát. Để trống nếu chỉ bán COD.</p>
        <Field label="Ngân hàng" htmlFor="st-bank">
          <select id="st-bank" value={bin} onChange={(e) => setBin(e.target.value)} className="h-11 w-full rounded-xl border border-border bg-bg px-3 text-sm">
            <option value="">— Chưa chọn —</option>
            {BANKS.map((b) => <option key={b.bin} value={b.bin}>{b.name}</option>)}
          </select>
        </Field>
        <Field label="Số tài khoản" htmlFor="st-acc"><Input id="st-acc" inputMode="numeric" value={acc} maxLength={20} onChange={(e) => setAcc(e.target.value.replace(/[^0-9A-Za-z]/g, ''))} /></Field>
        <Field label="Tên chủ tài khoản" htmlFor="st-name" hint="Viết hoa không dấu, đúng như ngân hàng."><Input id="st-name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} /></Field>
        <SwitchRow checked={cod} onChange={setCod} label="Nhận COD" description="Khách trả tiền mặt khi nhận hàng." />
      </Card>
      <Card className="space-y-3">
        <h2 className="font-semibold">Giao hàng & chính sách</h2>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Phí giao hàng (đ)" htmlFor="st-fee" hint="0 = miễn phí"><Input id="st-fee" inputMode="numeric" value={fee ? Number(digits(fee)).toLocaleString('vi-VN') : ''} onChange={(e) => setFee(digits(e.target.value))} /></Field>
          <Field label="Miễn phí giao từ (đ)" htmlFor="st-free" hint="Để trống = không áp dụng"><Input id="st-free" inputMode="numeric" value={free ? Number(digits(free)).toLocaleString('vi-VN') : ''} onChange={(e) => setFree(digits(e.target.value))} /></Field>
        </div>
        <Field label="Chính sách cửa hàng" htmlFor="st-pol" hint="Đổi trả, bảo hành, thời gian giao — hiện ở trang sản phẩm và giỏ hàng.">
          <Textarea id="st-pol" rows={4} value={policy} maxLength={1000} onChange={(e) => setPolicy(e.target.value)} />
        </Field>
      </Card>
      <Button block loading={save.isPending} disabled={bankPartial} onClick={() => save.mutate()}>Lưu cài đặt</Button>
      {bankPartial && <p className="text-center text-xs text-danger">Chọn ngân hàng và điền đủ số tài khoản + tên chủ tài khoản (hoặc để trống cả ba).</p>}
    </div>
  )
}
