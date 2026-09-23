'use client'

import Link from 'next/link'
import { useMemo, useRef, useState } from 'react'
import { ArrowLeft, Coins, Footprints, Hand, Lock, PersonStanding, RotateCcw, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button, ConfirmSheet, ErrorState, Skeleton } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { formatCoin } from '@/shared/lib/format'
import { routes } from '@/shared/config/routes'
import { characterErrorMessage } from '../api/characterApi'
import { useBuyItem, useCharacterState, useSaveCharacter } from '../hooks/useCharacter'
import {
  HAIR_COLORS, itemStatus, LOOK_TAB, outfitDiff, RARITY_META, SKIN_TONES, SLOTS,
  type AnimationName, type CharacterItem, type CharacterState, type Gender, type Slot,
} from '../model/catalog'
import { ItemCard } from './ItemCard'
import { useViewerItems } from './useOutfit'
import { Viewer } from './Viewer'

type Tab = 'look' | Slot
const ANIMS: { value: AnimationName; label: string; icon: typeof Hand }[] = [
  { value: 'Idle', label: 'Đứng', icon: PersonStanding },
  { value: 'Run', label: 'Chạy', icon: Footprints },
  { value: 'Wave', label: 'Vẫy tay', icon: Hand },
]

/** Tủ đồ & Shop: xem nhân vật 3D, thử đồ trước khi mua, mua bằng Xu, lưu cả bộ */
export function Wardrobe() {
  const q = useCharacterState()
  if (q.isPending) return <div className="space-y-3"><Skeleton className="h-[46vh]" /><Skeleton className="h-10" /><Skeleton className="h-64" /></div>
  if (q.isError) return <ErrorState message={characterErrorMessage(q.error)} onRetry={() => void q.refetch()} />
  return <Editor state={q.data} />
}

function Editor({ state }: { state: CharacterState }) {
  const [tab, setTab] = useState<Tab>('top')
  const [anim, setAnim] = useState<AnimationName>('Idle')
  const [gender, setGender] = useState<Gender>(state.gender)
  const [skin, setSkin] = useState(state.skin_tone)
  const [hair, setHair] = useState(state.hair_color)
  const [draft, setDraft] = useState<Partial<Record<Slot, string>>>(state.equipped)
  const [buying, setBuying] = useState<CharacterItem | null>(null)
  const buyKey = useRef(`shop-${crypto.randomUUID()}`)
  const buy = useBuyItem()
  const save = useSaveCharacter()

  const items = state.items
  const byCode = useMemo(() => new Map(items.map((i) => [i.code, i])), [items])
  const viewerItems = useViewerItems(items, draft, gender)
  const diff = outfitDiff(state.equipped, draft)
  const lookChanged = gender !== state.gender || skin !== state.skin_tone || hair !== state.hair_color
  const unowned = Object.values(draft).map((c) => (c ? byCode.get(c) : undefined)).filter((i): i is CharacterItem => !!i && !i.owned)
  const dirty = lookChanged || Object.keys(diff).length > 0

  const trying = tab !== 'look' ? byCode.get(draft[tab] ?? '') : undefined
  const tryingUnowned = trying && !trying.owned ? trying : unowned[0]

  const select = (it: CharacterItem) => setDraft((d) => ({ ...d, [it.slot]: it.code }))
  const unequip = (slot: Slot) => setDraft((d) => { const n = { ...d }; delete n[slot]; return n })
  const reset = () => { setDraft(state.equipped); setGender(state.gender); setSkin(state.skin_tone); setHair(state.hair_color) }

  const doSave = async () => {
    try {
      await save.mutateAsync({ look: { gender, skin_tone: skin, hair_color: hair }, equipped: diff })
      setAnim('Wave')
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
      setBuying(null)
    } catch (e) {
      toast.error(characterErrorMessage(e))
      setBuying(null)
    }
  }

  const slotMeta = SLOTS.find((s) => s.slot === tab)
  const list = tab === 'look' ? [] : items.filter((i) => i.slot === tab)
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

      {/* Khung nhân vật + hàng ô đồ dính trên cùng khi cuộn danh sách đồ */}
      <div className="sticky top-[var(--topbar-h)] z-20 -mx-4 space-y-2 bg-bg px-4 pb-2 pt-2">
      <div className="relative h-[34vh] min-h-56 overflow-hidden rounded-3xl border border-border bg-gradient-to-b from-surface-2 via-surface to-brand/10">
        <Viewer gender={gender} skinTone={skin} hairColor={hair} items={viewerItems} animation={anim} interactive className="size-full" />
        <div className="absolute bottom-3 left-3 flex gap-1 rounded-full bg-bg/70 p-1 backdrop-blur" role="radiogroup" aria-label="Hoạt ảnh">
          {ANIMS.map((a) => (
            <button key={a.value} role="radio" aria-checked={anim === a.value} aria-label={a.label} onClick={() => setAnim(a.value)}
              className={cn('grid size-9 place-items-center rounded-full', anim === a.value ? 'bg-brand text-brand-fg' : 'text-fg-muted')}>
              <a.icon className="size-4" aria-hidden />
            </button>
          ))}
        </div>
        <span className="absolute bottom-4 right-4 text-xs text-fg-subtle">Kéo để xoay</span>
        {tryingUnowned && (
          <span className="absolute left-3 top-3 rounded-full bg-bg/80 px-3 py-1 text-xs font-semibold text-coin backdrop-blur">Đang thử: {tryingUnowned.name}</span>
        )}
      </div>

      <nav role="tablist" aria-label="Ô trang phục" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
        {[{ key: 'look' as Tab, label: LOOK_TAB.label, icon: LOOK_TAB.icon }, ...SLOTS.map((s) => ({ key: s.slot as Tab, label: s.label, icon: s.icon }))].map((t) => (
          <button key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)}
            className={cn('flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-2 text-sm font-semibold',
              tab === t.key ? 'border-brand bg-brand text-brand-fg' : 'border-border text-fg-muted hover:text-fg')}>
            <t.icon className="size-4" aria-hidden />{t.label}
          </button>
        ))}
      </nav>
      </div>

      {tab === 'look' ? (
        <LookPanel gender={gender} setGender={setGender} skin={skin} setSkin={setSkin} hair={hair} setHair={setHair} />
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
              <ItemCard item={it} status={status(it)} selected={draft[tab] === it.code} onSelect={() => select(it)} />
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
              <p className={cn('text-xs', RARITY_META[tryingUnowned.rarity].text)}>
                {RARITY_META[tryingUnowned.rarity].label}{tryingUnowned.description ? ` · ${tryingUnowned.description}` : ''}
              </p>
            </div>
            <Button variant="secondary" className="shrink-0" onClick={() => setDraft((d) => ({ ...d, [tryingUnowned.slot]: state.equipped[tryingUnowned.slot] }))}>Bỏ thử</Button>
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

function LookPanel({ gender, setGender, skin, setSkin, hair, setHair }: {
  gender: Gender; setGender: (g: Gender) => void; skin: string; setSkin: (c: string) => void; hair: string; setHair: (c: string) => void
}) {
  return (
    <div className="space-y-5">
      <section className="space-y-2">
        <p className="text-sm font-semibold text-fg-muted">Dáng người</p>
        <div role="radiogroup" className="grid grid-cols-2 gap-2">
          {([['male', 'Nam'], ['female', 'Nữ']] as const).map(([g, label]) => (
            <button key={g} role="radio" aria-checked={gender === g} onClick={() => setGender(g)}
              className={cn('h-11 rounded-xl border text-sm font-semibold', gender === g ? 'border-brand bg-brand/10' : 'border-border text-fg-muted')}>
              {label}
            </button>
          ))}
        </div>
      </section>
      <Swatches label="Màu da" colors={SKIN_TONES} value={skin} onChange={setSkin} />
      <Swatches label="Màu tóc" colors={HAIR_COLORS} value={hair} onChange={setHair} />
    </div>
  )
}

function Swatches({ label, colors, value, onChange }: { label: string; colors: string[]; value: string; onChange: (c: string) => void }) {
  return (
    <section className="space-y-2">
      <p className="text-sm font-semibold text-fg-muted">{label}</p>
      <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-2.5">
        {colors.map((c) => (
          <button key={c} role="radio" aria-checked={value.toLowerCase() === c} aria-label={c} onClick={() => onChange(c)}
            className={cn('size-11 rounded-full border-2 ring-offset-2 ring-offset-bg', value.toLowerCase() === c ? 'border-bg ring-2 ring-brand' : 'border-border')}
            style={{ background: c }} />
        ))}
      </div>
    </section>
  )
}
