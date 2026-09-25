'use client'

import type { LucideIcon } from 'lucide-react'
import { AlertTriangle, LogIn, WifiOff, Wrench } from 'lucide-react'
import type { ReactNode } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { Button } from './Button'
import { cn } from '@/shared/lib/cn'
import { describeError } from '@/shared/lib/errors'

export function EmptyState({ icon: Icon, title, description, action, className }: {
  icon: LucideIcon; title: string; description?: string; action?: ReactNode; className?: string
}) {
  return (
    <div className={cn('flex flex-col items-center text-center gap-2 rounded-[var(--radius-card)] border border-dashed border-border px-6 py-10', className)}>
      <div className="grid size-12 place-items-center rounded-full bg-surface-2 text-fg-muted"><Icon className="size-6" aria-hidden /></div>
      <p className="font-semibold">{title}</p>
      {description && <p className="text-sm text-fg-muted max-w-xs">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}

/**
 * Khung báo lỗi khi không tải được dữ liệu. Truyền `error` để tự nhận loại lỗi (mất mạng, máy chủ lỗi, hết phiên,
 * tính năng chưa cập nhật…) và hiện mã lỗi cho người dùng báo lại; `message` là câu riêng của từng màn (lỗi nghiệp vụ).
 */
export function ErrorState({ message, error, onRetry, className }: { message?: string; error?: unknown; onRetry?: () => void; className?: string }) {
  const router = useRouter()
  const pathname = usePathname()
  const d = error != null ? describeError(error) : null
  const system = d && d.kind !== 'UNKNOWN'
  const title = system ? d.title : 'Không tải được dữ liệu'
  const body = system ? d.message : message ?? d?.message
  const Icon = d?.kind === 'OFFLINE' || d?.kind === 'NETWORK' ? WifiOff : d?.kind === 'AUTH' ? LogIn : d?.kind === 'NOT_DEPLOYED' ? Wrench : AlertTriangle
  return (
    <div role="alert" className={cn('flex flex-col items-center text-center gap-2 rounded-[var(--radius-card)] border border-danger/30 bg-danger/5 px-6 py-8', className)}>
      <Icon className="size-6 text-danger" aria-hidden />
      <p className="font-semibold">{title}</p>
      {body && body !== title && <p className="max-w-xs text-sm text-fg-muted">{body}</p>}
      <div className="mt-1 flex flex-wrap justify-center gap-2">
        {d?.kind === 'AUTH'
          ? <Button size="sm" onClick={() => router.push(`/login?next=${encodeURIComponent(pathname)}`)}>Đăng nhập lại</Button>
          : onRetry && (d?.retryable ?? true) && <Button size="sm" variant="secondary" onClick={onRetry}>Thử lại</Button>}
      </div>
      {d && <p className="font-mono text-[11px] text-fg-subtle">Mã lỗi {d.code}</p>}
    </div>
  )
}
