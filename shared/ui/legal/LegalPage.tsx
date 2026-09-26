import Link from 'next/link'
import type { ReactNode } from 'react'
import { CloseButton } from './CloseButton'

export const LEGAL_UPDATED = '25/09/2026'
/** Email hỗ trợ (đặt NEXT_PUBLIC_SUPPORT_EMAIL trên Vercel); chưa đặt thì hướng dẫn liên hệ trong app */
export const SUPPORT_EMAIL = (process.env.NEXT_PUBLIC_SUPPORT_EMAIL ?? '').trim()

export function Contact() {
  return SUPPORT_EMAIL
    ? <>email <a className="text-brand underline" href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a></>
    : <>mục Cài đặt → Hỗ trợ trong ứng dụng, hoặc nhắn trực tiếp cho Ban quản trị RaceHub</>
}

/** Khung trang pháp lý: đọc được khi chưa đăng nhập, dễ đọc trên điện thoại */
export function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="mx-auto min-h-dvh max-w-2xl px-5 py-8">
      <nav className="mb-6 flex items-center justify-between text-sm">
        <Link href="/" className="font-black tracking-tight text-brand">RACEHUB</Link>
        <span className="flex gap-4 text-fg-muted">
          <Link href="/help" className="hover:text-fg">Hướng dẫn</Link>
          <Link href="/privacy" className="hover:text-fg">Quyền riêng tư</Link>
          <Link href="/terms" className="hover:text-fg">Điều khoản</Link>
          <CloseButton className="-my-2 size-9" />
        </span>
      </nav>
      <h1 className="text-2xl font-bold">{title}</h1>
      <p className="mt-1 text-sm text-fg-muted">Cập nhật lần cuối: {LEGAL_UPDATED}</p>
      <article className="mt-6 space-y-6 text-[15px] leading-relaxed text-fg-muted [&_h2]:mb-2 [&_h2]:text-lg [&_h2]:font-bold [&_h2]:text-fg [&_li]:ml-5 [&_li]:list-disc [&_strong]:text-fg">
        {children}
      </article>
      <footer className="mt-10 border-t border-border pt-4 text-xs text-fg-subtle">
        Dữ liệu hoạt động từ Strava được hiển thị theo Thỏa thuận API của Strava. RaceHub không phải sản phẩm của Strava.
      </footer>
    </main>
  )
}
