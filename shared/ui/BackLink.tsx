'use client'

import { useRouter } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { cn } from '@/shared/lib/cn'

/** Nút "← Quay lại" dùng chung: về màn trước trong app; mở thẳng từ link (không có lịch sử) thì về `fallback` */
export function BackLink({ fallback = '/', label = 'Quay lại', className }: { fallback?: string; label?: string; className?: string }) {
  const router = useRouter()
  return (
    <button type="button" onClick={() => (window.history.length > 1 ? router.back() : router.push(fallback))}
      className={cn('-ml-1 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-fg-muted hover:text-fg', className)}>
      <ArrowLeft className="size-5" aria-hidden />{label}
    </button>
  )
}

/** Đầu trang có nút quay lại: màn nào mở ra từ trang khác cũng luôn có lối ra */
export function PageHeader({ title, subtitle, fallback = '/feed', action }: { title: string; subtitle?: string; fallback?: string; action?: React.ReactNode }) {
  const router = useRouter()
  return (
    <div className="flex items-start gap-2">
      <button type="button" onClick={() => (window.history.length > 1 ? router.back() : router.push(fallback))} aria-label="Quay lại"
        className="-ml-2 grid size-11 shrink-0 place-items-center rounded-full text-fg-muted hover:bg-surface-2 hover:text-fg">
        <ArrowLeft className="size-5" aria-hidden />
      </button>
      <div className="min-w-0 flex-1 pt-1.5">
        <h1 className="text-xl font-bold leading-tight">{title}</h1>
        {subtitle && <p className="text-sm text-fg-muted">{subtitle}</p>}
      </div>
      {action}
    </div>
  )
}
