'use client'

import { Award, Check, Coins, Lock, Users } from 'lucide-react'
import { ProgressBar } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { formatCoin, formatNumber } from '@/shared/lib/format'
import { gameIcon, nextTier, questExtras, questProgressLabel, type Quest } from '../model/game'

const daysLeft = (iso: string) => {
  const h = Math.max(0, Math.round((Date.parse(iso) - Date.now()) / 3_600_000))
  return h >= 48 ? `${Math.floor(h / 24)} ngày` : `${h} giờ`
}
const km = (n: number) => n.toLocaleString('vi-VN', { maximumFractionDigits: 1 })

/** Danh sách nhiệm vụ: đạt là tự nhận thưởng (không cần bấm "Nhận") */
export function QuestList({ quests }: { quests: Quest[] }) {
  return (
    <ul className="divide-y divide-border">
      {quests.map((q) => {
        const Icon = q.metric === 'COMMUNITY_KM' ? Users : gameIcon(q.icon)
        const tier = nextTier(q)
        const extras = questExtras(q)
        const community = q.metric === 'COMMUNITY_KM'
        const minKm = q.params?.min_km ?? 1
        const sub = [
          q.locked ? `Dành cho VIP${q.min_vip_tier ?? 1}` : null,
          community ? `Bạn đã góp ${km(q.mine ?? 0)} km${(q.mine ?? 0) < minKm ? ` · cần ≥ ${km(minKm)} km để nhận thưởng` : ''}` : null,
          q.tiers?.length && !q.completed ? `Bậc ${(q.tier_paid ?? 0) + 1}/${q.tiers.length}: đạt ${formatNumber(tier?.target ?? q.target)}` : null,
          !community && !q.tiers?.length && q.description ? q.description : null,
          q.ends_at ? `còn ${daysLeft(q.ends_at)}` : null,
        ].filter(Boolean).join(' · ')
        // Nhiệm vụ bậc: hiện Xu của bậc kế tiếp; xong hết thì tổng
        const xu = tier && !q.completed ? tier.xu : q.reward_xu
        return (
          <li key={q.id} className="flex items-center gap-3 py-3 first:pt-1 last:pb-1">
            <span className={cn('grid size-10 shrink-0 place-items-center rounded-xl',
              q.completed ? 'bg-brand text-brand-fg' : 'bg-surface-2 text-fg-muted')}>
              {q.completed ? <Check className="size-5" aria-hidden /> : q.locked ? <Lock className="size-5" aria-hidden /> : <Icon className="size-5" aria-hidden />}
            </span>
            <div className="min-w-0 flex-1 space-y-1.5">
              <div className="flex items-baseline justify-between gap-2">
                <p className={cn('truncate text-sm font-semibold', q.completed && 'text-fg-muted line-through decoration-fg-subtle')}>{q.title}</p>
                <span className="shrink-0 font-mono text-xs text-fg-muted">{questProgressLabel(q)}</span>
              </div>
              {!q.completed && !q.locked && (
                <div className="relative">
                  <ProgressBar value={q.progress} max={q.target} className="h-1.5" />
                  {/* Vạch các bậc trên thanh tiến độ */}
                  {q.tiers && q.tiers.length > 1 && q.tiers.slice(0, -1).map((t, i) => (
                    <span key={i} aria-hidden className={cn('absolute top-1/2 h-3 w-0.5 -translate-y-1/2 rounded-full', i < (q.tier_paid ?? 0) ? 'bg-brand' : 'bg-fg-subtle')}
                      style={{ left: `${(t.target / q.target) * 100}%` }} />
                  ))}
                </div>
              )}
              {sub && <p className="text-xs text-fg-subtle">{sub}</p>}
              {extras.length > 0 && (
                <p className="flex items-center gap-1 text-xs font-medium text-coin"><Award className="size-3.5 shrink-0" aria-hidden />{extras.join(' · ')}</p>
              )}
            </div>
            <span className={cn('flex shrink-0 flex-col items-end text-xs font-semibold', q.completed ? 'text-fg-subtle' : '')}>
              {xu > 0 && <span className={cn('flex items-center gap-0.5 font-mono', !q.completed && 'text-coin')}><Coins className="size-3" aria-hidden />{formatCoin(xu)}</span>}
            </span>
          </li>
        )
      })}
    </ul>
  )
}
