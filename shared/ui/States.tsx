import type { LucideIcon } from 'lucide-react'
import { AlertTriangle } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from './Button'
import { cn } from '@/shared/lib/cn'

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

export function ErrorState({ message = 'Không tải được dữ liệu.', onRetry }: { message?: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center text-center gap-2 rounded-[var(--radius-card)] border border-danger/30 bg-danger/5 px-6 py-8">
      <AlertTriangle className="size-6 text-danger" aria-hidden />
      <p className="text-sm text-fg-muted">{message}</p>
      {onRetry && <Button size="sm" variant="secondary" onClick={onRetry}>Thử lại</Button>}
    </div>
  )
}
