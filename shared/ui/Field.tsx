import { forwardRef, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react'
import { cn } from '@/shared/lib/cn'

const base = 'w-full rounded-xl border border-border bg-bg px-3.5 text-[15px] text-fg placeholder:text-fg-subtle ' +
  'transition-colors focus:border-brand focus:outline-none disabled:opacity-60'

/** "2026-10-03" → "03/10/2026"; "2026-10-03T07:30" → "03/10/2026 07:30" */
export function viDateText(v: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(v)
  if (!m) return v
  return `${m[3]}/${m[2]}/${m[1]}${m[4] ? ` ${m[4]}:${m[5]}` : ''}`
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...props }, ref) {
  // Ô ngày: trình duyệt hiện theo ngôn ngữ máy (có máy ra mm/dd/yyyy) → phủ chữ dd/mm/yyyy lên trên, bấm vẫn mở lịch gốc
  if ((props.type === 'date' || props.type === 'datetime-local') && typeof props.value === 'string') {
    const text = props.value ? viDateText(props.value) : props.type === 'date' ? 'dd/mm/yyyy' : 'dd/mm/yyyy --:--'
    const width = className?.split(/\s+/).filter((c) => /^(w-|max-w-|min-w-|flex-|basis-)/.test(c)).join(' ')
    return (
      <div className={cn('relative w-full', width)}>
        <input ref={ref} className={cn(base, 'h-11 text-transparent caret-transparent', className)} {...props}
          onClick={(e) => { try { e.currentTarget.showPicker?.() } catch { /* trình duyệt cũ: tự mở khi chạm */ } props.onClick?.(e) }} />
        <span aria-hidden className={cn('pointer-events-none absolute inset-y-0 left-3.5 right-10 flex items-center truncate text-[15px]',
          props.value ? 'text-fg' : 'text-fg-subtle', props.disabled && 'opacity-60')}>{text}</span>
      </div>
    )
  }
  return <input ref={ref} className={cn(base, 'h-11', className)} {...props} />
})

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...props }, ref) {
  return <textarea ref={ref} className={cn(base, 'min-h-24 resize-none py-2.5 leading-relaxed', className)} {...props} />
})

/** Nhãn + ô nhập + gợi ý / lỗi */
export function Field({ label, hint, error, children, htmlFor }: {
  label: string; hint?: ReactNode; error?: string | null; children: ReactNode; htmlFor?: string
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-sm font-medium text-fg-muted">{label}</label>
      {children}
      {error ? <p role="alert" className="text-xs text-danger">{error}</p> : hint ? <p className="text-xs text-fg-subtle">{hint}</p> : null}
    </div>
  )
}
