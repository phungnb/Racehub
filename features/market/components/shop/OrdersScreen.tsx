'use client'

import Link from 'next/link'
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { PackageOpen, QrCode, Truck } from 'lucide-react'
import { toast } from 'sonner'
import { BackLink, Button, Card, EmptyState, ErrorState, Skeleton } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { routes } from '@/shared/config/routes'
import { formatVnd } from '@/features/club'
import { cancelMyOrder, myOrders, ORDER_STATUS, PAY_LABEL, shopErrorMessage, type ShopOrder } from '../../api/shopApi'
import { OrderLines, PaySheet } from './ShopBits'

const fmt = (d: string) => new Date(d).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })

/** Đơn của tôi: theo dõi trạng thái, xem lại mã chuyển khoản, huỷ đơn chưa xử lý */
export function OrdersScreen() {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['market', 'orders'], queryFn: myOrders })
  const [pay, setPay] = useState<ShopOrder | null>(null)
  const cancel = useMutation({
    mutationFn: (id: string) => cancelMyOrder(id),
    onSuccess: () => { toast.success('Đã huỷ đơn'); void qc.invalidateQueries({ queryKey: ['market'] }) },
    onError: (e) => toast.error(shopErrorMessage(e)),
  })
  return (
    <div className="space-y-4 animate-fade-in">
      <BackLink fallback={routes.market} className="-mb-2" />
      <header><h1 className="text-2xl font-bold">Đơn mua của tôi</h1><p className="text-sm text-fg-muted">Đơn hàng bạn đã đặt ở các cửa hàng trên Chợ Runner.</p></header>
      {q.isPending ? <div className="space-y-2">{[0, 1].map((i) => <Skeleton key={i} className="h-40" />)}</div>
        : q.isError ? <ErrorState message={shopErrorMessage(q.error)} error={q.error} onRetry={() => void q.refetch()} />
        : !q.data.length ? <EmptyState icon={PackageOpen} title="Bạn chưa có đơn nào" description="Chọn sản phẩm ở cửa hàng đối tác để đặt hàng." action={<Link href={routes.market}><Button>Đến Chợ Runner</Button></Link>} />
        : q.data.map((o) => (
          <Card key={o.id} className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Link href={routes.partner(o.partner_id)} className="min-w-0 flex-1 truncate font-semibold">{o.shop_name}</Link>
              <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold', ORDER_STATUS[o.status].tone)}>{ORDER_STATUS[o.status].label}</span>
            </div>
            <OrderLines o={o} />
            <div className="space-y-1 border-t border-border pt-2 text-sm">
              <p className="flex justify-between text-fg-muted"><span>Mã đơn <b className="font-mono text-fg">{o.code}</b></span><span>{fmt(o.created_at)}</span></p>
              <p className="flex justify-between"><span className="text-fg-muted">{PAY_LABEL[o.payment_method]}</span><b className="text-coin">{formatVnd(o.amount_vnd)}</b></p>
              <p className="text-xs text-fg-subtle">Giao tới: {o.buyer_name} · {o.buyer_phone} · {o.ship_address}</p>
              {o.tracking_code && <p className="flex items-center gap-1.5 text-xs"><Truck className="size-3.5" aria-hidden />Mã vận đơn: <b className="font-mono">{o.tracking_code}</b></p>}
              {o.status_note && <p className="text-xs text-fg-muted">Ghi chú từ cửa hàng: {o.status_note}</p>}
            </div>
            {o.status === 'PENDING' && (
              <div className="flex flex-wrap gap-2">
                {o.payment_method === 'BANK' && <Button size="sm" onClick={() => setPay(o)}><QrCode className="size-4" aria-hidden />Chuyển khoản</Button>}
                <Button size="sm" variant="ghost" loading={cancel.isPending && cancel.variables === o.id}
                  onClick={() => { if (window.confirm('Huỷ đơn này? Số lượng sẽ được trả lại kho.')) cancel.mutate(o.id) }}>Huỷ đơn</Button>
              </div>
            )}
          </Card>
        ))}
      {pay && <PaySheet order={pay} onClose={() => setPay(null)} />}
    </div>
  )
}
