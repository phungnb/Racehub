'use client'

import { Check, Coins, Lock } from 'lucide-react'
import { ProgressBar } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { formatCoin, formatNumber } from '@/shared/lib/format'
import { gameIcon, questProgressLabel, type Quest } from '../model/game'

const daysLeft = (iso: string) => {
  const h = Math.max(0, Math.round((Date.parse(iso) - Date.now()) / 3_600_000))
  return h >= 48 ? `${Math.floor(h / 24)} ngày` : `${h} giờ`
}

/** Danh sách nhiệm vụ: đạt là tự nhận thưởng (không cần bấm "Nhận") */
export function QuestList({ quests }: { quests: Quest[] }) {
  return (
    <ul className="divide-y divide-border">
      {quests.map((q) => {
        const Icon = gameIcon(q.icon)
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
              {!q.completed && !q.locked && <ProgressBar value={q.progress} max={q.target} className="h-1.5" />}
              {(q.locked || q.ends_at || (q.period === 'EVENT' && q.description)) && (
                <p className="text-xs text-fg-subtle">
                  {q.locked ? `Dành cho VIP${q.min_vip_tier ?? 1}` : q.period === 'EVENT' && q.description ? q.description : ''}
                  {q.ends_at ? `${q.locked || q.description ? ' · ' : ''}còn ${daysLeft(q.ends_at)}` : ''}
                </p>
              )}
            </div>
            <span className={cn('flex shrink-0 flex-col items-end text-xs font-semibold', q.completed ? 'text-fg-subtle' : '')}>
              {q.reward_xu > 0 && <span className={cn('flex items-center gap-0.5 font-mono', !q.completed && 'text-coin')}><Coins className="size-3" aria-hidden />{formatCoin(q.reward_xu)}</span>}
              {q.reward_xp > 0 && <span className={cn('font-mono', !q.completed && 'text-xp')}>{formatNumber(q.reward_xp)} XP</span>}
            </span>
          </li>
        )
      })}
    </ul>
  )
}
