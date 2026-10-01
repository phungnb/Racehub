'use client'

import { cn } from '@/shared/lib/cn'

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i)
const pad = (n: number) => String(n).padStart(2, '0')

/**
 * Chọn thời gian / pace bằng các cột cuộn (giờ · phút · giây) thay cho gõ "1:05:30" — bàn phím số trên điện thoại không có dấu ":".
 * Dùng <select> gốc: iPhone / Android hiện bánh xe cuộn chọn số. Giá trị là số giây (null = chưa chọn).
 * mode 'pace': phút (2–30) · giây mỗi km; 'time': giờ (0–maxHours) · phút · giây.
 */
export function ClockPicker({ value, onChange, mode = 'time', maxHours = 12, disabled, label, className }: {
  value: number | null; onChange: (seconds: number) => void; mode?: 'time' | 'pace'; maxHours?: number
  disabled?: boolean; label: string; className?: string
}) {
  const v = Math.max(0, Math.round(value ?? 0))
  const h = Math.floor(v / 3600), m = Math.floor((v % 3600) / 60), s = v % 60
  const pace = mode === 'pace'
  const mins = pace ? Math.floor(v / 60) : m
  const set = (nh: number, nm: number, ns: number) => onChange(nh * 3600 + nm * 60 + ns)
  const cols = pace
    ? [
        { key: 'm', unit: 'phút', val: Math.min(Math.max(mins, 2), 30), opts: range(2, 30), fmt: String, pick: (x: number) => set(0, x, s) },
        { key: 's', unit: 'giây', val: s, opts: range(0, 59), fmt: pad, pick: (x: number) => set(0, Math.min(Math.max(mins, 2), 30), x) },
      ]
    : [
        { key: 'h', unit: 'giờ', val: Math.min(h, maxHours), opts: range(0, maxHours), fmt: String, pick: (x: number) => set(x, m, s) },
        { key: 'm', unit: 'phút', val: m, opts: range(0, 59), fmt: pad, pick: (x: number) => set(h, x, s) },
        { key: 's', unit: 'giây', val: s, opts: range(0, 59), fmt: pad, pick: (x: number) => set(h, m, x) },
      ]
  return (
    <div role="group" aria-label={label} className={cn('flex items-center gap-1.5', disabled && 'opacity-60', className)}>
      {cols.map((c, i) => (
        <div key={c.key} className="flex flex-1 items-center gap-1.5">
          {i > 0 && <span aria-hidden className="font-mono text-lg font-bold text-fg-subtle">:</span>}
          <label className="relative flex-1">
            <span className="sr-only">{c.unit}</span>
            <select value={c.val} disabled={disabled} onChange={(e) => c.pick(Number(e.target.value))}
              className="h-12 w-full appearance-none rounded-xl border border-border bg-bg pb-3 text-center font-mono text-lg font-bold text-fg focus:border-brand focus:outline-none">
              {c.opts.map((o) => <option key={o} value={o}>{c.fmt(o)}</option>)}
            </select>
            <span aria-hidden className="pointer-events-none absolute inset-x-0 bottom-1 text-center text-[10px] text-fg-subtle">{c.unit}</span>
          </label>
        </div>
      ))}
      {pace && <span className="shrink-0 text-sm text-fg-muted">/km</span>}
    </div>
  )
}
