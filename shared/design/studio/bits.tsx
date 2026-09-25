'use client'

// Mảnh giao diện nhỏ dùng chung cho trình thiết kế BIB / chứng nhận
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ImagePlus, X } from 'lucide-react'
import { cn } from '@/shared/lib/cn'
import { COLOR_KEYS, isHex, paint, type Paint, type Palette } from '../engine'

export function Section({ title, hint, children, action }: { title: string; hint?: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="space-y-3 rounded-2xl border border-border bg-surface-2/40 p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-bold">{title}</h3>
          {hint && <p className="text-[11px] text-fg-muted">{hint}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex items-center gap-3 rounded-xl border border-border p-3 text-sm">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="size-5 accent-[var(--color-brand)]" />
      {label}
    </label>
  )
}

export function Chips<T extends string>({ label, value, options, onChange }: { label?: string; value: T | null; options: Record<T, string>; onChange: (v: T) => void }) {
  return (
    <div className="space-y-1.5">
      {label && <p className="text-xs font-medium text-fg-muted">{label}</p>}
      <div className="flex flex-wrap gap-1.5" role="group" aria-label={label}>
        {(Object.keys(options) as T[]).map((k) => (
          <button key={k} type="button" aria-pressed={value === k} onClick={() => onChange(k)}
            className={cn('rounded-full border px-3 py-1.5 text-xs font-semibold', value === k ? 'border-brand bg-brand/15 text-fg' : 'border-border text-fg-muted')}>
            {options[k]}
          </button>
        ))}
      </div>
    </div>
  )
}

export function Slider({ label, value, min, max, step = 1, unit = '', onChange }: {
  label: string; value: number; min: number; max: number; step?: number; unit?: string; onChange: (v: number) => void
}) {
  return (
    <label className="block space-y-1">
      <span className="flex justify-between text-xs font-medium text-fg-muted"><span>{label}</span><span className="tabular-nums">{value}{unit}</span></span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-[var(--color-brand)]" aria-label={label} />
    </label>
  )
}

export function Pill({ on, onClick, children, title }: { on: boolean; onClick: () => void; children: ReactNode; title?: string }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick} title={title}
      className={cn('rounded-full border px-3 py-1.5 text-xs font-semibold', on ? 'border-brand bg-brand/15 text-fg' : 'border-border text-fg-muted')}>
      {children}
    </button>
  )
}

/** Chọn màu: 5 màu của bảng màu thiết kế + màu tự chọn */
export function PaintPicker({ label, value, palette, labels, onChange }: {
  label: string; value: Paint; palette: Palette; labels: Record<string, string>; onChange: (v: Paint) => void
}) {
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-fg-muted">{label}</p>
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label={label}>
        {COLOR_KEYS.map((c) => (
          <button key={c} type="button" aria-pressed={value === c} onClick={() => onChange(c)} title={labels[c]} aria-label={`${label}: ${labels[c]}`}
            className={cn('size-8 rounded-full border-2', value === c ? 'border-brand ring-2 ring-brand/40' : 'border-border')} style={{ background: palette[c] }} />
        ))}
        <label title="Màu khác" className={cn('relative grid size-8 cursor-pointer place-items-center overflow-hidden rounded-full border-2',
          isHex(value) ? 'border-brand ring-2 ring-brand/40' : 'border-dashed border-border')}
          style={{ background: isHex(value) ? value : 'conic-gradient(red, yellow, lime, cyan, blue, magenta, red)' }}>
          <input type="color" value={paint(value, palette)} onChange={(e) => onChange(e.target.value)} className="absolute inset-0 cursor-pointer opacity-0" aria-label={`${label}: màu khác`} />
        </label>
      </div>
    </div>
  )
}

export function useImageSize(url: string | null) {
  const [size, setSize] = useState<{ url: string; w: number; h: number } | null>(null)
  useEffect(() => {
    if (!url) return
    const im = new Image()
    im.onload = () => setSize({ url, w: im.naturalWidth, h: im.naturalHeight })
    im.src = url
  }, [url])
  return size && size.url === url ? size : null
}

/** Kích thước ảnh từ file (để giữ đúng tỉ lệ logo khi thêm) */
export function imageAspect(url: string): Promise<number> {
  return new Promise((resolve) => {
    const im = new Image()
    im.onload = () => resolve(im.naturalWidth && im.naturalHeight ? im.naturalWidth / im.naturalHeight : 1)
    im.onerror = () => resolve(1)
    im.src = url
  })
}

export function FileButton({ children, onPick, className, disabled, label }: {
  children: ReactNode; onPick: (f: File | undefined) => void; className?: string; disabled?: boolean; label?: string
}) {
  const input = useRef<HTMLInputElement>(null)
  return (
    <>
      <button type="button" onClick={() => input.current?.click()} disabled={disabled} className={className} aria-label={label}>{children}</button>
      <input ref={input} type="file" hidden accept="image/*" onChange={(e) => { onPick(e.target.files?.[0]); e.target.value = '' }} />
    </>
  )
}

export function ImagePick({ label, url, busy, onPick, onClear }: { label: string; url: string | null; busy: boolean; onPick: (f: File | undefined) => void; onClear: () => void }) {
  return (
    <div className="space-y-1">
      <p className="text-sm font-medium text-fg-muted">{label}</p>
      <div className="relative">
        <FileButton onPick={onPick} disabled={busy} label={label}
          className="grid h-24 w-full place-items-center overflow-hidden rounded-xl border border-dashed border-border bg-surface-2 text-xs text-fg-muted">
          {/* eslint-disable-next-line @next/next/no-img-element -- ảnh vừa tải lên kho race-media */}
          {url ? <img src={url} alt={label} className="h-full w-full object-contain" />
            : <span className="flex flex-col items-center gap-1"><ImagePlus className="size-5" aria-hidden />{busy ? 'Đang tải…' : 'Chọn ảnh'}</span>}
        </FileButton>
        {url && <button type="button" onClick={onClear} aria-label={`Bỏ ${label}`} className="absolute right-1 top-1 grid size-6 place-items-center rounded-full bg-bg/80"><X className="size-3.5" aria-hidden /></button>}
      </div>
    </div>
  )
}
