'use client'

import { Check, Coins, Lock } from 'lucide-react'
import { cn } from '@/shared/lib/cn'
import { formatCoin } from '@/shared/lib/format'
import { RARITY_META, SLOTS, type CharacterItem, type ItemStatus } from '../model/catalog'

/** Ô vật phẩm: mẫu màu, độ hiếm, trạng thái (đang mặc / đã có / giá / khóa cấp) */
export function ItemCard({ item, status, selected, onSelect }: {
  item: CharacterItem; status: ItemStatus; selected: boolean; onSelect: () => void
}) {
  const Icon = SLOTS.find((s) => s.slot === item.slot)?.icon
  const r = RARITY_META[item.rarity]
  const c1 = item.color ?? '#9aa6b8', c2 = item.color2 ?? c1
  return (
    <button onClick={onSelect} aria-pressed={selected}
      className={cn('flex w-full flex-col items-center gap-1.5 rounded-2xl border-2 bg-surface p-2.5 text-center transition-colors',
        selected ? 'border-brand' : r.border, status === 'LOCKED' && 'opacity-60')}>
      <span className="relative grid size-14 place-items-center rounded-full"
        style={{ background: `linear-gradient(135deg, ${c1} 0 58%, ${c2} 58% 100%)` }}>
        {Icon && <Icon className="size-6 text-white mix-blend-difference" aria-hidden />}
        {status === 'EQUIPPED' && (
          <span className="absolute -right-1 -top-1 grid size-5 place-items-center rounded-full bg-brand text-brand-fg"><Check className="size-3" aria-hidden /></span>
        )}
      </span>
      <span className="line-clamp-2 min-h-8 text-xs font-semibold leading-tight">{item.name}</span>
      <span className={cn('flex items-center gap-1 text-xs font-semibold', r.text)}>
        {status === 'EQUIPPED' ? <span className="text-brand">Đang mặc</span>
          : status === 'OWNED' ? <span className="text-fg-muted">Đã có</span>
          : status === 'LOCKED' ? <><Lock className="size-3" aria-hidden /><span>Cấp {item.unlock_level}</span></>
          : item.price_xu > 0 ? <span className="flex items-center gap-0.5 font-mono text-coin"><Coins className="size-3" aria-hidden />{formatCoin(item.price_xu)}</span>
          : <span className="text-brand">Miễn phí</span>}
      </span>
    </button>
  )
}
