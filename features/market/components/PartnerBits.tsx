'use client'

import Link from 'next/link'
import { BadgeCheck, MapPin, ShoppingBag, Sparkles, Whistle } from 'lucide-react'
import { Card } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { routes } from '@/shared/config/routes'
import { PARTNER_KIND, type Partner, type PartnerKind } from '../api/marketApi'

export const KIND_ICON: Record<PartnerKind, typeof Whistle> = { COACH: Whistle, SHOP: ShoppingBag, SERVICE: Sparkles }

export function VerifiedBadge({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full bg-brand/15 px-2 py-0.5 text-[11px] font-bold text-brand', className)}>
      <BadgeCheck className="size-3.5" aria-hidden />Đã xác minh
    </span>
  )
}

export function PartnerLogo({ p, className }: { p: Pick<Partner, 'avatar_url' | 'name' | 'kind'>; className?: string }) {
  const Icon = KIND_ICON[p.kind]
  return (
    <span className={cn('grid size-14 shrink-0 place-items-center overflow-hidden rounded-2xl bg-surface-2 text-fg-muted', className)}>
      {/* eslint-disable-next-line @next/next/no-img-element -- ảnh hồ sơ trong kho market-media */}
      {p.avatar_url ? <img src={p.avatar_url} alt={p.name} className="h-full w-full object-cover" /> : <Icon className="size-6" aria-hidden />}
    </span>
  )
}

export function PartnerCard({ p }: { p: Partner }) {
  return (
    <Link href={routes.partner(p.id)} className="block">
      <Card className="flex gap-3 p-3 transition-colors hover:border-fg-subtle">
        <PartnerLogo p={p} />
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center gap-1.5">
            <p className="truncate font-semibold">{p.name}</p>
            {p.verified && <BadgeCheck className="size-4 shrink-0 text-brand" aria-label="Đã xác minh" />}
          </div>
          {p.tagline && <p className="line-clamp-2 text-sm text-fg-muted">{p.tagline}</p>}
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-fg-subtle">
            <span>{PARTNER_KIND[p.kind].label}</span>
            {p.area && <span className="inline-flex items-center gap-0.5"><MapPin className="size-3" aria-hidden />{p.area}</span>}
            {p.services_count > 0 && <span>{p.services_count} dịch vụ</span>}
          </p>
          {!!p.specialties.length && (
            <div className="flex flex-wrap gap-1">
              {p.specialties.slice(0, 4).map((s) => <span key={s} className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-fg-muted">{s}</span>)}
            </div>
          )}
        </div>
      </Card>
    </Link>
  )
}
