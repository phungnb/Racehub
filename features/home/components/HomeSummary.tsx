'use client'

import Link from 'next/link'
import { Watch } from 'lucide-react'
import { Button, Card, CoinAmount, LevelBadge, ProgressBar, StatTile } from '@/shared/ui'
import { formatCoin, formatNumber } from '@/shared/lib/format'
import { levelProgress } from '@/features/progression/model/levels'
import type { Profile } from '@/shared/types/profile'

export function HomeSummary({ profile }: { profile: Profile }) {
  const p = levelProgress(profile.xp, profile.level)
  const initial = (profile.display_name ?? 'R').trim().charAt(0).toUpperCase()

  return (
    <Card className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="grid size-14 shrink-0 place-items-center overflow-hidden rounded-full bg-brand text-xl font-extrabold text-brand-fg">
          {profile.avatar_url
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={profile.avatar_url} alt="" className="size-full object-cover" />
            : initial}
        </div>
        <div className="min-w-0">
          <p className="truncate text-lg font-bold">{profile.display_name || 'Runner'}</p>
          <p className="flex items-center gap-2 text-sm text-fg-muted">
            <LevelBadge level={p.current.level} /> {p.current.name}
          </p>
        </div>
      </div>

      <div className="space-y-1.5">
        <div className="flex justify-between text-xs text-fg-muted">
          <span>Kinh nghiệm</span>
          <span>
            {p.next ? <>còn <span className="font-mono tabular text-fg">{formatNumber(p.remaining)}</span> XP lên {p.next.name}</> : 'Cấp tối đa'}
          </span>
        </div>
        <ProgressBar value={p.value} max={p.span} tone="xp" />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <StatTile label="Tổng XP" value={formatNumber(profile.xp)} tone="xp" />
        <StatTile label="RaceCoin" value={formatCoin(profile.xu)} unit="Xu" tone="coin" />
      </div>
    </Card>
  )
}

export function ConnectDeviceCard() {
  return (
    <Card className="flex items-center gap-3 border-brand/30 bg-brand/5">
      <Watch className="size-8 shrink-0 text-brand" aria-hidden />
      <div className="flex-1">
        <p className="font-semibold">Kết nối Strava</p>
        <p className="text-sm text-fg-muted">Bài chạy từ Garmin, Coros, Apple Watch sẽ tự động tính vào thử thách.</p>
      </div>
      <Link href="/api/connect/strava"><Button size="sm">Kết nối</Button></Link>
    </Card>
  )
}

