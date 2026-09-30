'use client'

import Link from 'next/link'
import { Lock, Trophy } from 'lucide-react'
import { cn } from '@/shared/lib/cn'
import { routes } from '@/shared/config/routes'
import type { VicKind } from '../model/victory'
import { useVictoryAccess } from '../hooks/useVictoryAccess'

/** Nút "Tạo ảnh vinh danh" đặt ngay chỗ runner vừa đạt thành tích (thử thách, bài chạy, huy hiệu…) */
export function VictoryButton({ kind, refId, label = 'Tạo ảnh vinh danh', pick, className }: {
  kind: VicKind; refId: string; label?: string; pick?: boolean; className?: string
}) {
  const access = useVictoryAccess(kind === 'CHALLENGE' ? refId : null)
  return (
    <Link href={routes.victoryCreate(kind, refId, { pick })}
      className={cn('inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-coin to-brand px-4 text-sm font-bold text-black shadow-sm hover:opacity-90', className)}>
      <Trophy className="size-4" aria-hidden />{label}
      {!access.unlocked && <Lock className="size-3.5 opacity-70" aria-label="Gói nâng cấp" />}
    </Link>
  )
}
