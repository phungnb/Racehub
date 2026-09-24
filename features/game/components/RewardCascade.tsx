'use client'

import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Award, CalendarCheck, Coins, Flame, Footprints, Gift, HandHeart, Sparkles, Target, TrendingUp, Trophy, UserPlus, X, type LucideIcon } from 'lucide-react'
import { Button } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { formatCoin, formatNumber } from '@/shared/lib/format'
import { buildCascade, cascadeStepMs, gameIcon, leagueTier, TIER_META, type BadgeTier, type GameEvent } from '../model/game'

const KIND: Record<GameEvent['kind'], { icon: LucideIcon; tone: string; label: string }> = {
  RUN: { icon: Footprints, tone: 'bg-brand/15 text-brand', label: 'Bài chạy' },
  QUEST: { icon: Target, tone: 'bg-xp/15 text-xp', label: 'Nhiệm vụ' },
  STREAK: { icon: Flame, tone: 'bg-live/15 text-live', label: 'Chuỗi tuần' },
  BADGE: { icon: Award, tone: 'bg-medal-gold/15 text-medal-gold', label: 'Huy hiệu mới' },
  LEAGUE: { icon: Trophy, tone: 'bg-coin/15 text-coin', label: 'League tuần' },
  CHEER_IN: { icon: HandHeart, tone: 'bg-live/15 text-live', label: 'Cổ vũ' },
  LEVEL_UP: { icon: TrendingUp, tone: 'bg-brand text-brand-fg', label: 'Lên cấp' },
  CHECKIN: { icon: CalendarCheck, tone: 'bg-brand/15 text-brand', label: 'Điểm danh' },
  REFERRAL: { icon: UserPlus, tone: 'bg-brand/15 text-brand', label: 'Giới thiệu bạn bè' },
  GIFT_IN: { icon: Gift, tone: 'bg-coin/15 text-coin', label: 'Quà tặng' },
}

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    const m = window.matchMedia('(prefers-reduced-motion: reduce)')
    const on = () => setReduced(m.matches)
    on()
    m.addEventListener('change', on)
    return () => m.removeEventListener('change', on)
  }, [])
  return reduced
}

function iconFor(e: GameEvent): { Icon: LucideIcon; tone: string } {
  if (e.kind === 'BADGE') {
    const tier = (e.payload.tier as BadgeTier) ?? 'BRONZE'
    return { Icon: gameIcon(e.payload.icon as string), tone: cn(TIER_META[tier]?.bg, TIER_META[tier]?.text) }
  }
  if (e.kind === 'QUEST' && e.payload.icon) return { Icon: gameIcon(e.payload.icon as string), tone: KIND.QUEST.tone }
  if (e.kind === 'LEAGUE') {
    const t = leagueTier(Number(e.payload.tier ?? 1))
    return { Icon: Trophy, tone: cn(t.bg, t.text) }
  }
  return { Icon: KIND[e.kind].icon, tone: KIND[e.kind].tone }
}

/**
 * Chuỗi phần thưởng sau bài chạy (MH17): tối đa 6 thẻ, tổng ≤ 6 giây, chạm để bỏ qua.
 * Người bật "giảm chuyển động" thấy tất cả thẻ ngay, không hiệu ứng.
 */
export function RewardCascade({ events, open, onClose, title = 'Phần thưởng của bạn' }: {
  events: GameEvent[]; open: boolean; onClose: () => void; title?: string
}) {
  const cards = useMemo(() => buildCascade(events), [events])
  const reduced = usePrefersReducedMotion()
  const [shown, setShown] = useState(0)
  const visible = reduced ? cards.length : shown
  const done = visible >= cards.length

  useEffect(() => {
    if (!open || reduced || shown >= cards.length) return
    const t = setTimeout(() => setShown((s) => s + 1), shown === 0 ? 250 : cascadeStepMs(cards.length))
    return () => clearTimeout(t)
  }, [open, reduced, shown, cards.length])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open || cards.length === 0) return null
  const totalXu = cards.reduce((s, e) => s + (e.kind === 'CHEER_IN' ? 0 : e.xu), 0)
  const totalXp = cards.reduce((s, e) => s + e.xp, 0)

  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={title}
      className="fixed inset-0 z-[80] flex flex-col bg-bg/95 px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-[calc(1rem+env(safe-area-inset-top))] backdrop-blur-md animate-fade-in"
      onClick={() => { if (!done) setShown(cards.length) }}>
      <div className="mx-auto flex w-full max-w-md items-center justify-between">
        <p className="flex items-center gap-2 text-lg font-bold"><Sparkles className="size-5 text-coin" aria-hidden />{title}</p>
        <button onClick={(e) => { e.stopPropagation(); onClose() }} aria-label="Đóng"
          className="-mr-2 grid size-11 place-items-center rounded-full text-fg-muted hover:bg-surface-2"><X className="size-5" aria-hidden /></button>
      </div>

      <ol className="mx-auto mt-4 flex w-full max-w-md flex-1 flex-col gap-2.5 overflow-y-auto" aria-live="polite">
        {cards.slice(0, visible).map((e) => {
          const { Icon, tone } = iconFor(e)
          const big = e.kind === 'LEVEL_UP'
          return (
            <li key={e.id} className={cn('flex items-center gap-3 rounded-2xl border border-border bg-surface p-3', !reduced && 'animate-pop',
              big && 'border-brand/60 bg-brand/10 py-4')}>
              <span className={cn('grid shrink-0 place-items-center rounded-xl', big ? 'size-14' : 'size-11', tone)}>
                <Icon className={big ? 'size-7' : 'size-5'} aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-semibold uppercase tracking-wide text-fg-subtle">{KIND[e.kind].label}</span>
                <span className={cn('block font-bold leading-snug', big ? 'text-lg' : 'text-[15px]')}>{e.title.replace(/^(Nhiệm vụ|Huy hiệu): /, '')}</span>
                {e.subtitle && <span className="block truncate text-xs text-fg-muted">{e.subtitle}</span>}
              </span>
              <span className="flex shrink-0 flex-col items-end gap-0.5 font-mono text-sm font-semibold">
                {e.xu > 0 && <span className="flex items-center gap-1 text-coin"><Coins className="size-3.5" aria-hidden />+{formatCoin(e.xu)}</span>}
                {e.xp > 0 && <span className="text-xp">+{formatNumber(e.xp)} XP</span>}
              </span>
            </li>
          )
        })}
      </ol>

      <div className="mx-auto w-full max-w-md space-y-3 pt-3">
        {done && (totalXu > 0 || totalXp > 0) && (
          <p className="text-center text-sm text-fg-muted animate-fade-in">
            Tổng cộng {totalXu > 0 && <b className="font-mono text-coin">+{formatCoin(totalXu)} Xu</b>}
            {totalXu > 0 && totalXp > 0 && ' · '}{totalXp > 0 && <b className="font-mono text-xp">+{formatNumber(totalXp)} XP</b>}
          </p>
        )}
        <Button block size="lg" onClick={(e) => { e.stopPropagation(); if (done) onClose(); else setShown(cards.length) }}>
          {done ? 'Tuyệt vời' : 'Xem hết'}
        </Button>
      </div>
    </div>,
    document.body,
  )
}
