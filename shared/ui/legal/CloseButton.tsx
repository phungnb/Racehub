'use client'

import { useRouter } from 'next/navigation'
import { X } from 'lucide-react'
import { cn } from '@/shared/lib/cn'

/** Nút ✕ của trang đọc (hướng dẫn / chính sách): quay lại màn trước trong app; mở thẳng từ link thì về trang chủ */
export function CloseButton({ className, label = 'Đóng' }: { className?: string; label?: string }) {
  const router = useRouter()
  const close = () => {
    if (window.history.length > 1) router.back()
    else router.push('/')
  }
  return (
    <button type="button" onClick={close} aria-label={label}
      className={cn('grid size-11 shrink-0 place-items-center rounded-full border border-border bg-surface text-fg-muted hover:text-fg', className)}>
      <X className="size-5" aria-hidden />
    </button>
  )
}
