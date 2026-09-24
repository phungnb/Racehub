import { forwardRef, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react'
import { cn } from '@/shared/lib/cn'

const base = 'w-full rounded-xl border border-border bg-bg px-3.5 text-[15px] text-fg placeholder:text-fg-subtle ' +
  'transition-colors focus:border-brand focus:outline-none disabled:opacity-60'

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...props }, ref) {
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
