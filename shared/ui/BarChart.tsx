'use client'

import { useId, useState } from 'react'
import { cn } from '@/shared/lib/cn'

// Màu đã kiểm bằng validate_palette (nền tối #121720): đủ dải sáng, tách màu cho người mù màu, tương phản ≥ 3:1.
export const CHART_COLORS = ['#6b8cf5', '#c07e10'] as const

export interface BarSeries { name: string; values: number[]; color?: string }

/**
 * Biểu đồ cột SVG gọn: 1–2 chuỗi (cột cạnh nhau), trục y một thang, lưới mờ, nhãn trục x thưa,
 * rê / chạm để xem giá trị từng cột, có bảng số liệu thay thế cho trình đọc màn hình.
 */
export function BarChart({ labels, series, format = (v) => String(v), height = 160, className, caption, tickEvery }: {
  labels: string[]; series: BarSeries[]; format?: (v: number) => string; height?: number; className?: string
  caption: string; tickEvery?: number
}) {
  const id = useId()
  const [hover, setHover] = useState<number | null>(null)
  const W = 320, H = height, top = 8, bottom = 18, left = 4, right = 4
  const n = labels.length
  const max = Math.max(1, ...series.flatMap((s) => s.values))
  const nice = niceMax(max)
  const plotH = H - top - bottom
  const col = (W - left - right) / Math.max(n, 1)
  const gap = 2
  const barW = Math.max(2, (col - 4 - gap * (series.length - 1)) / series.length)
  const every = tickEvery ?? Math.max(1, Math.ceil(n / 6))
  const y = (v: number) => top + plotH - (v / nice) * plotH
  const bar = (x: number, v: number) => {
    const h = Math.max(0, (v / nice) * plotH)
    if (h <= 0) return ''
    const r = Math.min(4, barW / 2, h)
    const y0 = top + plotH
    return `M${x},${y0} V${y0 - h + r} Q${x},${y0 - h} ${x + r},${y0 - h} H${x + barW - r} Q${x + barW},${y0 - h} ${x + barW},${y0 - h + r} V${y0} Z`
  }
  return (
    <figure className={cn('space-y-2', className)}>
      {series.length > 1 && (
        <figcaption className="flex flex-wrap gap-3 text-xs text-fg-muted">
          {series.map((s, i) => (
            <span key={s.name} className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-sm" style={{ background: s.color ?? CHART_COLORS[i] }} aria-hidden />{s.name}
            </span>
          ))}
        </figcaption>
      )}
      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-labelledby={`${id}-t`} onMouseLeave={() => setHover(null)}>
          <title id={`${id}-t`}>{caption}</title>
          {[0.5, 1].map((f) => (
            <g key={f}>
              <line x1={left} x2={W - right} y1={y(nice * f)} y2={y(nice * f)} stroke="var(--color-border)" strokeWidth={1} strokeDasharray="2 3" />
            </g>
          ))}
          <line x1={left} x2={W - right} y1={top + plotH} y2={top + plotH} stroke="var(--color-border)" strokeWidth={1} />
          {labels.map((l, i) => {
            const x0 = left + i * col + 2
            return (
              <g key={l + i}>
                {hover === i && <rect x={x0 - 2} y={top} width={col} height={plotH} fill="var(--color-surface-2)" opacity={0.6} />}
                {series.map((s, k) => (
                  <path key={s.name} d={bar(x0 + k * (barW + gap), s.values[i] ?? 0)} fill={s.color ?? CHART_COLORS[k]} />
                ))}
                {i % every === (n - 1) % every && (
                  <text x={x0 + (col - 4) / 2} y={H - 5} textAnchor="middle" fontSize={8} fill="var(--color-fg-subtle)">{l}</text>
                )}
                <rect x={x0 - 2} y={0} width={col} height={H} fill="transparent" onMouseEnter={() => setHover(i)} onClick={() => setHover(i)} />
              </g>
            )
          })}
          {[0.5, 1].map((f) => (
            <text key={f} x={W - right} y={y(nice * f) - 2} textAnchor="end" fontSize={8} fill="var(--color-fg-muted)" pointerEvents="none"
              stroke="var(--color-surface)" strokeWidth={3} paintOrder="stroke">{format(nice * f)}</text>
          ))}
        </svg>
        {hover !== null && (
          <div className="pointer-events-none absolute top-0 rounded-lg border border-border bg-surface px-2 py-1 text-xs shadow-lg"
            style={{ left: `${Math.min(70, Math.max(0, ((hover + 0.5) / n) * 100 - 15))}%` }}>
            <p className="font-semibold text-fg">{labels[hover]}</p>
            {series.map((s, k) => (
              <p key={s.name} className="flex items-center gap-1.5 text-fg-muted">
                {series.length > 1 && <span className="size-2 rounded-sm" style={{ background: s.color ?? CHART_COLORS[k] }} aria-hidden />}
                {series.length > 1 ? `${s.name}: ` : ''}<span className="font-mono text-fg">{format(s.values[hover] ?? 0)}</span>
              </p>
            ))}
          </div>
        )}
      </div>
      <details className="text-xs text-fg-muted">
        <summary className="cursor-pointer select-none">Xem bảng số liệu</summary>
        <table className="mt-1 w-full">
          <thead><tr><th className="py-1 text-left font-medium">Kỳ</th>{series.map((s) => <th key={s.name} className="py-1 text-right font-medium">{s.name}</th>)}</tr></thead>
          <tbody>
            {labels.map((l, i) => (
              <tr key={l + i} className="border-t border-border">
                <td className="py-1">{l}</td>
                {series.map((s) => <td key={s.name} className="py-1 text-right font-mono text-fg">{format(s.values[i] ?? 0)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  )
}

/** Làm tròn đỉnh trục lên số "đẹp": 1, 2, 2.5, 5 × 10^k */
export function niceMax(v: number) {
  if (!(v > 0)) return 1
  const p = 10 ** Math.floor(Math.log10(v))
  const m = v / p
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p
}
