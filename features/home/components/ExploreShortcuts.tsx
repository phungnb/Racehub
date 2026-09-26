'use client'

import Link from 'next/link'
import { Gift, Medal, Radar, Store, Swords, type LucideIcon } from 'lucide-react'
import { routes } from '@/shared/config/routes'

const ITEMS: { href: string; label: string; icon: LucideIcon; tone: string }[] = [
  { href: routes.nearby, label: 'Quanh đây', icon: Radar, tone: 'bg-live/15 text-live' },
  { href: routes.races, label: 'Giải chạy ảo', icon: Medal, tone: 'bg-brand/15 text-brand' },
  { href: '/cups', label: 'Thách đấu CLB', icon: Swords, tone: 'bg-warning/15 text-warning' },
  { href: routes.market, label: 'Chợ Runner', icon: Store, tone: 'bg-sky-500/15 text-sky-400' },
  { href: routes.invite, label: 'Mời bạn bè', icon: Gift, tone: 'bg-coin/15 text-coin' },
]

/** Lối tắt trang chủ tới các khu ít nằm trên thanh điều hướng: runner quanh đây, giải chạy ảo, thách đấu CLB, Chợ Runner, mời bạn */
export function ExploreShortcuts() {
  return (
    <nav aria-label="Khám phá" className="grid grid-cols-5 gap-2">
      {ITEMS.map((x) => (
        <Link key={x.href} href={x.href} className="flex flex-col items-center gap-1.5 rounded-2xl border border-border bg-surface px-1 py-3 text-center hover:border-fg-subtle">
          <span className={`grid size-10 place-items-center rounded-xl ${x.tone}`}><x.icon className="size-5" aria-hidden /></span>
          <span className="text-[11px] font-semibold leading-tight">{x.label}</span>
        </Link>
      ))}
    </nav>
  )
}
