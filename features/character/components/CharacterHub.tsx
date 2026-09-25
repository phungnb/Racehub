'use client'

import Link from 'next/link'
import { ChevronRight, Shirt } from 'lucide-react'
import { Button, Card, ErrorState, Skeleton } from '@/shared/ui'
import { routes } from '@/shared/config/routes'
import { characterErrorMessage } from '../api/characterApi'
import { useCharacterState } from '../hooks/useCharacter'
import { resolveOutfit } from '../model/catalog'
import { PaperDoll } from './PaperDoll'
import { GenderNudge } from './Wardrobe'

/** Thẻ nhân vật trong trang Tôi: xem nhân vật, mở tủ đồ */
export function CharacterHub() {
  const q = useCharacterState()
  if (q.isPending) return <Skeleton className="h-[26rem]" />
  if (q.isError) return <ErrorState message={characterErrorMessage(q.error)} error={q.error} onRetry={() => void q.refetch()} />
  const s = q.data
  const owned = s.items.filter((i) => i.owned).length
  const next = s.items.filter((i) => !i.owned && i.unlock_level > s.level && i.price_xu === 0).sort((a, b) => a.unlock_level - b.unlock_level)[0]
  return (
    <div className="space-y-3">
      {s.gender_set === false && <GenderNudge />}
      <Card className="overflow-hidden p-0">
        <div className="relative h-96 bg-[#c4c4ce]">
          <PaperDoll gender={s.gender} items={resolveOutfit(s.items, s.equipped)} className="size-full" label="Nhân vật của bạn" />
        </div>
        <div className="space-y-3 p-4">
          <p className="text-sm text-fg-muted">Tủ đồ có <b className="font-mono text-fg">{owned}</b>/{s.items.length} vật phẩm</p>
          <Link href={routes.character} className="block"><Button block><Shirt className="size-4" aria-hidden />Mở tủ đồ</Button></Link>
        </div>
      </Card>
      {next && (
        <Link href={routes.character} className="block">
          <Card className="flex items-center gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-xp/15 font-mono text-sm font-bold text-xp">Lv{next.unlock_level}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold">Quà cấp {next.unlock_level}: {next.name}</span>
              <span className="block text-xs text-fg-muted">Lên cấp để nhận miễn phí</span>
            </span>
            <ChevronRight className="size-5 text-fg-subtle" aria-hidden />
          </Card>
        </Link>
      )}
    </div>
  )
}
