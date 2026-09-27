import Link from 'next/link'
import type { ReactNode } from 'react'
import { ArrowLeft } from 'lucide-react'
import { CloseButton } from '@/shared/ui/legal/CloseButton'
import { BackLink } from '@/shared/ui/BackLink'
import { StatusBarScrim } from '@/shared/ui/StatusBarScrim'
import { MenuDrawer } from './MenuDrawer'
import { AdminEditLink } from './AdminEditLink'

/** Khung trang Hướng dẫn & Chính sách: đọc được khi chưa đăng nhập, có nút ☰ mở menu */
export function HelpShell({ children, back = '/help', backLabel = 'Hướng dẫn & chính sách', editSlug }: {
  children: ReactNode; back?: string | null; backLabel?: string
  /** Trang menu admin soạn được → hiện nút "Sửa trang này" cho admin */
  editSlug?: string
}) {
  return (
    <main className="mx-auto min-h-dvh max-w-2xl px-4 pb-12 pt-[max(env(safe-area-inset-top),0.5rem)]">
      <StatusBarScrim />
      <nav className="mb-4 flex items-center gap-1">
        <MenuDrawer className="-ml-2" />
        <Link href="/" className="text-lg font-extrabold tracking-wide">RACE<span className="text-brand">HUB</span></Link>
        <CloseButton className="ml-auto" />
      </nav>
      <div className="mb-3 flex items-center justify-between gap-2">
        {back ? (
          <Link href={back} className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-fg-muted hover:text-fg">
            <ArrowLeft className="size-4" aria-hidden />{backLabel}
          </Link>
        ) : <BackLink />}
        {editSlug && <AdminEditLink slug={editSlug} />}
      </div>
      {children}
      <footer className="mt-10 border-t border-border pt-4 text-xs text-fg-subtle">
        Dữ liệu hoạt động từ Strava được hiển thị theo Thỏa thuận API của Strava. RaceHub không phải sản phẩm của Strava.
      </footer>
    </main>
  )
}
