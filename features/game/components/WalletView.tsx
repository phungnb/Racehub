'use client'

import Link from 'next/link'
import { ArrowDownLeft, ArrowUpRight, Crown, Plus, Wallet as WalletIcon } from 'lucide-react'
import { routes } from '@/shared/config/routes'
import { Button, Card, EmptyState, ErrorState, Skeleton } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { formatCoin } from '@/shared/lib/format'
import { xuToVnd } from '@/shared/lib/economy'
import { gameErrorMessage } from '../api/gameApi'
import { useWallet } from '../hooks/useGame'
import { walletLabel, type WalletItem } from '../model/game'
import { PromoCodeForm } from './PromoCodeForm'

const dayLabel = (iso: string) => {
  const d = new Date(iso)
  const today = new Date()
  const y = new Date(today); y.setDate(today.getDate() - 1)
  if (d.toDateString() === today.toDateString()) return 'Hôm nay'
  if (d.toDateString() === y.toDateString()) return 'Hôm qua'
  return d.toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit' })
}

/** Ví Xu (MH25): số dư Xu thưởng / Xu nạp và lịch sử lấy thẳng từ sổ cái */
export function WalletView() {
  const q = useWallet()
  if (q.isPending) return <div className="space-y-2"><Skeleton className="h-32" /><Skeleton className="h-14" /><Skeleton className="h-14" /><Skeleton className="h-14" /></div>
  if (q.isError) return <ErrorState message={gameErrorMessage(q.error)} onRetry={() => void q.refetch()} />
  const head = q.data.pages[0]
  const items = q.data.pages.flatMap((p) => p.items)
  const byDay = items.reduce<[string, WalletItem[]][]>((acc, it) => {
    const k = dayLabel(it.created_at)
    const last = acc[acc.length - 1]
    if (last && last[0] === k) last[1].push(it); else acc.push([k, [it]])
    return acc
  }, [])

  return (
    <div className="space-y-4">
      <Card className="space-y-3 bg-gradient-to-br from-coin/15 via-surface to-surface">
        <p className="text-sm text-fg-muted">Số dư</p>
        <p className="font-mono text-4xl font-bold text-coin">{formatCoin(head.total)} <span className="text-lg">Xu</span></p>
        <p className="text-xs text-fg-subtle">Giá trị tham chiếu {xuToVnd(head.total)} · Xu dùng trong app, không đổi ra tiền</p>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div className="rounded-xl bg-bg/60 p-2.5"><p className="text-xs text-fg-subtle">Xu thưởng</p><p className="font-mono font-semibold">{formatCoin(head.bonus)}</p></div>
          <div className="rounded-xl bg-bg/60 p-2.5"><p className="text-xs text-fg-subtle">Xu nạp</p><p className="font-mono font-semibold">{formatCoin(head.paid)}</p></div>
        </div>
        <p className="text-xs text-fg-subtle">Khi tiêu, Xu thưởng được dùng trước. Xu không chuyển cho người khác được.</p>
        <div className="grid grid-cols-2 gap-2">
          <Link href={`${routes.plan}?tab=xu`} className="flex h-11 items-center justify-center gap-1.5 rounded-xl bg-coin font-semibold text-bg">
            <Plus className="size-4" aria-hidden />Nạp Xu
          </Link>
          <Link href={routes.plan} className="flex h-11 items-center justify-center gap-1.5 rounded-xl border border-border font-semibold">
            <Crown className="size-4 text-coin" aria-hidden />Gói VIP
          </Link>
        </div>
        <PromoCodeForm />
      </Card>

      {!items.length ? (
        <EmptyState icon={WalletIcon} title="Chưa có giao dịch" description="Chạy bộ (từ km thứ 3 mỗi ngày), điểm danh bằng bài chạy, giữ chuỗi tuần để có Xu." />
      ) : (
        <div className="space-y-4">
          {byDay.map(([day, list]) => (
            <section key={day}>
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-fg-subtle">{day}</h3>
              <ul className="divide-y divide-border rounded-xl border border-border bg-surface">
                {list.map((it) => {
                  const inflow = it.amount > 0
                  return (
                    <li key={it.id} className="flex items-center gap-3 px-3 py-2.5">
                      <span className={cn('grid size-9 shrink-0 place-items-center rounded-full', inflow ? 'bg-brand/15 text-brand' : 'bg-surface-2 text-fg-muted')}>
                        {inflow ? <ArrowDownLeft className="size-4" aria-hidden /> : <ArrowUpRight className="size-4" aria-hidden />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold">{walletLabel(it.type)}</span>
                        <span className="block truncate text-xs text-fg-muted">
                          {it.reason ?? ''}{it.reason ? ' · ' : ''}{new Date(it.created_at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </span>
                      <span className={cn('font-mono text-sm font-semibold', inflow ? 'text-brand' : 'text-fg')}>
                        {inflow ? '+' : '−'}{formatCoin(Math.abs(it.amount))}
                      </span>
                    </li>
                  )
                })}
              </ul>
            </section>
          ))}
          {q.hasNextPage && (
            <Button block variant="secondary" onClick={() => void q.fetchNextPage()} loading={q.isFetchingNextPage}>Xem thêm</Button>
          )}
        </div>
      )}
    </div>
  )
}
