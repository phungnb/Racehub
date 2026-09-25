'use client'

import { useState } from 'react'
import { Award, Coins, Lock } from 'lucide-react'
import { EmptyState, ErrorState, ProgressBar, Sheet, Skeleton } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { formatCoin, formatNumber } from '@/shared/lib/format'
import { gameErrorMessage } from '../api/gameApi'
import { useAchievements } from '../hooks/useGame'
import { CATEGORY_LABEL, gameIcon, TIER_META, type Achievement } from '../model/game'

const num = (n: number) => n.toLocaleString('vi-VN', { maximumFractionDigits: 1 })

/** Huy hiệu (MH trong trang Tôi): đã mở có màu theo bậc, chưa mở hiện mờ kèm điều kiện và tiến độ */
export function BadgeGrid() {
  const q = useAchievements()
  const [sel, setSel] = useState<Achievement | null>(null)
  if (q.isPending) return <div className="grid grid-cols-3 gap-2">{Array.from({ length: 9 }, (_, i) => <Skeleton key={i} className="h-28" />)}</div>
  if (q.isError) return <ErrorState message={gameErrorMessage(q.error)} error={q.error} onRetry={() => void q.refetch()} />
  if (!q.data.length) return <EmptyState icon={Award} title="Chưa có huy hiệu" description="Huy hiệu sẽ xuất hiện khi hệ thống được cấu hình." />

  const got = q.data.filter((a) => a.unlocked_at).length
  const groups = Object.entries(q.data.reduce<Record<string, Achievement[]>>((m, a) => ((m[a.category] ??= []).push(a), m), {}))
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <p className="text-sm text-fg-muted">Đã mở <b className="font-mono text-fg">{got}</b>/{q.data.length} huy hiệu</p>
      </div>
      {groups.map(([cat, list]) => (
        <section key={cat} className="space-y-2">
          <h3 className="text-sm font-semibold text-fg-muted">{CATEGORY_LABEL[cat] ?? cat}</h3>
          <ul className="grid grid-cols-3 gap-2">
            {list.map((a) => {
              const Icon = gameIcon(a.icon)
              const t = TIER_META[a.tier] ?? TIER_META.BRONZE
              const open = !!a.unlocked_at
              return (
                <li key={a.code}>
                  <button onClick={() => setSel(a)} className={cn('flex h-full w-full flex-col items-center gap-1.5 rounded-2xl border p-2.5 text-center',
                    open ? 'border-border bg-surface' : 'border-dashed border-border bg-transparent')}>
                    <span className={cn('relative grid size-12 place-items-center rounded-full ring-2',
                      open ? cn(t.bg, t.text, t.ring) : 'bg-surface-2 text-fg-subtle ring-transparent')}>
                      <Icon className="size-6" aria-hidden />
                      {!open && <Lock className="absolute -bottom-0.5 -right-0.5 size-4 rounded-full bg-bg p-0.5 text-fg-subtle" aria-hidden />}
                    </span>
                    <span className={cn('line-clamp-2 text-xs font-semibold leading-tight', !open && 'text-fg-muted')}>{a.title}</span>
                    {!open && <ProgressBar value={a.progress} max={a.target} className="h-1" />}
                  </button>
                </li>
              )
            })}
          </ul>
        </section>
      ))}

      <Sheet open={!!sel} onClose={() => setSel(null)} title={sel?.title ?? ''} description={sel ? `${TIER_META[sel.tier]?.label ?? ''} · ${CATEGORY_LABEL[sel.category] ?? ''}` : undefined}>
        {sel && (
          <div className="space-y-4 pb-2">
            <div className="flex justify-center">
              {(() => {
                const Icon = gameIcon(sel.icon)
                const t = TIER_META[sel.tier] ?? TIER_META.BRONZE
                return (
                  <span className={cn('grid size-24 place-items-center rounded-full ring-4', sel.unlocked_at ? cn(t.bg, t.text, t.ring) : 'bg-surface-2 text-fg-subtle ring-border')}>
                    <Icon className="size-12" aria-hidden />
                  </span>
                )
              })()}
            </div>
            <p className="text-center text-fg-muted">{sel.description}</p>
            {sel.unlocked_at ? (
              <p className="text-center text-sm text-brand">Mở khóa ngày {new Date(sel.unlocked_at).toLocaleDateString('vi-VN')}</p>
            ) : (
              <div className="space-y-1.5">
                <ProgressBar value={sel.progress} max={sel.target} />
                <p className="text-center font-mono text-sm text-fg-muted">{num(sel.progress)}/{num(sel.target)}</p>
              </div>
            )}
            {(sel.xp_reward > 0 || sel.xu_reward > 0) && (
              <p className="flex items-center justify-center gap-3 text-sm font-semibold">
                <span className="text-fg-muted">Thưởng</span>
                {sel.xp_reward > 0 && <span className="font-mono text-xp">+{formatNumber(sel.xp_reward)} XP</span>}
                {sel.xu_reward > 0 && <span className="flex items-center gap-1 font-mono text-coin"><Coins className="size-4" aria-hidden />+{formatCoin(sel.xu_reward)}</span>}
              </p>
            )}
          </div>
        )}
      </Sheet>
    </div>
  )
}
