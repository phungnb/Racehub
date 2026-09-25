'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Button, Skeleton } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { formatVnd } from '@/shared/lib/economy'
import { billingErrorMessage, MONTH_LABEL, type Order } from '../api/billingApi'
import { useActiveSales, useClubPlanStatus, useCreateOrder, usePricing } from '../hooks/useBilling'
import { bestSale, salePrice } from '../model/sale'
import { OrderSheet } from './OrderSheet'
import { CreditList } from './PlanScreen'

/** Mua / gia hạn CLB Pro theo 1–3–6–12 tháng (ban quản trị) + lượt tạo thử thách của CLB */
export function ClubProPurchase({ clubId, active }: { clubId: string; active: boolean }) {
  const pricing = usePricing()
  const sales = useActiveSales()
  const status = useClubPlanStatus(clubId)
  const create = useCreateOrder()
  const [months, setMonths] = useState(12)
  const [order, setOrder] = useState<Order | null>(null)
  if (pricing.isPending) return <Skeleton className="h-32" />
  const plan = pricing.data?.plans.find((p) => p.code === 'CLUB_PRO')
  const prices = (plan?.prices ?? []).filter((p) => p.active)
  const monthly = prices.find((p) => p.months === 1)?.price_vnd
  const chosen = prices.find((p) => p.months === months) ?? prices.at(-1)
  const sale = bestSale(sales.data ?? [], 'PLAN', 'CLUB_PRO')
  const buy = async () => {
    if (!chosen) return
    try { setOrder(await create.mutateAsync({ kind: 'PLAN', plan_code: 'CLUB_PRO', months: chosen.months, club_id: clubId })) }
    catch (e) { toast.error(billingErrorMessage(e)) }
  }
  return (
    <div className="space-y-3">
      {status.data && (active || status.data.credits.length > 0) && (
        <>
          <p className="text-sm font-semibold">Lượt tạo thử thách của CLB tháng này</p>
          <CreditList credits={status.data.credits} empty="Đã dùng hết lượt tháng này." />
        </>
      )}
      {prices.length > 0 && (
        <>
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Kỳ hạn CLB Pro">
            {prices.map((p) => {
              const save = monthly && p.months > 1 ? Math.round((1 - p.price_vnd / (monthly * p.months)) * 100) : 0
              const on = chosen?.months === p.months
              return (
                <button key={p.months} role="radio" aria-checked={on} onClick={() => setMonths(p.months)}
                  className={cn('rounded-xl border p-2.5 text-left', on ? 'border-coin bg-coin/10' : 'border-border')}>
                  <span className="block text-sm font-semibold">{MONTH_LABEL[p.months]}</span>
                  <span className="block font-mono text-sm">{formatVnd(salePrice(p.price_vnd, sale))}
                    {salePrice(p.price_vnd, sale) < p.price_vnd && <span className="ml-1 text-xs text-fg-subtle line-through">{formatVnd(p.price_vnd)}</span>}</span>
                  {save > 0 && <span className="text-[11px] font-semibold text-brand">tiết kiệm {save}%</span>}
                </button>
              )
            })}
          </div>
          <Button block variant="coin" onClick={buy} loading={create.isPending}>
            {active ? 'Gia hạn CLB Pro' : 'Nâng cấp CLB Pro'}{chosen ? ` · ${formatVnd(salePrice(chosen.price_vnd, sale))}` : ''}
          </Button>
          <p className="text-xs text-fg-subtle">Chuyển khoản VietQR, RaceHub xác nhận rồi bật Pro cho CLB. Gia hạn khi còn hạn sẽ cộng nối tiếp.</p>
        </>
      )}
      <OrderSheet order={order} onClose={() => { setOrder(null); void status.refetch() }} />
    </div>
  )
}
