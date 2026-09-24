'use client'

import type { LucideIcon } from 'lucide-react'
import { cn } from '@/shared/lib/cn'

/** Công tắc bật/tắt dạng một dòng (nhãn + mô tả + công tắc), vùng bấm cả dòng ≥ 44px */
export function SwitchRow({ checked, onChange, label, description, icon: Icon, disabled, className }: {
  checked: boolean; onChange: (v: boolean) => void; label: string; description?: string; icon?: LucideIcon; disabled?: boolean; className?: string
}) {
  return (
    <button type="button" role="switch" aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)}
      className={cn('flex min-h-11 w-full items-center gap-3 py-2 text-left disabled:opacity-50', className)}>
      {Icon && (
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-surface-2 text-fg-muted"><Icon className="size-[18px]" aria-hidden /></span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold">{label}</span>
        {description && <span className="block text-xs text-fg-muted">{description}</span>}
      </span>
      <span className={cn('h-6 w-10 shrink-0 rounded-full p-0.5 transition-colors', checked ? 'bg-brand' : 'bg-surface-2 ring-1 ring-inset ring-border')} aria-hidden>
        <span className={cn('block size-5 rounded-full transition-transform', checked ? 'translate-x-4 bg-brand-fg' : 'bg-fg-subtle')} />
      </span>
    </button>
  )
}
