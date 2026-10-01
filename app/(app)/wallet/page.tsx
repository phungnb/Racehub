'use client'

import { useRouter } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { WalletView } from '@/features/game'
import { ContactFab } from '@/features/help'
import { PurchaseOnly } from '@/features/system'
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
      <PurchaseOnly><ContactFab withNav title="Cần hỗ trợ nạp Xu?" note="Chuyển khoản chưa nhận Xu, cần hoá đơn hay hỏi về gói nạp: nhắn admin." /></PurchaseOnly>
    </div>
  )
}
