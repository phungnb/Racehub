'use client'

import { useRouter } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { WalletView } from '@/features/game'
import { routes } from '@/shared/config/routes'

// Ví Xu (MH25): màn riêng, mở từ ô Xu trên thanh trên cùng và từ trang Tôi
export default function WalletPage() {
  const router = useRouter()
  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center gap-2">
        <button onClick={() => (window.history.length > 1 ? router.back() : router.push(routes.me))} aria-label="Quay lại"
          className="-ml-2 grid size-11 place-items-center rounded-full text-fg-muted hover:bg-surface-2">
          <ArrowLeft className="size-5" aria-hidden />
        </button>
        <h1 className="text-xl font-bold">Ví Xu</h1>
      </div>
      <WalletView />
    </div>
  )
}
