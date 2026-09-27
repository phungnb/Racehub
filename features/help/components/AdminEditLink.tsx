'use client'

import Link from 'next/link'
import { Pencil } from 'lucide-react'
import { useMyProfile } from '@/features/auth'
import { cn } from '@/shared/lib/cn'
import { routes } from '@/shared/config/routes'

/**
 * Nút "Sửa trang này" trên các trang menu ☰ — chỉ admin hệ thống thấy, mở thẳng trình soạn trong Quản trị.
 * Chỉ để ẩn/hiện; quyền thật kiểm tra trong RPC admin_help_save (is_system_admin).
 */
export function AdminEditLink({ slug, className }: { slug: string; className?: string }) {
  const { profile } = useMyProfile()
  if (!(profile?.role === 'SYSTEM_ADMIN' || profile?.is_admin === true)) return null
  return (
    <Link href={`${routes.admin}?tab=help&edit=${encodeURIComponent(slug)}`}
      className={cn('inline-flex min-h-9 items-center gap-1.5 rounded-full border border-brand/40 bg-brand/10 px-3 text-xs font-semibold text-brand', className)}>
      <Pencil className="size-3.5" aria-hidden />Sửa trang này
    </Link>
  )
}
