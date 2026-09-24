'use client'

import { Sparkles } from 'lucide-react'
import { Avatar, Card } from '@/shared/ui'
import { formatCoin } from '@/shared/lib/format'
import { useGiftWall } from '../hooks/useGame'

/** Tường quà trên hồ sơ: điểm Tỏa sáng, các quà đã nhận, người ủng hộ nhiều nhất */
export function GiftWall({ userId }: { userId: string }) {
  const q = useGiftWall(userId)
  const w = q.data
  if (!w || w.count === 0) return null
  return (
    <Card className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="flex items-center gap-2 font-semibold"><Sparkles className="size-4 text-coin" aria-hidden />Tường quà</p>
        <p className="text-sm text-fg-muted"><span className="font-mono font-bold text-coin">{formatCoin(w.shine)}</span> Tỏa sáng · {formatCoin(w.count)} quà</p>
      </div>
      <ul className="flex flex-wrap gap-2">
        {w.gifts.map((g) => (
          <li key={g.code} title={g.name} className="flex items-center gap-1 rounded-full border border-border bg-bg/60 px-2.5 py-1 text-sm">
            <span aria-hidden>{g.emoji}</span><span className="sr-only">{g.name}</span>
            <span className="font-mono text-xs text-fg-muted">×{formatCoin(g.count)}</span>
          </li>
        ))}
      </ul>
      {w.top_supporters.length > 0 && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-fg-subtle">Ủng hộ nhiều nhất</span>
          <div className="flex -space-x-2">
            {w.top_supporters.map((t) => (
              <Avatar key={t.user_id} src={t.avatar_url} name={t.display_name ?? 'Runner'} size="sm" className="ring-2 ring-surface" />
            ))}
          </div>
        </div>
      )}
    </Card>
  )
}
