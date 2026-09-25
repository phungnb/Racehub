'use client'

import Link from 'next/link'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ChevronRight, Coins, Gift, Lock, RotateCcw, Shirt, Sparkles, Timer, UserRound, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button, ConfirmSheet, ErrorState, Skeleton } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { formatCoin } from '@/shared/lib/format'
import { routes } from '@/shared/config/routes'
import { characterErrorMessage } from '../api/characterApi'
import { useBuyBundle, useBuyItem, useCharacterState, useSaveCharacter, useTryItem } from '../hooks/useCharacter'
import {
  BODIES, bodiesFor, bodyOf, baseUrl, buyPrice, layerUrl, canTry, itemStatus, LOCK_LABEL, outfitDiff, RARITY_META, resolveOutfit, SLOTS,
  type Body, type CharacterItem, type CharacterState, type ItemBundle, type ItemOffer, type Slot,
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
  // Dáng nhân vật (bộ sưu tập nhân vật): chọn trong tủ đồ, lưu cùng bộ đồ
  const savedBody = bodyOf(gender, state.body)
  const [body, setBody] = useState<Body>(savedBody)
  const [draft, setDraft] = useState<Partial<Record<Slot, string>>>(state.equipped)
  const [buying, setBuying] = useState<CharacterItem | null>(null)
  const buyKey = useRef(`shop-${crypto.randomUUID()}`)
  const buy = useBuyItem()
  const tryOn = useTryItem()
  const buyB = useBuyBundle()
  const [bundle, setBundle] = useState<ItemBundle | null>(null)
  const save = useSaveCharacter()

  const byCode = useMemo(() => new Map(items.map((i) => [i.code, i])), [items])
  const outfit = useMemo(() => resolveOutfit(items, draft), [items, draft])
  const diff = outfitDiff(state.equipped, draft)
  const [now] = useState(() => Date.now())
  const unowned = outfit.filter((i) => !i.owned && !(i.trial_until && Date.parse(i.trial_until) > now))
  const dirty = Object.keys(diff).length > 0 || body !== savedBody

  const trying = byCode.get(draft[tab] ?? '')
  const tryingUnowned = trying && unowned.includes(trying) ? trying : unowned[0]

  const select = (it: CharacterItem) => setDraft((d) => ({ ...d, [it.slot]: it.code }))
  const unequip = (slot: Slot) => setDraft((d) => { const n = { ...d }; delete n[slot]; return n })
  const reset = () => { setDraft(state.equipped); setBody(savedBody) }

  const doSave = async () => {
    try {
      await save.mutateAsync({ look: body !== savedBody ? { body } : {}, equipped: diff })
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

  const doTry = async (it: CharacterItem) => {
    try { const r = await tryOn.mutateAsync(it.code); toast.success(`Đang mặc thử ${it.name} tới ${new Date(r.expires_at).toLocaleDateString('vi-VN')}`, { description: 'Bấm Lưu bộ đồ để mặc ra ngoài.' }) }
    catch (e) { toast.error(characterErrorMessage(e)) }
  }
  const doBundle = async () => {
    if (!bundle) return
    try { const r = await buyB.mutateAsync({ id: bundle.id, key: `bundle-${crypto.randomUUID()}` }); toast.success(`Đã nhận ${r.items} món trong ${bundle.title}`) }
    catch (e) { toast.error(characterErrorMessage(e)) }
    setBundle(null)
  }
  // Bộ đồng phục (cùng mã bộ, ≥ 2 món): mặc thử một chạm, mua phần còn thiếu
  const kits = useMemo(() => {
    const m = new Map<string, CharacterItem[]>()
    for (const i of items) if (i.kit) m.set(i.kit, [...(m.get(i.kit) ?? []), i])
    return [...m.entries()].filter(([, l]) => l.length >= 2).map(([code, l]) => {
      const top = l.find((i) => i.slot === 'top') ?? l[0]
      return { code, items: SLOTS.flatMap((x) => l.filter((i) => i.slot === x.slot)), title: top.club_name ? `Đồng phục ${top.club_name}` : top.name }
    })
  }, [items])
  const [buyingKit, setBuyingKit] = useState(false)
  const buyKit = async (list: CharacterItem[]) => {
    setBuyingKit(true)
    try {
      for (const i of list) await buy.mutateAsync({ code: i.code, key: `kit-${i.code}-${crypto.randomUUID()}` })
      toast.success('Đã đủ bộ đồng phục', { description: 'Bấm Lưu bộ đồ để mặc ra ngoài.' })
    } catch (e) {
      toast.error(characterErrorMessage(e))
    } finally {
      setBuyingKit(false)
    }
  }
  const slotMeta = SLOTS.find((s) => s.slot === tab)
  const [col, setCol] = useState<string | null>(null)
  const collections = state.collections ?? []
  const list = items.filter((i) => i.slot === tab && (!col || i.collection?.code === col))
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
          <PaperDoll gender={body} items={outfit} personalName={state.display_name} className="size-full" label="Nhân vật của bạn" />
          {tryingUnowned && (
            <span className="absolute left-3 top-3 max-w-[55%] truncate rounded-full bg-bg/85 px-3 py-1 text-xs font-semibold text-coin backdrop-blur">
              Đang thử: {tryingUnowned.name}
            </span>
          )}
          <Link href={routes.settings} className="absolute right-3 top-3 flex items-center gap-1 rounded-full bg-bg/85 px-3 py-1.5 text-xs font-semibold text-fg-muted backdrop-blur hover:text-fg">
            {gender === 'female' ? 'Nữ' : 'Nam'}<ChevronRight className="size-3.5" aria-hidden />
          </Link>
        </div>

        <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 [scrollbar-width:none]" role="radiogroup" aria-label="Dáng nhân vật">
          {bodiesFor(gender).map((b) => (
            <button key={b} type="button" role="radio" aria-checked={body === b} onClick={() => setBody(b)}
              className={cn('flex shrink-0 items-center gap-1.5 rounded-full border py-1 pl-1 pr-3 text-xs font-semibold',
                body === b ? 'border-brand bg-brand/15 text-fg' : 'border-border text-fg-muted')}>
              {/* eslint-disable-next-line @next/next/no-img-element -- ảnh tĩnh trong /public */}
              <img src={baseUrl(b)} alt="" className="size-7 rounded-full bg-[#c4c4ce] object-cover object-top" loading="lazy" />
              {BODIES[b].label}
            </button>
          ))}
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
      {kits.map((k) => {
        const missing = k.items.filter((i) => !i.owned && !(i.trial_until && Date.parse(i.trial_until) > now))
        const cost = missing.reduce((t, i) => t + buyPrice(i), 0)
        const blocked = missing.some((i) => i.lock || i.acquire === 'shine')
        const wearing = k.items.every((i) => draft[i.slot] === i.code)
        return (
          <div key={k.code} className="flex items-center gap-3 rounded-2xl border border-brand/40 bg-gradient-to-r from-brand/10 to-transparent p-3">
            <span className="flex h-11 w-9 shrink-0 flex-col overflow-hidden rounded-lg border border-border" aria-hidden>
              {k.items.map((i) => <span key={i.code} className={i.slot === 'top' ? 'flex-[3]' : 'flex-1'} style={{ background: i.color ?? 'var(--color-surface-2)' }} />)}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold">{k.title}</span>
              <span className="block text-xs text-fg-muted">
                {k.items.length} món{missing.length ? ` · thiếu ${missing.length}${cost > 0 ? ` (${formatCoin(cost)} Xu)` : ''}` : ' · đã đủ bộ'}
              </span>
            </span>
            {missing.length > 0 && !blocked && wearing ? (
              <Button size="sm" variant="coin" className="shrink-0" loading={buyingKit} disabled={state.balance < cost}
                onClick={() => void buyKit(missing)}>{cost > 0 ? `Mua ${formatCoin(cost)}` : 'Nhận'}</Button>
            ) : (
              <Button size="sm" className="shrink-0" disabled={wearing}
                onClick={() => setDraft((d) => ({ ...d, ...Object.fromEntries(k.items.map((i) => [i.slot, i.code])) }))}>
                <Shirt className="size-4" aria-hidden />{wearing ? 'Đang mặc' : 'Mặc cả bộ'}
              </Button>
            )}
          </div>
        )
      })}
      {(state.bundles ?? []).filter((b) => !b.bought).map((b) => (
        <button key={b.id} type="button" onClick={() => setBundle(b)}
          className="flex w-full items-center gap-3 rounded-2xl border border-coin/50 bg-gradient-to-r from-coin/15 to-transparent p-3 text-left">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-coin/20 text-coin"><Gift className="size-5" aria-hidden /></span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold">{b.title}{b.badge ? <span className="ml-1.5 rounded-full bg-danger px-1.5 py-0.5 text-[10px] font-black text-white">{b.badge}</span> : null}</span>
            <span className="block text-xs text-fg-muted">{b.items.length} món · <s>{formatCoin(b.base)}</s> → <b className="font-mono text-coin">{formatCoin(b.price)} Xu</b>
              {b.left != null && ` · còn ${b.left}`}{b.ends_at && <> · <Countdown to={b.ends_at} /></>}</span>
          </span>
          <ChevronRight className="size-5 text-fg-subtle" aria-hidden />
        </button>
      ))}

      {collections.length > 0 && (
        <div role="group" aria-label="Bộ sưu tập" className="-mx-4 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none]">
          {[{ code: null as string | null, name: 'Tất cả' }, ...collections].map((c) => (
            <button key={c.code ?? 'all'} type="button" aria-pressed={col === c.code} onClick={() => setCol(c.code)}
              className={cn('shrink-0 rounded-full border px-3 py-1 text-xs font-semibold',
                col === c.code ? 'border-coin bg-coin/15 text-coin' : 'border-border text-fg-muted hover:text-fg')}>
              {c.name}
            </button>
          ))}
        </div>
      )}

      {body !== gender && list.some((i) => i.render_kind === 'LAYER' && !layerUrl(i, body)) && (
        <p className="rounded-xl bg-surface-2 p-2.5 text-xs text-fg-muted">
          Một số món lớp ảnh (mũ, kính, phụ kiện…) mới có cho dáng <b>{BODIES[gender].label}</b> — chọn dáng đó để xem, hoặc chờ bản vẽ cho dáng này.
        </p>
      )}
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
              {tryingUnowned.offer ? <OfferLine o={tryingUnowned.offer} /> : (tryingUnowned.lock && tryingUnowned.lock !== 'LEVEL') || tryingUnowned.club_name || tryingUnowned.left != null || tryingUnowned.available_to ? (
                <ItemNote it={tryingUnowned} />
              ) : (
                <p className={cn('truncate text-xs', RARITY_META[tryingUnowned.rarity].text)}>
                  {RARITY_META[tryingUnowned.rarity].label}{tryingUnowned.description ? ` · ${tryingUnowned.description}` : ''}
                </p>
              )}
            </div>
            <Button variant="secondary" className="shrink-0"
              onClick={() => setDraft((d) => ({ ...d, [tryingUnowned.slot]: state.equipped[tryingUnowned.slot] }))}>Bỏ thử</Button>
            {tryingUnowned.acquire === 'shine' ? (
              <Link href={routes.shine} className="shrink-0"><Button variant="coin"><Sparkles className="size-4" aria-hidden />Đổi bằng Tỏa sáng</Button></Link>
            ) : state.level < tryingUnowned.unlock_level || tryingUnowned.lock ? (
              <Button className="shrink-0" disabled><Lock className="size-4" aria-hidden />
                {!tryingUnowned.lock || tryingUnowned.lock === 'LEVEL' ? `Cấp ${tryingUnowned.unlock_level}` : LOCK_LABEL[tryingUnowned.lock]}
              </Button>
            ) : canTry(tryingUnowned) ? (
              <Button className="shrink-0" onClick={() => void doTry(tryingUnowned)} loading={tryOn.isPending}>
                <Shirt className="size-4" aria-hidden />Mặc thử {tryingUnowned.offer?.trial_days} ngày
              </Button>
            ) : (
              <Button variant="coin" className="shrink-0" onClick={() => setBuying(tryingUnowned)} disabled={state.balance < buyPrice(tryingUnowned)}>
                <Coins className="size-4" aria-hidden />{buyPrice(tryingUnowned) > 0 ? `Mua ${formatCoin(buyPrice(tryingUnowned))}` : 'Nhận miễn phí'}
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
        title={buying ? `Mua ${buying.name}?` : ''} confirmLabel={buying && buyPrice(buying) > 0 ? `Mua ${formatCoin(buyPrice(buying))} Xu` : 'Nhận'}
        description={buying ? `${buying.offer?.eligible && buyPrice(buying) < buying.price_xu ? `${buying.offer.title}: giá gốc ${formatCoin(buying.price_xu)} Xu. ` : ''}Ví còn ${formatCoin(state.balance - buyPrice(buying))} Xu sau khi mua. Vật phẩm là của bạn vĩnh viễn.` : undefined} />
      <ConfirmSheet open={!!bundle} onClose={() => setBundle(null)} onConfirm={doBundle} loading={buyB.isPending} danger={false}
        title={bundle ? `Mua ${bundle.title}?` : ''} confirmLabel={bundle ? `Mua ${formatCoin(bundle.price)} Xu` : ''}
        description={bundle ? `Gồm: ${bundle.items.map((c) => byCode.get(c)?.name ?? c).join(', ')}. Giá lẻ ${formatCoin(bundle.base)} Xu. Món đã có sẽ được bỏ qua.` : undefined} />
    </div>
  )
}

/** Đồng hồ đếm ngược tới hết chương trình */
function Countdown({ to }: { to: string }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t) }, [])
  const ms = Math.max(0, Date.parse(to) - now)
  const d = Math.floor(ms / 86_400_000), h = Math.floor((ms % 86_400_000) / 3_600_000), m = Math.floor((ms % 3_600_000) / 60_000), sec = Math.floor((ms % 60_000) / 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return <span className="font-mono">{d > 0 ? `còn ${d} ngày ${pad(h)}:${pad(m)}` : `còn ${pad(h)}:${pad(m)}:${pad(sec)}`}</span>
}

/** Dòng phụ: đồng phục CLB, lý do khóa, số lượng còn, hạn bán */
function ItemNote({ it }: { it: CharacterItem }) {
  return (
    <p className="truncate text-xs text-fg-muted">
      {it.club_name && <span className="font-semibold text-brand">Đồng phục {it.club_name}</span>}
      {it.lock && it.lock !== 'LEVEL' && <>{it.club_name ? ' · ' : ''}<span className="text-danger">{LOCK_LABEL[it.lock]}</span></>}
      {it.left != null && ` · còn ${it.left}`}
      {it.available_to && it.lock !== 'ENDED' && <> · <Countdown to={it.available_to} /></>}
    </p>
  )
}

function OfferLine({ o }: { o: ItemOffer }) {
  return (
    <p className="flex items-center gap-1 truncate text-xs text-danger">
      <Timer className="size-3 shrink-0" aria-hidden />
      <span className="truncate">{o.title}{!o.eligible ? ' (bạn chưa đủ điều kiện)' : ''}{o.left != null ? ` · còn ${o.left}` : ''}</span>
      {o.ends_at && <> · <Countdown to={o.ends_at} /></>}
    </p>
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
