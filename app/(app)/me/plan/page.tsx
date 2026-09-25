'use client'

import { Suspense } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { PlanScreen } from '@/features/billing'
import { routes } from '@/shared/config/routes'

// Gói VIP & Nạp Xu: mở từ Ví, trang Tôi, thông báo VIP
export default function PlanPage() {
  const router = useRouter()
  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center gap-2">
        <button onClick={() => (window.history.length > 1 ? router.back() : router.push(routes.me))} aria-label="Quay lại"
          className="-ml-2 grid size-11 place-items-center rounded-full text-fg-muted hover:bg-surface-2">
          <ArrowLeft className="size-5" aria-hidden />
        </button>
        <h1 className="text-xl font-bold">Gói VIP & Nạp Xu</h1>
      </div>
      <Suspense><PlanScreen /></Suspense>
    </div>
  )
}
