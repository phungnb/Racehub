'use client'

import Link from 'next/link'
import { NotificationBell } from '@/features/notification'
import { CoinAmount, LevelBadge } from '@/shared/ui'
import { routes } from '@/shared/config/routes'
import type { Profile } from '@/shared/types/profile'

// Chiều cao cố định (h-16) để các thanh dính bên dưới (vd. tab CLB) đặt đúng vị trí: top-[var(--topbar-h)]
export function TopBar({ profile }: { profile: Profile | null }) {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-bg/85 pt-[env(safe-area-inset-top)] backdrop-blur-md">
      <div className="flex h-16 items-center justify-between gap-2 px-4">
        <Link href={routes.home} className="text-lg font-extrabold tracking-wide">
          RACE<span className="text-brand">HUB</span>
        </Link>
        {profile && (
          <div className="flex items-center gap-1">
            <NotificationBell userId={profile.id} />
            <Link href={routes.me} className="flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1.5" aria-label="Hồ sơ của tôi">
              <LevelBadge level={profile.level} />
              <CoinAmount value={profile.xu} className="text-sm" />
            </Link>
          </div>
        )}
      </div>
    </header>
  )
}
