import { Coins, Sparkles } from 'lucide-react'
import { cn } from '@/shared/lib/cn'
import { formatCoin, formatNumber } from '@/shared/lib/format'

export function CoinAmount({ value, className }: { value: number | string | null | undefined; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1 font-mono tabular font-semibold text-coin', className)}>
      <Coins className="size-4" aria-hidden />{formatCoin(value)}
      <span className="sr-only"> Xu</span>
    </span>
  )
}

export function XpAmount({ value, className }: { value: number | null | undefined; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1 font-mono tabular font-semibold text-xp', className)}>
      <Sparkles className="size-4" aria-hidden />{formatNumber(value)} XP
    </span>
  )
}

export function LevelBadge({ level, className }: { level: number | null | undefined; className?: string }) {
  return (
    <span className={cn('inline-flex items-center rounded-full bg-brand/15 px-2 py-0.5 text-xs font-bold text-brand', className)}>
      Lv.{level ?? 1}
    </span>
  )
}
