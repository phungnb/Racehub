'use client'

import { cn } from '@/shared/lib/cn'

export function SegmentedControl<T extends string>({ value, onChange, options, className }: {
  value: T; onChange: (v: T) => void; options: { value: T; label: string; count?: number }[]; className?: string
}) {
  return (
    <div role="tablist" className={cn('flex gap-1 rounded-xl bg-surface p-1', className)}>
      {options.map((o) => (
        <button key={o.value} role="tab" aria-selected={value === o.value} onClick={() => onChange(o.value)}
          className={cn('flex min-w-0 flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-2 py-2 text-sm font-semibold transition-colors',
            value === o.value ? 'bg-surface-2 text-fg shadow-sm' : 'text-fg-subtle hover:text-fg')}>
          {o.label}
          {o.count !== undefined && <span className={cn('rounded-full px-1.5 text-xs', value === o.value ? 'bg-brand text-brand-fg' : 'bg-surface-2')}>{o.count}</span>}
        </button>
      ))}
    </div>
  )
}
