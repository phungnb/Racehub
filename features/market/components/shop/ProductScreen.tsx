'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronLeft, Minus, Pencil, Plus, ShoppingCart, Store, Truck } from 'lucide-react'
import { toast } from 'sonner'
import { Button, Card, ErrorState, Skeleton } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { routes } from '@/shared/config/routes'
import { formatVnd } from '@/features/club'
import { addToCart } from '../../model/cart'
import { getShopProduct, shopErrorMessage } from '../../api/shopApi'
import { VerifiedBadge } from '../PartnerBits'
import { CartButton, Price, StockNote, Thumb } from './ShopBits'

/** Trang sản phẩm: ảnh, giá, chọn phân loại + số lượng, thêm giỏ / mua ngay */
export function ProductScreen({ id }: { id: string }) {
  const router = useRouter()
  const q = useQuery({ queryKey: ['market', 'product', id], queryFn: () => getShopProduct(id) })
  const [img, setImg] = useState(0)
  const [variantId, setVariantId] = useState<string | null>(null)
  const [qty, setQty] = useState(1)
  const back = (href: string, label: string) => <Link href={href} className="inline-flex items-center gap-1 text-sm text-fg-muted"><ChevronLeft className="size-4" aria-hidden />{label}</Link>
  if (q.isPending) return <div className="space-y-4">{back(routes.market, 'Chợ Runner')}<Skeleton className="aspect-square" /><Skeleton className="h-32" /></div>
  if (q.isError) return <div className="space-y-4">{back(routes.market, 'Chợ Runner')}<ErrorState message={shopErrorMessage(q.error)} error={q.error} onRetry={() => void q.refetch()} /></div>
  const { product: p, partner, settings } = q.data
  const variant = p.variants.find((v) => v.id === variantId) ?? null
  const needVariant = p.variants.length > 0 && !variant
  const stock = p.variants.length ? variant?.stock ?? null : p.stock
  const soldOut = !p.in_stock || (!needVariant && stock !== null && stock <= 0)
  const max = Math.min(20, stock ?? 20)
  const add = (go: boolean) => {
    if (needVariant) { toast.error('Hãy chọn phân loại trước'); return }
    addToCart(partner.id, { product_id: p.id, variant_id: variant?.id ?? null, qty })
    if (go) router.push(routes.partnerCart(partner.id))
    else toast.success('Đã thêm vào giỏ')
  }
  const free = settings.free_ship_over_vnd
  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between gap-2">
        {back(routes.partner(partner.id), partner.name)}
        <CartButton partnerId={partner.id} />
      </div>
      {partner.is_mine && (
        <Card className="flex items-center justify-between gap-3 border-brand/40 p-3 text-sm">
          <span>{p.status === 'HIDDEN' ? 'Sản phẩm đang ẩn — khách không thấy.' : 'Đây là sản phẩm của bạn.'}</span>
          <Link href={routes.partnerShopManage(partner.id)}><Button size="sm" variant="secondary"><Pencil className="size-4" aria-hidden />Quản lý</Button></Link>
        </Card>
      )}
      <Card className="overflow-hidden p-0">
        <Thumb src={p.images[img]} alt={p.title} className="aspect-square w-full sm:aspect-video" />
        {p.images.length > 1 && (
          <div className="flex gap-2 overflow-x-auto p-2">
            {p.images.map((u, i) => (
              <button key={u} type="button" onClick={() => setImg(i)} aria-label={`Ảnh ${i + 1}`} className={cn('shrink-0 rounded-lg border-2', i === img ? 'border-brand' : 'border-transparent')}>
                <Thumb src={u} alt="" className="size-14 rounded-md" />
              </button>
            ))}
          </div>
        )}
      </Card>

      <Card className="space-y-3">
        <div className="space-y-1">
          <h1 className="text-xl font-bold">{p.title}</h1>
          <Price p={variant ? { ...p, price_min: variant.price_vnd, price_max: variant.price_vnd } : p} className="text-lg" />
          <p className="flex items-center gap-3 text-xs text-fg-subtle">
            {p.category && <span>{p.category}</span>}{p.sold > 0 && <span>Đã bán {p.sold}</span>}{p.sku && <span>SKU {p.sku}</span>}<StockNote p={p} />
          </p>
        </div>
        {p.variants.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm font-semibold">Phân loại</p>
            <div className="flex flex-wrap gap-2">
              {p.variants.map((v) => {
                const out = v.stock !== null && v.stock <= 0
                return (
                  <button key={v.id} type="button" disabled={out} aria-pressed={v.id === variantId}
                    onClick={() => { setVariantId(v.id); setQty((x) => Math.min(x, Math.min(20, v.stock ?? 20)) || 1) }}
                    className={cn('rounded-xl border px-3 py-2 text-sm', v.id === variantId ? 'border-brand bg-brand/10 font-semibold' : 'border-border', out && 'cursor-not-allowed opacity-40 line-through')}>
                    {v.name}{v.price_vnd !== p.price_vnd && <span className="ml-1.5 text-xs text-fg-muted">{formatVnd(v.price_vnd)}</span>}
                  </button>
                )
              })}
            </div>
          </div>
        )}
        <div className="flex items-center gap-3">
          <p className="text-sm font-semibold">Số lượng</p>
          <div className="inline-flex items-center rounded-xl border border-border">
            <Button size="sm" variant="ghost" aria-label="Giảm" disabled={qty <= 1} onClick={() => setQty(qty - 1)}><Minus className="size-4" aria-hidden /></Button>
            <span className="w-8 text-center font-mono text-sm" aria-live="polite">{qty}</span>
            <Button size="sm" variant="ghost" aria-label="Tăng" disabled={qty >= max} onClick={() => setQty(qty + 1)}><Plus className="size-4" aria-hidden /></Button>
          </div>
          {stock !== null && !needVariant && <span className="text-xs text-fg-subtle">Còn {stock}</span>}
        </div>
        {!partner.is_mine && (
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" disabled={soldOut} onClick={() => add(false)}><ShoppingCart className="size-4" aria-hidden />Thêm vào giỏ</Button>
            <Button disabled={soldOut} onClick={() => add(true)}>{soldOut ? 'Hết hàng' : 'Mua ngay'}</Button>
          </div>
        )}
        <p className="flex items-start gap-2 text-xs text-fg-muted">
          <Truck className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>Phí giao {settings.ship_fee_vnd ? formatVnd(settings.ship_fee_vnd) : 'miễn phí'}{free !== null && settings.ship_fee_vnd > 0 ? `, miễn phí từ ${formatVnd(free)}` : ''}.
            {' '}Thanh toán {[settings.bank_ready && 'chuyển khoản (VietQR)', settings.cod_enabled && 'khi nhận hàng (COD)'].filter(Boolean).join(' hoặc ') || 'liên hệ cửa hàng'}.</span>
        </p>
      </Card>

      {p.description && <Card className="space-y-2"><h2 className="font-semibold">Mô tả sản phẩm</h2><p className="whitespace-pre-line text-sm leading-relaxed text-fg-muted">{p.description}</p></Card>}
      {settings.shop_policy && <Card className="space-y-2"><h2 className="font-semibold">Chính sách cửa hàng</h2><p className="whitespace-pre-line text-sm text-fg-muted">{settings.shop_policy}</p></Card>}

      <Link href={routes.partner(partner.id)} className="block">
        <Card className="flex items-center gap-3 p-3 hover:border-fg-subtle">
          <Thumb src={partner.avatar_url} alt={partner.name} className="size-12 rounded-xl" />
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2"><b className="truncate">{partner.name}</b>{partner.verified && <VerifiedBadge />}</span>
            <span className="text-xs text-fg-muted">{partner.area ?? 'Xem cửa hàng'}</span>
          </span>
          <Store className="size-5 text-fg-subtle" aria-hidden />
        </Card>
      </Link>
      <p className="text-center text-xs text-fg-subtle">RaceHub không thu tiền hộ — bạn thanh toán trực tiếp cho cửa hàng.</p>
    </div>
  )
}
