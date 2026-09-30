'use client'

import Link from 'next/link'
import { Award, ImageIcon, UsersRound, type LucideIcon } from 'lucide-react'
import { cn } from '@/shared/lib/cn'
import { routes } from '@/shared/config/routes'

/**
 * Ba lối vinh danh đặt ngang hàng trên trang thử thách:
 * - Ảnh hành trình: runner tự tạo ảnh cho chặng của mình
 * - Vinh danh thành viên: BTC chọn bất kỳ ai, đặt danh hiệu riêng
 * - Vinh danh thử thách: thiết kế ảnh tôn vinh cả giải (Top, hạng mục BTC công bố) — studio riêng như 2 mục trên
 */
export function HonorShortcuts({ journey, completed, members, board, challengeId }: {
  journey: boolean; completed: boolean; members: boolean; board: boolean; challengeId: string
}) {
  const items: { key: string; icon: LucideIcon; title: string; sub: string; href: string; tone: string }[] = []
  if (journey) items.push({
    key: 'journey', icon: ImageIcon, title: completed ? 'Ảnh vinh danh' : 'Ảnh hành trình', sub: 'Của riêng bạn',
    href: routes.victoryCreate('CHALLENGE', challengeId), tone: 'from-coin/25 to-brand/25 text-fg',
  })
  if (members) items.push({
    key: 'members', icon: UsersRound, title: 'Vinh danh thành viên', sub: 'Chọn runner, đặt danh hiệu',
    href: routes.victoryCreate('CHALLENGE', challengeId, { pick: true }), tone: 'from-brand/20 to-xp/20 text-fg',
  })
  if (board) items.push({
    key: 'board', icon: Award, title: 'Vinh danh thử thách', sub: 'Ảnh tôn vinh cả giải',
    href: routes.challengeHonorStudio(challengeId), tone: 'from-success/20 to-coin/20 text-fg',
  })
  if (items.length === 0) return null
  return (
    <section aria-label="Vinh danh" className={cn('grid gap-2', items.length === 1 ? 'grid-cols-1' : items.length === 2 ? 'grid-cols-2' : 'grid-cols-3')}>
      {items.map((it) => {
        const body = (
          <>
            <it.icon className="size-5 shrink-0" aria-hidden />
            <span className="text-[13px] font-bold leading-tight">{it.title}</span>
            <span className="text-[11px] leading-tight text-fg-muted">{it.sub}</span>
          </>
        )
        const cls = cn('flex min-h-[5.5rem] flex-col items-center justify-center gap-1 rounded-2xl border border-border bg-gradient-to-br p-2 text-center hover:opacity-90', it.tone)
        return <Link key={it.key} href={it.href} className={cls}>{body}</Link>
      })}
    </section>
  )
}
