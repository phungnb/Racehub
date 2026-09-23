'use client'

import Link from 'next/link'
import { CoinAmount, LevelBadge } from '@/shared/ui'
import { routes } from '@/shared/config/routes'
import type { Profile } from '@/shared/types/profile'

export function TopBar({ profile }: { profile: Profile | null }) {
  return (
    <header className="sticky top-0 z-40 flex items-center justify-between border-b border-border bg-bg/85 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] backdrop-blur-md">
      <Link href={routes.home} className="text-lg font-extrabold tracking-wide">
        RACE<span className="text-brand">HUB</span>
      </Link>
      {profile && (
        <Link href={routes.me} className="flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1.5" aria-label="Hồ sơ của tôi">
          <LevelBadge level={profile.level} />
          <CoinAmount value={profile.xu} className="text-sm" />
        </Link>
      )}
    </header>
  )
}
