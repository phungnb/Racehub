import type { Metadata } from 'next'
import Link from 'next/link'
import { EnterpriseLanding } from '@/features/org'
import { HelpBody, MenuDrawer, type HelpPage } from '@/features/help'
import { loadHelpPage } from '@/shared/lib/help-page-server'

export const metadata: Metadata = {
  title: 'RaceHub Doanh nghiệp',
  description: 'Phong trào chạy bộ cho doanh nghiệp, liên đoàn và trường học: chiến dịch, xếp hạng phòng ban, quản lý nhiều CLB, báo cáo cho nhân sự.',
}

// Trang giới thiệu gói Doanh nghiệp (công khai) + form báo giá — migration 008300
export default async function EnterprisePage() {
  // Phần "Tìm hiểu thêm": trang menu "doanh-nghiep" admin tự soạn (008500)
  const more = await loadHelpPage<HelpPage>('doanh-nghiep')
  return (
    <>
      <nav className="mx-auto flex max-w-3xl items-center gap-1 px-4 pt-[max(env(safe-area-inset-top),0.5rem)]">
        <MenuDrawer className="-ml-2" />
        <Link href="/" className="text-lg font-extrabold tracking-wide">RACE<span className="text-brand">HUB</span></Link>
      </nav>
      <EnterpriseLanding more={more?.body?.trim() ? <HelpBody page={more} /> : null} />
    </>
  )
}
