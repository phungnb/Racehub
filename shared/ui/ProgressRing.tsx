import type { ReactNode } from 'react'
import { cn } from '@/shared/lib/cn'

/** Vòng tiến độ kiểu đồng hồ thể thao. value: 0–1 (lớn hơn 1 vẫn vẽ đầy). */
export function ProgressRing({ value, size = 120, stroke = 10, color = 'var(--color-brand)', track = 'var(--color-surface-2)',
  label, children, className }: {
  value: number; size?: number; stroke?: number; color?: string; track?: string; label: string; children?: ReactNode; className?: string
}) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const v = Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0))
  return (
    <div className={cn('relative inline-grid place-items-center', className)} style={{ width: size, height: size }}
      role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(v * 100)}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - v)} className="transition-[stroke-dashoffset] duration-700 ease-out" />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">{children}</div>
    </div>
  )
}
