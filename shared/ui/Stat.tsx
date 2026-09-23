import { cn } from '@/shared/lib/cn'

/** Ô thống kê: nhãn nhỏ + số lớn (font mono) + đơn vị */
export function StatTile({ label, value, unit, tone = 'default', className }: {
  label: string; value: string; unit?: string; tone?: 'default' | 'brand' | 'coin' | 'xp'; className?: string
}) {
  const toneClass = { default: 'text-fg', brand: 'text-brand', coin: 'text-coin', xp: 'text-xp' }[tone]
  return (
    <div className={cn('rounded-xl bg-bg/60 border border-border px-3 py-2.5', className)}>
      <p className="text-[11px] uppercase tracking-wide text-fg-subtle">{label}</p>
      <p className={cn('font-mono tabular text-xl font-bold leading-tight', toneClass)}>
        {value}{unit && <span className="ml-1 text-xs font-medium text-fg-muted">{unit}</span>}
      </p>
    </div>
  )
}

export function ProgressBar({ value, max, className, tone = 'brand' }: { value: number; max: number; className?: string; tone?: 'brand' | 'xp' }) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0
  return (
    <div className={cn('h-2 w-full overflow-hidden rounded-full bg-surface-2', className)} role="progressbar"
      aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      <div className={cn('h-full rounded-full transition-[width] duration-700', tone === 'brand' ? 'bg-brand' : 'bg-xp')} style={{ width: `${pct}%` }} />
    </div>
  )
}
