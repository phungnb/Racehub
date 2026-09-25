'use client'

import Link from 'next/link'
import { ChevronRight, EyeOff, Sparkles } from 'lucide-react'
import { Avatar, Card, ShineBadge } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { formatCoin, formatNumber } from '@/shared/lib/format'
import { routes } from '@/shared/config/routes'
import { useGiftWall } from '../hooks/useGame'
import type { GiftTier } from '../api/gameApi'

/** Tầng quà = độ hiếm trong bộ sưu tập */
const RARITY: Record<GiftTier, { label: string; tone: string }> = {
  CHEER: { label: 'Thường', tone: 'text-fg-muted' },
  BOOST: { label: 'Hiếm', tone: 'text-sky-300' },
  HYPE: { label: 'Sử thi', tone: 'text-rarity-epic' },
  LEGEND: { label: 'Huyền thoại', tone: 'text-coin' },
}

/** Tường quà trên hồ sơ: bậc Tỏa sáng, bộ sưu tập theo độ hiếm, quà đã nhận, người ủng hộ nhiều nhất */
export function GiftWall({ userId, isMe = false }: { userId: string; isMe?: boolean }) {
  const q = useGiftWall(userId)
  const w = q.data
  if (!w || (w.count === 0 && !w.hidden)) return isMe ? <ShineLink /> : null
  if (w.hidden) {
    return (
      <Card className="flex items-center gap-3">
        <EyeOff className="size-5 text-fg-subtle" aria-hidden />
        <p className="flex-1 text-sm text-fg-muted">Tường quà được ẩn</p>
        {w.tier > 0 && <ShineBadge tier={w.tier} />}
      </Card>
    )
  }
  return (
    <Card className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-2 font-semibold"><Sparkles className="size-4 text-coin" aria-hidden />Tường quà {w.tier > 0 && <ShineBadge tier={w.tier} />}</p>
        <p className="text-right text-sm text-fg-muted"><span className="font-mono font-bold text-coin">{formatCoin(w.shine)}</span> Tỏa sáng · {formatCoin(w.count)} quà</p>
      </div>
      {w.collection.length > 0 && (
        <div className="grid grid-cols-4 gap-1.5 text-center">
          {w.collection.map((c) => (
            <div key={c.tier} className="rounded-lg bg-bg/50 px-1 py-1.5">
              <p className={cn('text-[11px] font-semibold', RARITY[c.tier]?.tone)}>{RARITY[c.tier]?.label ?? c.tier}</p>
              <p className="font-mono text-xs text-fg-muted">{c.owned}/{c.total}</p>
            </div>
          ))}
        </div>
      )}
      <ul className="flex flex-wrap gap-2">
        {w.gifts.map((g) => (
          <li key={g.code} title={`${g.name} · ${RARITY[g.tier]?.label ?? ''}`} className="flex items-center gap-1 rounded-full border border-border bg-bg/60 px-2.5 py-1 text-sm">
            <span aria-hidden>{g.emoji}</span><span className="sr-only">{g.name}</span>
            <span className="font-mono text-xs text-fg-muted">×{formatCoin(g.count)}</span>
          </li>
        ))}
      </ul>
      {w.top_supporters.length > 0 && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-fg-subtle">Ủng hộ nhiều nhất · {formatNumber(w.fans)} người hâm mộ</span>
          <div className="flex -space-x-2">
            {w.top_supporters.map((t) => (
              <Avatar key={t.user_id} src={t.avatar_url} name={t.display_name ?? 'Runner'} size="sm" className="ring-2 ring-surface" />
            ))}
          </div>
        </div>
      )}
      {isMe && <ShineLink />}
    </Card>
  )
}

function ShineLink() {
  return (
    <Link href={routes.shine} className="flex items-center gap-2 rounded-xl border border-coin/40 bg-coin/10 px-3 py-2.5 text-sm font-semibold">
      <Sparkles className="size-4 text-coin" aria-hidden />
      <span className="flex-1">Ví Tỏa sáng — đổi quà nhận được lấy lượt tạo thử thách, khiên, vật phẩm</span>
      <ChevronRight className="size-4 text-fg-muted" aria-hidden />
    </Link>
  )
}
