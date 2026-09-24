'use client'

import { useEffect, useId, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { cn } from '@/shared/lib/cn'
import { Button } from './Button'

/** Bảng trượt từ dưới lên (mobile) / hộp giữa màn hình (desktop). Esc hoặc chạm nền để đóng. */
export function Sheet({ open, onClose, title, description, children, footer, className }: {
  open: boolean; onClose: () => void; title: string; description?: string; children?: ReactNode; footer?: ReactNode; className?: string
}) {
  const titleId = useId()
  const panel = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const prev = document.activeElement as HTMLElement | null
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    panel.current?.querySelector<HTMLElement>('input, textarea, button:not([data-close])')?.focus()
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = overflow
      prev?.focus?.()
    }
  }, [open, onClose])

  if (!open) return null
  // Portal ra body: tránh bị kẹt dưới thanh điều hướng khi cha có transform/animation (tạo stacking context)
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center">
      <button aria-label="Đóng" data-close tabIndex={-1} onClick={onClose} className="absolute inset-0 bg-black/60 backdrop-blur-[2px] animate-fade-in" />
      <div ref={panel} role="dialog" aria-modal="true" aria-labelledby={titleId}
        className={cn('relative flex max-h-[88dvh] w-full max-w-md flex-col rounded-t-3xl border border-border bg-surface animate-sheet-up',
          'sm:rounded-3xl pb-[env(safe-area-inset-bottom)]', className)}>
        <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-border sm:hidden" aria-hidden />
        <div className="flex items-start justify-between gap-3 px-5 pb-2 pt-3">
          <div>
            <h2 id={titleId} className="text-lg font-bold">{title}</h2>
            {description && <p className="mt-0.5 text-sm text-fg-muted">{description}</p>}
          </div>
          <button data-close onClick={onClose} aria-label="Đóng"
            className="-mr-2 grid size-11 shrink-0 place-items-center rounded-full text-fg-muted hover:bg-surface-2 hover:text-fg">
            <X className="size-5" aria-hidden />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 pb-4">{children}</div>
        {footer && <div className="border-t border-border px-5 py-3">{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}

/** Hộp xác nhận cho hành động phá hủy (xóa, rời CLB, cấm thành viên) */
export function ConfirmSheet({ open, onClose, onConfirm, title, description, confirmLabel = 'Xác nhận', danger = true, loading, children }: {
  open: boolean; onClose: () => void; onConfirm: () => void; title: string; description?: string
  confirmLabel?: string; danger?: boolean; loading?: boolean; children?: ReactNode
}) {
  return (
    <Sheet open={open} onClose={onClose} title={title} description={description}
      footer={
        <div className="flex gap-2">
          <Button variant="secondary" block onClick={onClose} disabled={loading}>Hủy</Button>
          <Button variant={danger ? 'danger' : 'primary'} block onClick={onConfirm} loading={loading}>{confirmLabel}</Button>
        </div>
      }>
      {children}
    </Sheet>
  )
}
