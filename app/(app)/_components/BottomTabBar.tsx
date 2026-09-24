'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Home, Trophy, Zap, Shield, User, type LucideIcon } from 'lucide-react'
import { cn } from '@/shared/lib/cn'
import { routes } from '@/shared/config/routes'

const TABS: { href: string; label: string; icon: LucideIcon }[] = [
  { href: routes.feed, label: 'Trang chủ', icon: Home },
  { href: routes.challenges, label: 'Thử thách', icon: Trophy },
  { href: routes.run, label: 'Chạy', icon: Zap },
  { href: routes.clubs, label: 'CLB', icon: Shield },
  { href: routes.me, label: 'Tôi', icon: User },
]

export function BottomTabBar() {
  const pathname = usePathname()
  return (
    <nav aria-label="Điều hướng chính"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-bg/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-lg">
      <ul className="mx-auto grid max-w-md grid-cols-5 items-end px-2">
        {TABS.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`)
          const isRun = href === routes.run
          return (
            <li key={href} className="flex justify-center">
              <Link href={href} aria-current={active ? 'page' : undefined}
                className={cn('flex min-h-14 min-w-14 flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition-colors',
                  active ? 'text-brand' : 'text-fg-subtle hover:text-fg')}>
                {isRun ? (
                  <span className={cn('-mt-6 grid size-14 place-items-center rounded-full bg-brand text-brand-fg shadow-lg shadow-brand/20',
                    !active && 'animate-breath')}>
                    <Icon className="size-6" aria-hidden />
                  </span>
                ) : (
                  <Icon className="size-6" aria-hidden />
                )}
                <span className={cn(isRun && 'sr-only')}>{label}</span>
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
