'use client'

import Link from 'next/link'
import { ShieldCheck } from 'lucide-react'
import { isSystemAdmin } from '@/features/admin'
import { NotificationBell } from '@/features/notification'
import { CoinAmount } from '@/shared/ui'
import { routes } from '@/shared/config/routes'
import type { Profile } from '@/shared/types/profile'

// Chiều cao cố định (h-16) để các thanh dính bên dưới (vd. tab CLB) đặt đúng vị trí: top-[var(--topbar-h)]
export function TopBar({ profile }: { profile: Profile | null }) {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-bg/85 pt-[env(safe-area-inset-top)] backdrop-blur-md">
      <div className="flex h-16 items-center justify-between gap-2 px-4">
        <Link href={routes.home} className="flex items-center gap-2 text-lg font-extrabold tracking-wide">
          {/* eslint-disable-next-line @next/next/no-img-element -- biểu tượng tĩnh nhỏ */}
          <img src="/icons/mark-256.png" alt="" width={28} height={28} className="size-7" />
          <span>RACE<span className="text-brand">HUB</span></span>
        </Link>
        {profile && (
          <div className="flex items-center gap-1">
            {isSystemAdmin(profile) && (
              <Link href={routes.admin} aria-label="Quản trị RaceHub"
                className="grid size-11 place-items-center rounded-full text-fg-muted hover:bg-surface-2 hover:text-fg">
                <ShieldCheck className="size-5" aria-hidden />
              </Link>
            )}
            <NotificationBell userId={profile.id} />
            {/* Chỉ hiện số Xu (ví dùng ở mọi màn); cấp độ + thanh XP nằm ở trang Tôi */}
            <Link href={routes.wallet} className="flex min-h-11 items-center rounded-full border border-border bg-surface px-3" aria-label="Ví Xu của tôi">
              <CoinAmount value={profile.xu} className="text-sm" />
            </Link>
          </div>
        )}
      </div>
    </header>
  )
}
