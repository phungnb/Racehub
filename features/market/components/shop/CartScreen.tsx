'use client'

import Link from 'next/link'
import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Banknote, ChevronLeft, Minus, Plus, QrCode, ShoppingBag, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button, Card, EmptyState, ErrorState, Field, Input, Skeleton, Textarea } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { routes } from '@/shared/config/routes'
import { formatVnd } from '@/features/club'
import { sameLine, useCart } from '../../model/cart'
import { getShop, placeOrder, shopErrorMessage, type Buyer, type PayMethod, type Product, type ShopOrder } from '../../api/shopApi'
import { PaySheet, Thumb } from './ShopBits'

const BUYER_KEY = 'racehub.buyer'
const load = (): Buyer => { try { return { name: '', phone: '', address: '', ...JSON.parse(localStorage.getItem(BUYER_KEY) ?? '{}') } } catch { return { name: '', phone: '', address: '' } } }

interface Row { product: Product; variantId: string | null; variantName: string | null; unit: number; qty: number; stock: number | null; ok: boolean }

/** Giỏ hàng + thanh toán của một cửa hàng: địa chỉ nhận, chọn chuyển khoản / COD, server tính lại tiền & tồn kho */
export function CartScreen({ partnerId }: { partnerId: string }) {
  const q = useQuery({ queryKey: ['market', 'shop', partnerId], queryFn: () => getShop(partnerId) })
  const cart = useCart(partnerId)
  // khung đặt hàng chỉ vẽ sau khi tải xong dữ liệu (phía client) nên đọc localStorage ngay lúc khởi tạo là an toàn
  const [buyer, setBuyer] = useState<Buyer>(load)
  const [note, setNote] = useState('')
  const [method, setMethod] = useState<PayMethod | null>(null)
  const [done, setDone] = useState<ShopOrder | null>(null)
  const [payOpen, setPayOpen] = useState(false)
  const place = useMutation({
    mutationFn: (rows: Row[]) => placeOrder(partnerId, rows.map((r) => ({ product_id: r.product.id, variant_id: r.variantId, qty: r.qty })), buyer, method as PayMethod, note.trim() || null),
    onSuccess: (o) => {
      try { localStorage.setItem(BUYER_KEY, JSON.stringify(buyer)) } catch { /* bỏ qua */ }
      cart.clear(); setDone(o); setPayOpen(o.payment_method === 'BANK'); void q.refetch()
    },
    onError: (e) => { toast.error(shopErrorMessage(e)); void q.refetch() },
  })
  const back = <Link href={routes.partner(partnerId)} className="inline-flex items-center gap-1 text-sm text-fg-muted"><ChevronLeft className="size-4" aria-hidden />Cửa hàng</Link>
  if (q.isPending) return <div className="space-y-4">{back}<Skeleton className="h-40" /><Skeleton className="h-48" /></div>
  if (q.isError) return <div className="space-y-4">{back}<ErrorState message={shopErrorMessage(q.error)} error={q.error} onRetry={() => void q.refetch()} /></div>
  const { settings, partner } = q.data

  if (done) {
    return (
      <div className="space-y-4 animate-fade-in">
        <Card className="space-y-3 text-center">
          <p className="text-lg font-bold">Đã đặt hàng thành công</p>
          <p className="text-sm text-fg-muted">Mã đơn <b className="font-mono">{done.code}</b> · {formatVnd(done.amount_vnd)}</p>
          {done.payment_method === 'BANK'
            ? <p className="text-sm">Hãy chuyển khoản để cửa hàng xác nhận và giao hàng.</p>
            : <p className="text-sm">Cửa hàng sẽ liên hệ xác nhận. Bạn thanh toán khi nhận hàng.</p>}
        </Card>
        {done.payment_method === 'BANK' && <Button block onClick={() => setPayOpen(true)}><QrCode className="size-4" aria-hidden />Xem mã chuyển khoản</Button>}
        {payOpen && <PaySheet order={done} onClose={() => setPayOpen(false)} />}
        <OrderLinks />
      </div>
    )
  }

  const rows: Row[] = cart.items.map((it) => {
    const product = q.data.products.find((x) => x.id === it.product_id && x.status === 'ACTIVE')
    if (!product) return null
    const v = it.variant_id ? product.variants.find((x) => x.id === it.variant_id) : null
    const stock = v ? v.stock : product.stock
    const ok = (product.variants.length === 0 || !!v) && (stock === null || stock >= it.qty) && product.in_stock
    return { product, variantId: v?.id ?? null, variantName: v?.name ?? null, unit: v?.price_vnd ?? product.price_vnd, qty: it.qty, stock, ok }
  }).filter((r): r is Row => r !== null)
  const missing = cart.items.length - rows.length
  const sub = rows.reduce((s, r) => s + r.unit * r.qty, 0)
  const ship = settings.free_ship_over_vnd !== null && sub >= settings.free_ship_over_vnd ? 0 : settings.ship_fee_vnd
  const methods: PayMethod[] = [...(settings.bank_ready ? ['BANK' as const] : []), ...(settings.cod_enabled ? ['COD' as const] : [])]
  const pay = method ?? methods[0] ?? null
  const phoneOk = /^(0|\+84)\d{9,10}$/.test(buyer.phone.replace(/[ .-]/g, ''))
  const valid = rows.length > 0 && rows.every((r) => r.ok) && buyer.name.trim().length >= 2 && phoneOk && buyer.address.trim().length >= 8 && !!pay
  return (
    <div className="space-y-4 animate-fade-in">
      {back}
      <header><h1 className="text-xl font-bold">Giỏ hàng · {partner.name}</h1></header>
      {partner.is_mine ? <Card className="text-sm text-fg-muted">Bạn không thể đặt hàng của chính cửa hàng mình.</Card>
        : rows.length === 0 ? (
          <EmptyState icon={ShoppingBag} title="Giỏ hàng trống" description={missing ? 'Sản phẩm trong giỏ đã ngừng bán.' : 'Chọn sản phẩm của cửa hàng để bắt đầu.'}
            action={<Link href={routes.partner(partnerId)}><Button>Xem sản phẩm</Button></Link>} />
        ) : (
          <>
            <Card className="space-y-3">
              {rows.map((r) => {
                const line = { product_id: r.product.id, variant_id: r.variantId, qty: r.qty }
                return (
                  <div key={`${r.product.id}-${r.variantId}`} className="flex gap-3">
                    <Thumb src={r.product.images[0]} alt={r.product.title} className="size-16 rounded-xl" />
                    <div className="min-w-0 flex-1 space-y-1">
                      <Link href={routes.partnerProduct(r.product.id)} className="line-clamp-2 text-sm font-medium">{r.product.title}</Link>
                      {r.variantName && <p className="text-xs text-fg-muted">{r.variantName}</p>}
                      <p className="text-sm font-bold text-coin">{formatVnd(r.unit)}</p>
                      {!r.ok && <p className="text-xs font-semibold text-danger">{r.stock !== null && r.stock > 0 ? `Chỉ còn ${r.stock} — giảm số lượng` : 'Hết hàng — hãy xoá khỏi giỏ'}</p>}
                      <div className="flex items-center gap-1">
                        <Button size="sm" variant="secondary" aria-label="Giảm" disabled={r.qty <= 1} onClick={() => cart.setQty(line, r.qty - 1)}><Minus className="size-4" aria-hidden /></Button>
                        <span className="w-8 text-center font-mono text-sm">{r.qty}</span>
                        <Button size="sm" variant="secondary" aria-label="Tăng" disabled={r.qty >= Math.min(20, r.stock ?? 20)} onClick={() => cart.setQty(line, r.qty + 1)}><Plus className="size-4" aria-hidden /></Button>
                        <Button size="sm" variant="ghost" aria-label="Xoá khỏi giỏ" className="ml-auto" onClick={() => cart.remove(cart.items.find((x) => sameLine(x, line)) ?? line)}><Trash2 className="size-4" aria-hidden /></Button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </Card>

            <Card className="space-y-3">
              <h2 className="font-semibold">Thông tin nhận hàng</h2>
              <Field label="Họ tên người nhận" htmlFor="co-name"><Input id="co-name" autoComplete="name" value={buyer.name} maxLength={60} onChange={(e) => setBuyer({ ...buyer, name: e.target.value })} /></Field>
              <Field label="Số điện thoại" htmlFor="co-phone" error={buyer.phone && !phoneOk ? 'Số điện thoại 10 số, bắt đầu bằng 0' : undefined}>
                <Input id="co-phone" inputMode="tel" autoComplete="tel" value={buyer.phone} onChange={(e) => setBuyer({ ...buyer, phone: e.target.value })} placeholder="0912 345 678" />
              </Field>
              <Field label="Địa chỉ" htmlFor="co-addr" hint="Số nhà, đường, phường / xã, quận / huyện, tỉnh / thành.">
                <Textarea id="co-addr" rows={2} autoComplete="street-address" value={buyer.address} maxLength={250} onChange={(e) => setBuyer({ ...buyer, address: e.target.value })} />
              </Field>
              <Field label="Ghi chú cho cửa hàng (không bắt buộc)" htmlFor="co-note"><Input id="co-note" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder="Giao giờ hành chính…" /></Field>
            </Card>

            <Card className="space-y-2">
              <h2 className="font-semibold">Thanh toán</h2>
              {methods.length === 0 ? <p className="text-sm text-danger">Cửa hàng chưa thiết lập cách thanh toán. Vui lòng liên hệ cửa hàng.</p> : methods.map((m) => (
                <button key={m} type="button" aria-pressed={pay === m} onClick={() => setMethod(m)}
                  className={cn('flex w-full items-center gap-3 rounded-xl border p-3 text-left', pay === m ? 'border-brand bg-brand/10' : 'border-border')}>
                  {m === 'BANK' ? <QrCode className="size-5 text-brand" aria-hidden /> : <Banknote className="size-5 text-brand" aria-hidden />}
                  <span className="text-sm"><b>{m === 'BANK' ? 'Chuyển khoản (VietQR)' : 'Thanh toán khi nhận hàng (COD)'}</b>
                    <span className="block text-xs text-fg-muted">{m === 'BANK' ? 'Quét mã, tiền vào thẳng tài khoản cửa hàng; cửa hàng xác nhận rồi giao.' : 'Trả tiền mặt cho người giao hàng.'}</span></span>
                </button>
              ))}
              {settings.shop_policy && <p className="whitespace-pre-line text-xs text-fg-muted">{settings.shop_policy}</p>}
            </Card>

            <Card className="space-y-1.5 text-sm">
              <p className="flex justify-between"><span className="text-fg-muted">Tạm tính</span><span>{formatVnd(sub)}</span></p>
              <p className="flex justify-between"><span className="text-fg-muted">Phí giao hàng</span><span>{ship ? formatVnd(ship) : 'Miễn phí'}</span></p>
              {settings.free_ship_over_vnd !== null && ship > 0 && <p className="text-xs text-fg-subtle">Mua thêm {formatVnd(settings.free_ship_over_vnd - sub)} để được miễn phí giao hàng.</p>}
              <p className="flex justify-between border-t border-border pt-2 text-base font-bold"><span>Tổng cộng</span><span className="text-coin">{formatVnd(sub + ship)}</span></p>
            </Card>
            <Button block size="lg" loading={place.isPending} disabled={!valid} onClick={() => place.mutate(rows)}>Đặt hàng · {formatVnd(sub + ship)}</Button>
            <p className="text-center text-xs text-fg-subtle">RaceHub không thu tiền hộ. Giá và tồn kho được kiểm tra lại khi đặt.</p>
          </>
        )}
    </div>
  )
}

function OrderLinks() {
  return (
    <div className="grid grid-cols-2 gap-2">
      <Link href={routes.marketOrders}><Button block variant="secondary">Đơn của tôi</Button></Link>
      <Link href={routes.market}><Button block variant="ghost">Về Chợ Runner</Button></Link>
    </div>
  )
}

