'use client'

import { useState } from 'react'
import { Check, Clock, Copy, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button, Sheet } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { formatVnd } from '@/shared/lib/economy'
import { formatCoin } from '@/shared/lib/format'
import { vietQrUrl } from '@/shared/lib/vietqr'
import { billingErrorMessage, MONTH_LABEL, type Order } from '../api/billingApi'
import { useCancelOrder } from '../hooks/useBilling'

export const orderTitle = (o: Order) =>
  o.kind === 'XU' ? `Nạp ${formatCoin(o.xu)} Xu${o.bonus_xu ? ` + ${formatCoin(o.bonus_xu)} tặng` : ''}`
    : `${o.plan_name ?? o.plan_code} · ${MONTH_LABEL[o.months ?? 1] ?? `${o.months} tháng`}${o.owner_type === 'CLUB' && o.owner_name ? ` · ${o.owner_name}` : ''}`

export const STATUS_META = {
  PENDING: { label: 'Chờ thanh toán', tone: 'bg-warning/15 text-warning', icon: Clock },
  PAID: { label: 'Đã kích hoạt', tone: 'bg-brand/15 text-brand', icon: Check },
  CANCELLED: { label: 'Đã hủy', tone: 'bg-surface-2 text-fg-subtle', icon: X },
} as const

function CopyRow({ label, value }: { label: string; value: string }) {
  const copy = () => { void navigator.clipboard?.writeText(value).then(() => toast.success(`Đã chép ${label.toLowerCase()}`)) }
  return (
    <div className="flex items-center justify-between gap-2 text-sm">
      <span className="text-fg-muted">{label}</span>
      <button onClick={copy} className="flex min-w-0 items-center gap-1.5 font-mono font-semibold">
        <span className="truncate">{value}</span><Copy className="size-3.5 shrink-0 text-fg-subtle" aria-hidden />
      </button>
    </div>
  )
}

/** Hướng dẫn chuyển khoản cho một đơn: mã VietQR có sẵn số tiền + nội dung (mã đơn) để admin đối soát */
export function OrderSheet({ order, onClose }: { order: Order | null; onClose: () => void }) {
  const cancel = useCancelOrder()
  const [now] = useState(() => Date.now())
  if (!order) return null
  const pay = order.payment
  const ready = !!(pay?.bank_bin && pay.account_no && pay.account_name)
  const pending = order.status === 'PENDING' && Date.parse(order.expires_at) > now
  const s = STATUS_META[order.status]
  const doCancel = async () => {
    try { await cancel.mutateAsync(order.id); toast.success('Đã hủy đơn'); onClose() } catch (e) { toast.error(billingErrorMessage(e)) }
  }
  return (
    <Sheet open onClose={onClose} title={`Đơn ${order.code}`} description={orderTitle(order)}
      footer={pending ? (
        <div className="flex gap-2">
          <Button variant="ghost" className="shrink-0" onClick={doCancel} loading={cancel.isPending}>Hủy đơn</Button>
          <Button block onClick={onClose}>Tôi đã chuyển khoản</Button>
        </div>
      ) : <Button block variant="secondary" onClick={onClose}>Đóng</Button>}>
      <div className="space-y-4">
        <p className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold', s.tone)}>
          <s.icon className="size-3.5" aria-hidden />{s.label}
        </p>
        {pending && (ready ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element -- ảnh QR động từ img.vietqr.io */}
            <img src={vietQrUrl({ bin: pay.bank_bin!, account_no: pay.account_no!, account_name: pay.account_name! }, order.amount_vnd, order.code)}
              alt={`Mã VietQR chuyển ${formatVnd(order.amount_vnd)} cho đơn ${order.code}`} className="mx-auto w-full max-w-64 rounded-xl bg-white p-2" />
            <div className="space-y-2 rounded-xl border border-border p-3">
              <CopyRow label="Số tiền" value={String(order.amount_vnd)} />
              <CopyRow label="Nội dung" value={order.code} />
              <CopyRow label="Số tài khoản" value={pay.account_no!} />
              <p className="text-right text-xs text-fg-subtle">{pay.account_name}</p>
            </div>
            <p className="text-xs text-fg-muted">
              Giữ đúng nội dung <b className="font-mono">{order.code}</b> để được kích hoạt nhanh. RaceHub xác nhận trong giờ làm việc
              và gửi thông báo cho bạn. Đơn tự hết hạn lúc {new Date(order.expires_at).toLocaleString('vi-VN')}.
            </p>
          </>
        ) : (
          <p className="rounded-xl bg-surface-2 p-3 text-sm text-fg-muted">
            RaceHub đang cập nhật tài khoản nhận tiền. Đơn đã được ghi nhận — vui lòng quay lại sau hoặc liên hệ đội ngũ hỗ trợ với mã <b className="font-mono">{order.code}</b>.
          </p>
        ))}
        <p className="flex items-center justify-between text-sm"><span className="text-fg-muted">Tổng tiền</span><span className="font-mono text-lg font-bold">{formatVnd(order.amount_vnd)}</span></p>
        {order.note && <p className="text-xs text-fg-subtle">Ghi chú: {order.note}</p>}
      </div>
    </Sheet>
  )
}
