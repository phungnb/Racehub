'use client'

import Link from 'next/link'
import { ChevronRight, Shirt } from 'lucide-react'
import { Button, Card, ErrorState, Skeleton } from '@/shared/ui'
import { levelDef } from '@/features/progression'
import { routes } from '@/shared/config/routes'
import { characterErrorMessage } from '../api/characterApi'
import { useCharacterState } from '../hooks/useCharacter'
import { useViewerItems } from './useOutfit'
import { Viewer } from './Viewer'

/** Thẻ nhân vật trong trang Tôi: xem nhân vật 3D, mở tủ đồ */
export function CharacterHub() {
  const q = useCharacterState()
  const items = useViewerItems(q.data?.items, q.data?.equipped ?? {}, q.data?.gender ?? 'male')
  if (q.isPending) return <Skeleton className="h-[26rem]" />
  if (q.isError) return <ErrorState message={characterErrorMessage(q.error)} onRetry={() => void q.refetch()} />
  const s = q.data
  const owned = s.items.filter((i) => i.owned).length
  const next = s.items.filter((i) => !i.owned && i.unlock_level > s.level && i.price_xu === 0).sort((a, b) => a.unlock_level - b.unlock_level)[0]
  return (
    <div className="space-y-3">
      <Card className="overflow-hidden p-0">
        <div className="relative h-80 bg-gradient-to-b from-surface-2 via-surface to-brand/10">
          <Viewer gender={s.gender} skinTone={s.skin_tone} hairColor={s.hair_color} items={items} className="size-full" />
          <span className="absolute left-3 top-3 rounded-full bg-bg/70 px-3 py-1 text-xs font-semibold backdrop-blur">
            Lv.{s.level} · {levelDef(s.level).name}
          </span>
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
