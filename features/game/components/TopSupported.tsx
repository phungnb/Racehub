'use client'

import { HandHeart } from 'lucide-react'
import { Avatar, Card } from '@/shared/ui'
import { formatCoin } from '@/shared/lib/format'
import { useChallengeTopSupported } from '../hooks/useGame'

/** "Được tiếp sức nhiều nhất" trong một thử thách: 3 người nhận nhiều quà nhất trong thời gian thử thách */
export function TopSupported({ challengeId }: { challengeId: string }) {
  const q = useChallengeTopSupported(challengeId)
  if (!q.data?.length) return null
  return (
    <Card className="space-y-2 p-3">
      <p className="flex items-center gap-2 text-sm font-semibold"><HandHeart className="size-4 text-coin" aria-hidden />Được tiếp sức nhiều nhất</p>
      <ol className="space-y-1.5">
        {q.data.map((u, i) => (
          <li key={u.user_id} className="flex items-center gap-2.5">
            <span className="w-4 text-center font-mono text-xs text-fg-subtle">{i + 1}</span>
            <Avatar src={u.avatar_url} name={u.display_name} size="sm" shine={u.tier} />
            <span className="min-w-0 flex-1 truncate text-sm">{u.display_name ?? 'Runner'}</span>
            <span className="font-mono text-xs text-coin">✨ {formatCoin(u.shine)} · {u.gifts} quà</span>
          </li>
        ))}
      </ol>
    </Card>
  )
}
