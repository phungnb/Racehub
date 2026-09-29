'use client'

import Link from 'next/link'
import { useState, type ReactNode } from 'react'
import { ChevronRight, Lock } from 'lucide-react'
import { Button, Sheet } from '@/shared/ui'
import { routes } from '@/shared/config/routes'
import { PurchaseOnly } from '@/features/system'

/**
 * Tính năng CLB Pro khi CLB đang ở gói Miễn phí: vẫn hiện nút để ban quản trị biết có tính năng này,
 * bấm vào KHÔNG mở công cụ mà báo "CLB chưa đủ điều kiện" + đường nâng cấp.
 */
export function ProLockedButton({ icon, label, feature, onUpgrade }: { icon: ReactNode; label: string; feature: string; onUpgrade?: () => void }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}
        className="flex min-h-11 w-full items-center gap-3 rounded-xl border border-dashed border-border px-3 py-2 text-left text-sm text-fg-muted hover:border-coin/50">
        <span className="shrink-0 text-fg-subtle">{icon}</span>
        <span className="min-w-0 flex-1 font-medium">{label}</span>
        <Lock className="size-4 shrink-0 text-coin" aria-label="Cần CLB Pro" />
      </button>
      {open && (
        <Sheet open onClose={() => setOpen(false)} title="CLB chưa đủ điều kiện"
          description={`Hiện tại CLB đang dùng gói Miễn phí nên chưa dùng được ${feature}. Tính năng này dành cho CLB Pro.`}
          footer={<PurchaseOnly><div className="grid gap-2">
            {onUpgrade && <Button block variant="coin" onClick={() => { setOpen(false); onUpgrade() }}>Nâng cấp CLB Pro</Button>}
            <Link href={routes.plans} className="flex h-11 items-center justify-center gap-1 rounded-xl border border-border text-sm font-semibold">
              So sánh gói Miễn phí và Pro<ChevronRight className="size-4" aria-hidden />
            </Link>
          </div></PurchaseOnly>}>
          <PurchaseOnly fallback={<p className="text-sm text-fg-muted">Khi CLB lên Pro, mọi tính năng Pro mở ngay cho cả ban quản trị. Dữ liệu CLB giữ nguyên.</p>}>
            <p className="text-sm text-fg-muted">Nâng cấp xong, mọi tính năng Pro mở ngay cho cả ban quản trị. Dữ liệu CLB giữ nguyên.</p>
          </PurchaseOnly>
        </Sheet>
      )}
    </>
  )
}
