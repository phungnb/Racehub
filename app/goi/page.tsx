import type { Metadata } from 'next'
import { PlanCompare } from '@/features/billing'
import { HelpBody, HelpShell, type HelpPage } from '@/features/help'
import { createSupabaseServerClient } from '@/shared/lib/supabase-server'
import { loadHelpPage } from '@/shared/lib/help-page-server'

export const metadata: Metadata = {
  title: 'Gói & quyền lợi',
  description: 'So sánh gói Miễn phí, VIP, CLB Pro và Doanh nghiệp của RaceHub.',
}

// Bảng so sánh gói (008500): số liệu lấy từ cấu hình admin; phần "Thông tin thêm" là trang menu "vip-pro" admin tự soạn
export default async function PlansPage() {
  const [notes, signedIn] = await Promise.all([
    loadHelpPage<HelpPage>('vip-pro'),
    createSupabaseServerClient().then((s) => s.auth.getUser()).then((r) => !!r.data.user).catch(() => false),
  ])
  return (
    <HelpShell back={null}>
      <h1 className="flex items-center gap-2 text-2xl font-bold"><span aria-hidden>👑</span>{notes?.title ?? 'Gói & quyền lợi'}</h1>
      <p className="mb-4 mt-1 text-sm text-fg-muted">
        Bắt đầu miễn phí, nâng cấp khi cần. Giá và hạn mức dưới đây luôn là số mới nhất.
      </p>
      <PlanCompare signedIn={signedIn} />
      {notes?.body?.trim() && (
        <section className="mt-8 border-t border-border pt-6">
          <h2 className="mb-3 text-lg font-bold">Thông tin thêm</h2>
          <HelpBody page={notes} />
        </section>
      )}
    </HelpShell>
  )
}
