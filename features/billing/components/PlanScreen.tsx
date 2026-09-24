'use client'

import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Check, ChevronRight, Coins, Crown, Receipt, Ticket } from 'lucide-react'
import { toast } from 'sonner'
import { Button, Card, ErrorState, SectionTitle, SegmentedControl, Skeleton } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { formatVnd } from '@/shared/lib/economy'
import { formatCoin, formatNumber } from '@/shared/lib/format'
import { routes } from '@/shared/config/routes'
import { billingErrorMessage, MONTH_LABEL, type Credit, type Order, type OrderInput, type Plan } from '../api/billingApi'
import { useCreateOrder, useMyPlan, usePricing } from '../hooks/useBilling'
import { OrderSheet, orderTitle, STATUS_META } from './OrderSheet'

type Tab = 'vip' | 'xu'
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('vi-VN')
const TIER_TONE = ['', 'from-sky-500/15', 'from-violet-500/20', 'from-coin/25']

export function CreditList({ credits, empty }: { credits: Credit[]; empty: string }) {
  if (!credits.length) return <p className="text-sm text-fg-muted">{empty}</p>
  return (
    <ul className="grid grid-cols-2 gap-2">
      {credits.map((c) => (
        <li key={c.id} className="rounded-xl border border-border bg-bg/60 p-2.5">
          <p className="flex items-center gap-1.5 text-sm font-semibold"><Ticket className="size-4 text-brand" aria-hidden />≤ {formatNumber(c.capacity)} người</p>
          <p className="text-xs text-fg-muted">còn {c.remaining}/{c.total} lượt{c.expires_at ? ` · hạn ${fmtDate(c.expires_at)}` : ''}</p>
        </li>
      ))}
    </ul>
  )
}

function PlanCard({ plan, months, current, onBuy, busy }: {
  plan: Plan; months: number; current: boolean; onBuy: () => void; busy: boolean
}) {
  const price = plan.prices.find((p) => p.months === months && p.active)
  const monthly = plan.prices.find((p) => p.months === 1 && p.active)
  const save = price && monthly && months > 1 ? Math.round((1 - price.price_vnd / (monthly.price_vnd * months)) * 100) : 0
  return (
    <Card className={cn('space-y-3 bg-gradient-to-br to-surface', TIER_TONE[plan.tier] ?? '', current && 'border-coin/60')}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="flex items-center gap-1.5 font-bold"><Crown className="size-4 text-coin" aria-hidden />{plan.name}
            <span className="rounded bg-surface-2 px-1.5 text-[11px] font-semibold text-fg-muted">VIP{plan.tier}</span></p>
          {plan.description && <p className="text-xs text-fg-muted">{plan.description}</p>}
        </div>
        {current && <span className="rounded-full bg-coin/20 px-2 py-0.5 text-[11px] font-bold text-coin">Đang dùng</span>}
      </div>
      {price ? (
        <p><span className="font-mono text-2xl font-bold">{formatVnd(price.price_vnd)}</span>
          <span className="text-sm text-fg-muted"> / {MONTH_LABEL[months]}</span>
          {save > 0 && <span className="ml-2 rounded-full bg-brand/15 px-2 py-0.5 text-xs font-semibold text-brand">tiết kiệm {save}%</span>}</p>
      ) : <p className="text-sm text-fg-muted">Không bán kỳ hạn này</p>}
      <ul className="space-y-1.5">
        {plan.perks.map((p) => <li key={p} className="flex items-start gap-2 text-sm"><Check className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden />{p}</li>)}
      </ul>
      <Button block variant={current ? 'secondary' : 'coin'} disabled={!price} loading={busy} onClick={onBuy}>
        {current ? 'Gia hạn' : 'Chọn gói'}
      </Button>
    </Card>
  )
}

/** Gói VIP & Nạp Xu (/me/plan): mua bằng chuyển khoản VietQR, admin xác nhận rồi kích hoạt */
export function PlanScreen() {
  const params = useSearchParams()
  const router = useRouter()
  const tab: Tab = params.get('tab') === 'xu' ? 'xu' : 'vip'
  const setTab = (t: Tab) => router.replace(t === 'vip' ? routes.plan : `${routes.plan}?tab=xu`, { scroll: false })
  const pricing = usePricing()
  const mine = useMyPlan()
  const create = useCreateOrder()
  const [months, setMonths] = useState(1)
  const [order, setOrder] = useState<Order | null>(null)
  const [pendingKey, setPendingKey] = useState<string | null>(null)
  const [now] = useState(() => Date.now())

  const buy = async (input: OrderInput, key: string) => {
    setPendingKey(key)
    try { setOrder(await create.mutateAsync(input)) } catch (e) { toast.error(billingErrorMessage(e)) } finally { setPendingKey(null) }
  }

  if (pricing.isPending) return <Skeleton className="h-96" />
  if (pricing.isError) return <ErrorState message={billingErrorMessage(pricing.error)} onRetry={() => void pricing.refetch()} />
  const vip = pricing.data.plans.filter((p) => p.owner_type === 'USER')
  const periods = Array.from(new Set(vip.flatMap((p) => p.prices.filter((x) => x.active).map((x) => x.months)))).sort((a, b) => a - b)
  const plan = mine.data?.plan ?? null
  const orders = mine.data?.orders ?? []

  return (
    <div className="space-y-4">
      <Card className="space-y-3">
        <div className="flex items-center gap-3">
          <span className={cn('grid size-11 place-items-center rounded-xl', plan ? 'bg-coin/20 text-coin' : 'bg-surface-2 text-fg-muted')}><Crown className="size-5" aria-hidden /></span>
          <div>
            <p className="font-bold">{plan ? plan.name : 'Gói miễn phí'}</p>
            <p className="text-xs text-fg-muted">{plan ? `Hiệu lực đến ${fmtDate(plan.ends_at)}` : 'Nâng cấp để có lượt tạo thử thách miễn phí mỗi tháng'}</p>
          </div>
        </div>
        {mine.data && (plan || mine.data.credits.length > 0) && (
          <>
            <p className="text-sm font-semibold">Lượt tạo thử thách / giải còn lại</p>
            <CreditList credits={mine.data.credits} empty="Đã dùng hết lượt tháng này." />
          </>
        )}
      </Card>

      {plan?.plan_code.startsWith('VIP') && (
        <Link href={routes.insights} className="flex items-center justify-between rounded-xl border border-border bg-surface px-4 py-3 text-sm font-semibold">
          Mở Phân tích của tôi (quyền lợi VIP)<ChevronRight className="size-4 text-fg-subtle" aria-hidden />
        </Link>
      )}

      <SegmentedControl value={tab} onChange={setTab} options={[{ value: 'vip', label: 'Gói VIP' }, { value: 'xu', label: 'Nạp Xu' }]} />

      {tab === 'vip' ? (
        <div className="space-y-3">
          {periods.length > 1 && (
            <div className="flex gap-2" role="radiogroup" aria-label="Kỳ hạn">
              {periods.map((m) => (
                <button key={m} role="radio" aria-checked={months === m} onClick={() => setMonths(m)}
                  className={cn('rounded-full border px-3 py-1.5 text-sm font-semibold', months === m ? 'border-brand bg-brand/10' : 'border-border text-fg-muted')}>
                  {MONTH_LABEL[m]}
                </button>
              ))}
            </div>
          )}
          {vip.map((p) => (
            <PlanCard key={p.code} plan={p} months={months} current={plan?.plan_code === p.code} busy={pendingKey === p.code}
              onBuy={() => void buy({ kind: 'PLAN', plan_code: p.code, months }, p.code)} />
          ))}
          <p className="text-xs text-fg-subtle">Gia hạn khi còn hạn sẽ cộng nối tiếp. Lượt tạo cấp đầu mỗi tháng, không cộng dồn sang tháng sau.</p>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            {pricing.data.packages.filter((x) => x.active).map((x) => (
              <button key={x.id} onClick={() => void buy({ kind: 'XU', package_id: x.id }, x.id)} disabled={!!pendingKey}
                className="relative rounded-2xl border border-border bg-surface p-3 text-left transition-colors hover:border-coin/60 disabled:opacity-60">
                {x.bonus_xu > 0 && <span className="absolute right-2 top-2 rounded-full bg-brand/15 px-1.5 text-[11px] font-bold text-brand">+{formatCoin(x.bonus_xu)}</span>}
                <p className="flex items-center gap-1.5 font-mono text-xl font-bold text-coin"><Coins className="size-5" aria-hidden />{formatCoin(x.xu)}</p>
                <p className="text-sm font-semibold">{formatVnd(x.price_vnd)}</p>
                {pendingKey === x.id && <p className="text-xs text-fg-subtle">Đang tạo đơn…</p>}
              </button>
            ))}
          </div>
          <p className="text-xs text-fg-subtle">
            1 Xu ≈ {formatVnd(pricing.data.xu_vnd)}. Xu dùng trong RaceHub (tạo thử thách, quà tặng, trang phục…), không đổi ra tiền mặt và không chuyển cho người khác.
          </p>
        </div>
      )}

      {orders.length > 0 && (
        <section>
          <SectionTitle>Đơn hàng của tôi</SectionTitle>
          <ul className="divide-y divide-border rounded-xl border border-border bg-surface">
            {orders.map((o) => {
              const s = STATUS_META[o.status]
              const expired = o.status === 'PENDING' && Date.parse(o.expires_at) <= now
              return (
                <li key={o.id}>
                  <button onClick={() => setOrder(o)} className="flex w-full items-center gap-3 p-3 text-left">
                    <Receipt className="size-4 shrink-0 text-fg-muted" aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{orderTitle(o)}</span>
                      <span className="block text-xs text-fg-subtle">{o.code} · {formatVnd(o.amount_vnd)} · {fmtDate(o.created_at)}</span>
                    </span>
                    <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold', expired ? STATUS_META.CANCELLED.tone : s.tone)}>
                      {expired ? 'Hết hạn' : s.label}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      <OrderSheet order={order} onClose={() => { setOrder(null); void mine.refetch() }} />
    </div>
  )
}
