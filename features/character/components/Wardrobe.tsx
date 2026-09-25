'use client'

import Link from 'next/link'
import { useMemo, useRef, useState } from 'react'
import { ArrowLeft, ChevronRight, Coins, Lock, RotateCcw, UserRound, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button, ConfirmSheet, ErrorState, Skeleton } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { formatCoin } from '@/shared/lib/format'
import { routes } from '@/shared/config/routes'
import { characterErrorMessage } from '../api/characterApi'
import { useBuyItem, useCharacterState, useSaveCharacter } from '../hooks/useCharacter'
import {
  itemStatus, outfitDiff, RARITY_META, resolveOutfit, SLOTS,
  type CharacterItem, type CharacterState, type Slot,
} from '../model/catalog'
import { ItemCard } from './ItemCard'
import { PaperDoll } from './PaperDoll'

/** Tủ đồ & Shop: xem nhân vật, thử màu trước khi mua, mua bằng Xu, lưu cả bộ */
export function Wardrobe() {
  const q = useCharacterState()
  if (q.isPending) return <div className="space-y-3"><Skeleton className="h-10" /><Skeleton className="h-[46vh]" /><Skeleton className="h-64" /></div>
  if (q.isError) return <ErrorState message={characterErrorMessage(q.error)} error={q.error} onRetry={() => void q.refetch()} />
  return <Editor state={q.data} />
}

function Editor({ state }: { state: CharacterState }) {
  const items = state.items
  // Chỉ hiện ô có vật phẩm (ô mới như Mũ/Kính tự xuất hiện khi admin thêm món lớp ảnh)
  const tabs = useMemo(() => SLOTS.filter((s) => items.some((i) => i.slot === s.slot)), [items])
  const [tab, setTab] = useState<Slot>(tabs[0]?.slot ?? 'top')
  // Nhân vật đi theo giới tính trong hồ sơ (Cài đặt), không chọn riêng ở đây
  const gender = state.gender
  const [draft, setDraft] = useState<Partial<Record<Slot, string>>>(state.equipped)
  const [buying, setBuying] = useState<CharacterItem | null>(null)
  const buyKey = useRef(`shop-${crypto.randomUUID()}`)
  const buy = useBuyItem()
  const save = useSaveCharacter()

  const byCode = useMemo(() => new Map(items.map((i) => [i.code, i])), [items])
  const outfit = useMemo(() => resolveOutfit(items, draft), [items, draft])
  const diff = outfitDiff(state.equipped, draft)
  const unowned = outfit.filter((i) => !i.owned)
  const dirty = Object.keys(diff).length > 0

  const trying = byCode.get(draft[tab] ?? '')
  const tryingUnowned = trying && !trying.owned ? trying : unowned[0]

  const select = (it: CharacterItem) => setDraft((d) => ({ ...d, [it.slot]: it.code }))
  const unequip = (slot: Slot) => setDraft((d) => { const n = { ...d }; delete n[slot]; return n })
  const reset = () => setDraft(state.equipped)

  const doSave = async () => {
    try {
      await save.mutateAsync({ look: {}, equipped: diff })
      toast.success('Đã lưu bộ đồ')
    } catch (e) {
      toast.error(characterErrorMessage(e))
    }
  }
  const doBuy = async () => {
    if (!buying) return
    try {
      await buy.mutateAsync({ code: buying.code, key: buyKey.current })
      buyKey.current = `shop-${crypto.randomUUID()}`
      toast.success(`Đã mua ${buying.name}`)
    } catch (e) {
      toast.error(characterErrorMessage(e))
    }
    setBuying(null)
  }

  const slotMeta = SLOTS.find((s) => s.slot === tab)
  const list = items.filter((i) => i.slot === tab)
  const status = (i: CharacterItem) => itemStatus(i, state.level, state.equipped)

  return (
    <div className="space-y-3 pb-36">
      <div className="flex items-center gap-2">
        <Link href={`${routes.me}?tab=character`} aria-label="Quay lại" className="-ml-2 grid size-11 place-items-center rounded-full text-fg-muted hover:bg-surface-2">
          <ArrowLeft className="size-5" aria-hidden />
        </Link>
        <h1 className="text-xl font-bold">Tủ đồ</h1>
        <Link href={routes.wallet} className="ml-auto flex items-center gap-1.5 rounded-full border border-coin/40 bg-coin/10 px-3 py-1.5 text-sm font-semibold text-coin">
          <Coins className="size-4" aria-hidden /><span className="font-mono">{formatCoin(state.balance)}</span>
        </Link>
      </div>

      {/* Nhân vật + hàng ô đồ dính trên cùng khi cuộn danh sách */}
      <div className="sticky top-[var(--topbar-h)] z-20 -mx-4 space-y-2 bg-bg px-4 pb-2 pt-2">
        <div className="relative h-[40vh] min-h-64 overflow-hidden rounded-3xl border border-border bg-[#c4c4ce]">
          <PaperDoll gender={gender} items={outfit} className="size-full" label="Nhân vật của bạn" />
          {tryingUnowned && (
            <span className="absolute left-3 top-3 max-w-[55%] truncate rounded-full bg-bg/85 px-3 py-1 text-xs font-semibold text-coin backdrop-blur">
              Đang thử: {tryingUnowned.name}
            </span>
          )}
          <Link href={routes.settings} className="absolute right-3 top-3 flex items-center gap-1 rounded-full bg-bg/85 px-3 py-1.5 text-xs font-semibold text-fg-muted backdrop-blur hover:text-fg">
            {gender === 'female' ? 'Nữ' : 'Nam'}<ChevronRight className="size-3.5" aria-hidden />
          </Link>
        </div>

        <nav role="tablist" aria-label="Ô trang phục" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
          {tabs.map((t) => (
            <button key={t.slot} role="tab" aria-selected={tab === t.slot} onClick={() => setTab(t.slot)}
              className={cn('flex shrink-0 items-center gap-1.5 rounded-full border px-4 py-2 text-sm font-semibold',
                tab === t.slot ? 'border-brand bg-brand text-brand-fg' : 'border-border text-fg-muted hover:text-fg')}>
              <t.icon className="size-4" aria-hidden />{t.label}
            </button>
          ))}
        </nav>
      </div>

      {state.gender_set === false && <GenderNudge />}

      {list.length === 0 ? (
        <p className="py-10 text-center text-sm text-fg-muted">Chưa có vật phẩm cho ô này.</p>
      ) : (
        <ul className="grid grid-cols-3 gap-2">
          {!slotMeta?.required && (
            <li>
              <button onClick={() => unequip(tab)} aria-pressed={!draft[tab]}
                className={cn('flex h-full w-full flex-col items-center justify-center gap-1.5 rounded-2xl border-2 border-dashed p-2.5 text-xs font-semibold text-fg-muted',
                  !draft[tab] ? 'border-brand' : 'border-border')}>
                <X className="size-6" aria-hidden />Không đeo
              </button>
            </li>
          )}
          {list.map((it) => (
            <li key={it.code}>
              <ItemCard item={it} gender={gender} status={status(it)} selected={draft[tab] === it.code} onSelect={() => select(it)} />
            </li>
          ))}
        </ul>
      )}

      {/* Thanh hành động */}
      <div className="fixed inset-x-0 bottom-[calc(3.5rem+1px+env(safe-area-inset-bottom))] z-30 mx-auto max-w-md border-t border-border bg-bg/95 px-4 py-3 backdrop-blur-md">
        {tryingUnowned ? (
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{tryingUnowned.name}</p>
              <p className={cn('truncate text-xs', RARITY_META[tryingUnowned.rarity].text)}>
                {RARITY_META[tryingUnowned.rarity].label}{tryingUnowned.description ? ` · ${tryingUnowned.description}` : ''}
              </p>
            </div>
            <Button variant="secondary" className="shrink-0"
              onClick={() => setDraft((d) => ({ ...d, [tryingUnowned.slot]: state.equipped[tryingUnowned.slot] }))}>Bỏ thử</Button>
            {state.level < tryingUnowned.unlock_level ? (
              <Button className="shrink-0" disabled><Lock className="size-4" aria-hidden />Cấp {tryingUnowned.unlock_level}</Button>
            ) : (
              <Button variant="coin" className="shrink-0" onClick={() => setBuying(tryingUnowned)} disabled={state.balance < tryingUnowned.price_xu}>
                <Coins className="size-4" aria-hidden />{tryingUnowned.price_xu > 0 ? `Mua ${formatCoin(tryingUnowned.price_xu)}` : 'Nhận'}
              </Button>
            )}
          </div>
        ) : (
          <div className="flex gap-2">
            <Button variant="secondary" className="shrink-0" onClick={reset} disabled={!dirty || save.isPending} aria-label="Hoàn tác">
              <RotateCcw className="size-4" aria-hidden />
            </Button>
            <Button block onClick={doSave} disabled={!dirty} loading={save.isPending}>{dirty ? 'Lưu bộ đồ' : 'Đã lưu'}</Button>
          </div>
        )}
      </div>

      <ConfirmSheet open={!!buying} onClose={() => setBuying(null)} onConfirm={doBuy} loading={buy.isPending} danger={false}
        title={buying ? `Mua ${buying.name}?` : ''} confirmLabel={buying?.price_xu ? `Mua ${formatCoin(buying.price_xu)} Xu` : 'Nhận'}
        description={buying ? `Ví còn ${formatCoin(state.balance - (buying.price_xu ?? 0))} Xu sau khi mua. Vật phẩm là của bạn vĩnh viễn.` : undefined} />
    </div>
  )
}

/** Chưa khai giới tính: nhắc chọn trong Cài đặt để nhân vật đúng với mình */
export function GenderNudge() {
  return (
    <Link href={routes.settings} className="flex items-center gap-3 rounded-2xl border border-brand/40 bg-brand/10 p-3">
      <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-brand/20 text-brand"><UserRound className="size-5" aria-hidden /></span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold">Chọn giới tính của bạn</span>
        <span className="block text-xs text-fg-muted">Nhân vật sẽ đổi theo giới tính trong hồ sơ</span>
      </span>
      <ChevronRight className="size-5 text-fg-subtle" aria-hidden />
    </Link>
  )
}
