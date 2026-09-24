'use client'

import { Suspense } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { InsightsScreen } from '@/features/insights'
import { routes } from '@/shared/config/routes'

// Phân tích cá nhân (VIP): mở từ trang Tôi và trang Gói VIP
export default function InsightsPage() {
  const router = useRouter()
  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center gap-2">
        <button onClick={() => (window.history.length > 1 ? router.back() : router.push(routes.me))} aria-label="Quay lại"
          className="-ml-2 grid size-11 place-items-center rounded-full text-fg-muted hover:bg-surface-2">
          <ArrowLeft className="size-5" aria-hidden />
        </button>
        <h1 className="text-xl font-bold">Phân tích của tôi</h1>
      </div>
      <Suspense><InsightsScreen /></Suspense>
    </div>
  )
}
