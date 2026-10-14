'use client'

import Link from 'next/link'
import { Copy, ImageOff, ShoppingCart } from 'lucide-react'
import { toast } from 'sonner'
import { Button, Sheet } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { routes } from '@/shared/config/routes'
import { vietQrUrl } from '@/shared/lib/vietqr'
import { bankName, formatVnd } from '@/features/club'
import { useCart } from '../../model/cart'
import { priceRange, productStock, type Product, type ShopOrder } from '../../api/shopApi'

export function Thumb({ src, alt, className }: { src: string | null | undefined; alt: string; className?: string }) {
  return (
    <span className={cn('grid shrink-0 place-items-center overflow-hidden bg-surface-2 text-fg-subtle', className)}>
      {/* eslint-disable-next-line @next/next/no-img-element -- ảnh sản phẩm trong kho market-media */}
      {src ? <img src={src} alt={alt} loading="lazy" className="size-full object-cover" /> : <ImageOff className="size-6" aria-hidden />}
    </span>
  )
}

export function Price({ p, className }: { p: Product; className?: string }) {
  const discount = p.compare_price_vnd && p.compare_price_vnd > p.price_min ? Math.round((1 - p.price_min / p.compare_price_vnd) * 100) : 0
  return (
    <span className={cn('inline-flex flex-wrap items-baseline gap-x-2', className)}>
      <span className="font-bold text-coin">{priceRange(p, formatVnd)}</span>
      {p.compare_price_vnd && p.compare_price_vnd > p.price_min && <span className="text-xs text-fg-subtle line-through">{formatVnd(p.compare_price_vnd)}</span>}
      {discount > 0 && <span className="rounded bg-danger/15 px-1.5 text-[11px] font-bold text-danger">-{discount}%</span>}
    </span>
  )
}

export function StockNote({ p }: { p: Product }) {
  const left = productStock(p)
  if (!p.in_stock) return <span className="text-xs font-semibold text-danger">Hết hàng</span>
  if (left !== null && left <= 5) return <span className="text-xs font-semibold text-warning">Chỉ còn {left}</span>
  return null
}

export function ProductCard({ p }: { p: Product }) {
  return (
    <Link href={routes.partnerProduct(p.id)} className="block overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface transition-colors hover:border-fg-subtle">
      <div className="relative">
        <Thumb src={p.images[0]} alt={p.title} className="aspect-square w-full" />
        {!p.in_stock && <span className="absolute inset-0 grid place-items-center bg-bg/60 text-sm font-bold">Hết hàng</span>}
        {p.status === 'HIDDEN' && <span className="absolute left-2 top-2 rounded-full bg-bg/80 px-2 py-0.5 text-[11px] font-bold">Đang ẩn</span>}
      </div>
      <div className="space-y-1 p-2.5">
        <p className="line-clamp-2 min-h-[2.5rem] text-sm font-medium">{p.title}</p>
        <Price p={p} className="text-sm" />
        <p className="flex items-center justify-between text-[11px] text-fg-subtle">
          <span>{p.sold > 0 ? `Đã bán ${p.sold}` : p.category ?? ''}</span><StockNote p={p} />
        </p>
      </div>
    </Link>
  )
}

/** Nút giỏ hàng nổi / trên đầu trang: số món trong giỏ của cửa hàng */
export function CartButton({ partnerId, className }: { partnerId: string; className?: string }) {
  const { count } = useCart(partnerId)
  return (
    <Link href={routes.partnerCart(partnerId)} aria-label={`Giỏ hàng (${count} sản phẩm)`}
      className={cn('relative inline-flex h-10 items-center gap-1.5 rounded-xl border border-border bg-surface-2 px-3 text-sm font-semibold hover:border-fg-subtle', className)}>
      <ShoppingCart className="size-4" aria-hidden />Giỏ
      {count > 0 && <span className="grid min-w-5 place-items-center rounded-full bg-brand px-1 text-[11px] font-bold text-brand-fg">{count}</span>}
    </Link>
  )
}

export function OrderLines({ o }: { o: ShopOrder }) {
  return (
    <ul className="space-y-2">
      {o.items.map((i, k) => (
        <li key={k} className="flex items-center gap-2.5 text-sm">
          <Thumb src={i.image} alt={i.title} className="size-11 rounded-lg" />
          <span className="min-w-0 flex-1"><span className="line-clamp-1 font-medium">{i.title}</span>{i.variant && <span className="block text-xs text-fg-muted">{i.variant}</span>}</span>
          <span className="shrink-0 text-right text-xs text-fg-muted">{formatVnd(i.price_vnd)} × {i.qty}</span>
        </li>
      ))}
    </ul>
  )
}

/** Hướng dẫn chuyển khoản: VietQR có sẵn số tiền + nội dung = mã đơn. Tiền vào thẳng tài khoản đối tác. */
export function PaySheet({ order: o, onClose }: { order: ShopOrder; onClose: () => void }) {
  const copy = (v: string, what: string) => { void navigator.clipboard?.writeText(v).then(() => toast.success(`Đã sao chép ${what}`)) }
  const bank = o.bank
  return (
    <Sheet open onClose={onClose} title={`Chuyển khoản · ${formatVnd(o.amount_vnd)}`} description={`Đơn ${o.code} · ${o.shop_name}`}>
      {bank ? (
        <div className="space-y-3 text-center">
          {/* eslint-disable-next-line @next/next/no-img-element -- ảnh VietQR */}
          <img src={vietQrUrl(bank, o.amount_vnd, o.code)} alt={`Mã VietQR chuyển ${formatVnd(o.amount_vnd)} nội dung ${o.code}`} className="mx-auto w-64 rounded-xl bg-white p-2" />
          <div className="space-y-1.5 rounded-xl bg-surface-2 p-3 text-left text-sm">
            <p className="text-fg-muted">{bankName(bank.bin)}</p>
            <p className="flex items-center justify-between gap-2"><span className="font-mono font-bold">{bank.account_no}</span>
              <Button size="sm" variant="ghost" aria-label="Sao chép số tài khoản" onClick={() => copy(bank.account_no, 'số tài khoản')}><Copy className="size-4" aria-hidden /></Button></p>
            <p className="text-fg-muted">{bank.account_name}</p>
            <p className="flex items-center justify-between gap-2"><span>Số tiền: <b className="font-mono">{formatVnd(o.amount_vnd)}</b></span>
              <Button size="sm" variant="ghost" aria-label="Sao chép số tiền" onClick={() => copy(String(o.amount_vnd), 'số tiền')}><Copy className="size-4" aria-hidden /></Button></p>
            <p className="flex items-center justify-between gap-2"><span>Nội dung: <b className="font-mono">{o.code}</b></span>
              <Button size="sm" variant="ghost" aria-label="Sao chép nội dung" onClick={() => copy(o.code, 'nội dung')}><Copy className="size-4" aria-hidden /></Button></p>
          </div>
          <p className="text-xs text-fg-subtle">Giữ đúng nội dung <b>{o.code}</b> để cửa hàng đối soát. Cửa hàng xác nhận khi nhận tiền rồi mới giao. RaceHub không thu hay giữ khoản tiền này.</p>
        </div>
      ) : <p className="text-sm text-fg-muted">Đơn này không cần chuyển khoản trước.</p>}
    </Sheet>
  )
}
