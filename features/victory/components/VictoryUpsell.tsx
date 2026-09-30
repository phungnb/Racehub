'use client'

import Link from 'next/link'
import { Lock, Sparkles } from 'lucide-react'
import { cn } from '@/shared/lib/cn'
import { routes } from '@/shared/config/routes'

/** Victory Studio là tính năng trả phí: thẻ giải thích + nút nâng cấp cho gói Free */
export function VictoryUpsell({ className, compact }: { className?: string; compact?: boolean }) {
  return (
    <div className={cn('rounded-2xl border border-coin/40 bg-gradient-to-br from-coin/15 via-surface to-surface p-4', className)}>
      <p className="flex items-center gap-2 font-bold"><Lock className="size-4 text-coin" aria-hidden />Victory Studio — gói nâng cấp</p>
      <p className="mt-1 text-sm text-fg-muted">
        Thiết kế ảnh vinh danh chuyên nghiệp (12 mẫu, 5 khổ ảnh, mã QR xác thực) dành cho runner <b>VIP</b>, thành viên
        <b> CLB Pro</b> hoặc <b>doanh nghiệp</b>, và mọi người tham gia giải do CLB Pro tổ chức.
      </p>
      {!compact && (
        <p className="mt-1 text-sm text-fg-muted">Gói Free vẫn lưu được ảnh vinh danh thông thường ở tab <b>Vinh danh</b> của thử thách và ảnh chia sẻ bài chạy.</p>
      )}
      <Link href={routes.plans} className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-xl bg-coin px-4 text-sm font-bold text-black hover:opacity-90">
        <Sparkles className="size-4" aria-hidden />Xem gói nâng cấp
      </Link>
    </div>
  )
}
