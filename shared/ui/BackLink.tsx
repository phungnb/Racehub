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
