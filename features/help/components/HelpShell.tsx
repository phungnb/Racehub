import Link from 'next/link'
import type { ReactNode } from 'react'
import { ArrowLeft } from 'lucide-react'
import { MenuDrawer } from './MenuDrawer'

/** Khung trang Hướng dẫn & Chính sách: đọc được khi chưa đăng nhập, có nút ☰ mở menu */
export function HelpShell({ children, back = '/help', backLabel = 'Hướng dẫn & chính sách' }: { children: ReactNode; back?: string | null; backLabel?: string }) {
  return (
    <main className="mx-auto min-h-dvh max-w-2xl px-4 pb-12 pt-[max(env(safe-area-inset-top),0.5rem)]">
      <nav className="mb-4 flex items-center gap-1">
        <MenuDrawer className="-ml-2" />
        <Link href="/" className="text-lg font-extrabold tracking-wide">RACE<span className="text-brand">HUB</span></Link>
      </nav>
      {back && (
        <Link href={back} className="mb-3 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-fg-muted hover:text-fg">
          <ArrowLeft className="size-4" aria-hidden />{backLabel}
        </Link>
      )}
      {children}
      <footer className="mt-10 border-t border-border pt-4 text-xs text-fg-subtle">
        Dữ liệu hoạt động từ Strava được hiển thị theo Thỏa thuận API của Strava. RaceHub không phải sản phẩm của Strava.
      </footer>
    </main>
  )
}
