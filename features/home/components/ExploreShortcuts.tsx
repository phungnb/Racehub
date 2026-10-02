'use client'

import Link from 'next/link'
import { BookOpen, Gift, Medal, Radar, Store, UsersRound, type LucideIcon } from 'lucide-react'
import { routes } from '@/shared/config/routes'
import { useOpsPolicy } from '@/features/system'
import type { FeatureKey } from '@/shared/lib/ops'

const ITEMS: { href: string; label: string; icon: LucideIcon; tone: string; feature?: FeatureKey }[] = [
  { href: routes.nearby, label: 'Quanh đây', icon: Radar, tone: 'bg-live/15 text-live', feature: 'nearby' },
  { href: routes.hub, label: 'Hội quán', icon: UsersRound, tone: 'bg-violet-500/15 text-violet-300', feature: 'nearby' },
  { href: routes.races, label: 'Giải chạy', icon: Medal, tone: 'bg-brand/15 text-brand', feature: 'races' },
  { href: routes.learn, label: 'Kiến thức Runner', icon: BookOpen, tone: 'bg-warning/15 text-warning', feature: 'knowledge' },
  { href: routes.market, label: 'Chợ Runner', icon: Store, tone: 'bg-sky-500/15 text-sky-400', feature: 'market' },
  { href: routes.invite, label: 'Mời bạn bè', icon: Gift, tone: 'bg-coin/15 text-coin' },
]

/** Lối tắt trang chủ: runner quanh đây, Hội quán runner, giải chạy, Kiến thức Runner, Chợ Runner, mời bạn (Thách đấu CLB nằm trong tab Thử thách) */
export function ExploreShortcuts() {
  // Tính năng admin tắt (Chính sách vận hành) thì ẩn lối tắt
  const { features } = useOpsPolicy()
  const items = ITEMS.filter((x) => !x.feature || features[x.feature])
  return (
    <nav aria-label="Khám phá" className="grid gap-2" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
      {items.map((x) => (
        <Link key={x.href} href={x.href} className="flex flex-col items-center gap-1.5 rounded-2xl border border-border bg-surface px-1 py-3 text-center hover:border-fg-subtle">
          <span className={`grid size-10 place-items-center rounded-xl ${x.tone}`}><x.icon className="size-5" aria-hidden /></span>
          <span className="text-[11px] font-semibold leading-tight">{x.label}</span>
        </Link>
      ))}
    </nav>
  )
}
