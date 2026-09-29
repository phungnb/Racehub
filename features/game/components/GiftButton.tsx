'use client'

import Link from 'next/link'
import { useRef, useState } from 'react'
import { Gift as GiftIcon, Lock, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { useMyProfile } from '@/features/auth'
import { Avatar, Button, Field, Input, Sheet, SwitchRow } from '@/shared/ui'
import { useStoredFlag } from '@/shared/lib/useStoredFlag'
import { cn } from '@/shared/lib/cn'
import { formatCoin } from '@/shared/lib/format'
import { routes } from '@/shared/config/routes'
import { gameErrorMessage, giftCost, type Gift, type GiftContext, type GiftKind, type GiftTier } from '../api/gameApi'
import { useGiftCatalog, useSendGift } from '../hooks/useGame'

const QTY = [1, 5, 10, 99] as const
const QUICK = ['Cố lên!', 'Đỉnh quá!', 'Pace đẹp quá!', 'Chạy bền thật!']
export const TIER_META: Record<GiftTier, { label: string; ring: string; text: string }> = {
  CHEER: { label: 'Cổ vũ', ring: 'border-border', text: 'text-fg-muted' },
  BOOST: { label: 'Tiếp sức', ring: 'border-brand/50', text: 'text-brand' },
  HYPE: { label: 'Bùng nổ', ring: 'border-coin/60', text: 'text-coin' },
  LEGEND: { label: 'Huyền thoại', ring: 'border-fuchsia-400/70', text: 'text-fuchsia-300' },
}

const KIND_TABS: [GiftKind, string][] = [['STATIC', 'Quà tĩnh'], ['ANIMATED', 'Quà hiệu ứng động']]
export const CONTEXT_LABEL: Record<GiftContext, string> = { KM5: '5K', KM10: '10K', HALF: 'Half', FULL: 'Full', ULTRA: 'Ultra', PR: 'PR' }

/** Hình quà: ảnh riêng admin tải lên (tĩnh hoặc WebP động), chưa có thì dùng emoji */
export function GiftArt({ g, className }: { g: Pick<Gift, 'emoji' | 'art_url'>; className?: string }) {
  const [broken, setBroken] = useState(false)
  if (g.art_url && !broken) {
    // eslint-disable-next-line @next/next/no-img-element -- ảnh quà (có thể là WebP động) từ kho ảnh của app
    return <img src={g.art_url} alt="" draggable={false} loading="lazy" onError={() => setBroken(true)} className={cn('inline-block select-none object-contain', className)} />
  }
  return <span className={cn('inline-grid place-items-center leading-none', className)} aria-hidden>{g.emoji}</span>
}

type Burst = { g: Pick<Gift, 'emoji' | 'art_url' | 'price_xu'>; kind: GiftKind; qty: number }

/**
 * Hiệu ứng khi tặng. Quà tĩnh: vài hình bay nhẹ lên. Quà động: dưới 1.000 Xu nổ vừa phải,
 * từ 1.000 Xu toàn màn hình. Người dùng tắt được (nhớ trên máy); máy bật "giảm chuyển động" thì hiệu ứng gần như tắt.
 */
function GiftBurst({ b, onDone }: { b: Burst; onDone: () => void }) {
  const full = b.kind === 'ANIMATED' && b.g.price_xu >= 1000
  const count = b.kind === 'ANIMATED' ? 1 : Math.min(b.qty, 12)
  return (
    <div className={cn('pointer-events-none fixed inset-0 z-[80] grid place-items-center', full && 'bg-black/40')} aria-hidden>
      {b.kind === 'ANIMATED' ? (
        <span className="animate-gift-burst drop-shadow-[0_0_40px_rgb(255_200_60/0.6)]" onAnimationEnd={onDone}>
          <GiftArt g={b.g} className={full ? 'size-72 text-[12rem]' : 'size-40 text-[7rem]'} />
        </span>
      ) : (
        Array.from({ length: count }, (_, i) => (
          <span key={i} className="animate-gift-rise absolute"
            style={{ left: `${20 + ((i * 37) % 60)}%`, bottom: '18%', animationDelay: `${i * 90}ms` }}
            onAnimationEnd={i === count - 1 ? onDone : undefined}><GiftArt g={b.g} className="size-12 text-5xl" /></span>
        ))
      )}
      {b.qty > 1 && <span className="animate-pop absolute bottom-[28%] font-mono text-4xl font-black text-coin">×{b.qty}</span>}
    </div>
  )
}

/** Nút "Tặng quà" — quà đốt Xu của người tặng, người nhận nhận lời cổ vũ + điểm Tỏa sáng (không nhận Xu). Ẩn với bài của chính mình. */
export function GiftButton({ toUser, toName, toAvatar, postId, activityId, total, className }: {
  toUser: string; toName: string; toAvatar?: string | null; postId?: string | null; activityId?: string | null
  total?: number; className?: string
}) {
  const { profile } = useMyProfile()
  const [open, setOpen] = useState(false)
  const [code, setCode] = useState<string | null>(null)
  const [qty, setQty] = useState(1)
  const [msg, setMsg] = useState('')
  const [burst, setBurst] = useState<Burst | null>(null)
  const [tab, setTab] = useState<GiftKind>('STATIC')
  const [fxOff, setFxOff] = useStoredFlag('racehub.gift-fx-off', false)
  const key = useRef(`gift-${crypto.randomUUID()}`)
  const catalog = useGiftCatalog(open, postId, activityId)
  const send = useSendGift()
  if (!profile || profile.id === toUser) return null
  const balance = Number(profile.xu ?? 0)
  const all = catalog.data?.gifts ?? []
  const gifts = all.filter((g) => g.kind === tab).sort((a, b) => a.price_xu - b.price_xu || a.name.localeCompare(b.name))
  const gift: Gift | undefined = all.find((g) => g.code === code) ?? gifts[0]
  const cost = gift ? giftCost(gift, qty) : 0
  const left = catalog.data ? Math.max(0, catalog.data.daily_cap - catalog.data.sent_today) : Infinity
  const blocked = !gift || gift.locked || balance < cost || cost > left

  const submit = async () => {
    if (!gift) return
    try {
      await send.mutateAsync({ toUser, code: gift.code, qty, message: msg.trim(), postId, activityId, key: key.current })
      key.current = `gift-${crypto.randomUUID()}`
      setOpen(false); setMsg('')
      if (!fxOff) setBurst({ g: gift, kind: gift.kind, qty })
      toast.success(`Đã tặng ${toName} ${qty > 1 ? `${qty} × ` : ''}${gift.name}`)
    } catch (e) {
      toast.error(gameErrorMessage(e))
    }
  }

  return (
    <>
      <button onClick={() => setOpen(true)}
        className={cn('flex min-h-11 items-center gap-2 whitespace-nowrap rounded-xl px-2 text-sm font-semibold text-coin transition-colors hover:bg-surface-2', className)}>
        <GiftIcon className="size-5" aria-hidden />Tặng quà
        {!!total && total > 0 && <span className="font-mono tabular">{formatCoin(total)}</span>}
      </button>
      {burst && <GiftBurst b={burst} onDone={() => setBurst(null)} />}
      <Sheet open={open} onClose={() => setOpen(false)} title="Tặng quà cổ vũ"
        description="Quà dùng Xu của bạn; người nhận có thêm điểm Tỏa sáng theo số Xu bạn thực trả (không nhận Xu)."
        footer={
          <Button block size="lg" variant="coin" onClick={submit} loading={send.isPending} disabled={blocked}>
            {gift ? <GiftArt g={gift} className="size-6 text-lg" /> : <span className="text-lg" aria-hidden>🎁</span>}
            Tặng{qty > 1 ? ` ${qty} ×` : ''} {gift?.name ?? ''} · {formatCoin(cost)} Xu
          </Button>
        }>
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <Avatar src={toAvatar} name={toName} size="md" />
            <p className="font-semibold">{toName}</p>
          </div>
          <div role="tablist" aria-label="Loại quà" className="grid grid-cols-2 gap-1 rounded-xl bg-surface-2 p-1">
            {KIND_TABS.map(([k, label]) => (
              <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => { setTab(k); setCode(null) }}
                className={cn('flex items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-semibold', tab === k ? 'bg-surface text-fg shadow-sm' : 'text-fg-muted')}>
                {k === 'ANIMATED' && <Sparkles className="size-4 text-coin" aria-hidden />}{label}
                <span className="font-mono text-xs font-normal text-fg-subtle">{all.filter((g) => g.kind === k).length || ''}</span>
              </button>
            ))}
          </div>
          {catalog.isLoading ? (
            <div className="grid grid-cols-4 gap-2">{Array.from({ length: 8 }, (_, i) => <div key={i} className="h-24 animate-pulse rounded-xl bg-surface-2" />)}</div>
          ) : (
            <div role="radiogroup" aria-label="Chọn quà" className="grid max-h-72 grid-cols-4 gap-2 overflow-y-auto pr-1">
              {gifts.map((g) => {
                const on = gift?.code === g.code
                const t = TIER_META[g.tier]
                return (
                  <button key={g.code} role="radio" aria-checked={on} onClick={() => setCode(g.code)} title={g.description ?? g.name}
                    className={cn('relative flex flex-col items-center gap-0.5 rounded-xl border p-2 text-center', on ? 'border-coin bg-coin/15' : t.ring, g.locked && 'opacity-60')}>
                    <GiftArt g={g} className="size-9 text-3xl" />
                    <span className="line-clamp-2 min-h-[2lh] text-[11px] font-medium leading-tight">{g.name}</span>
                    <span className="font-mono text-[11px] font-semibold text-coin">
                      {giftCost(g, 1) < g.price_xu && <s className="mr-0.5 text-[9px] text-fg-subtle">{formatCoin(g.price_xu)}</s>}
                      {giftCost(g, 1) > 0 ? formatCoin(giftCost(g, 1)) : 'Free'}
                    </span>
                    {g.offer && !g.seasonal && <span className="absolute left-1 top-1 max-w-[80%] truncate rounded bg-danger px-1 text-[9px] font-bold text-white">{g.offer.badge}</span>}
                    {g.locked && <Lock className="absolute right-1 top-1 size-3 text-fg-subtle" aria-label="Cần VIP" />}
                    {g.seasonal && <span className="absolute left-1 top-1 rounded bg-danger/80 px-1 text-[9px] font-bold text-white">Mùa</span>}
                    {g.context && <span className="absolute left-1 top-1 rounded bg-brand px-1 text-[9px] font-bold text-brand-fg">{CONTEXT_LABEL[g.context]}</span>}
                  </button>
                )
              })}
            </div>
          )}
          {!catalog.isLoading && !gifts.length && <p className="py-4 text-center text-sm text-fg-subtle">Chưa có quà loại này.</p>}
          {gift?.context && (
            <p className="text-xs text-brand">Quà mừng mốc {CONTEXT_LABEL[gift.context]}: chỉ tặng được vì bài chạy này đạt mốc.</p>
          )}
          {gift?.locked && (
            <p className="text-xs text-fg-muted">Quà dành cho VIP{gift.vip_tier}. <Link href={routes.plan} className="font-semibold text-brand">Xem gói VIP</Link></p>
          )}
          <div role="radiogroup" aria-label="Số lượng" className="grid grid-cols-4 gap-2">
            {QTY.map((q) => (
              <button key={q} role="radio" aria-checked={qty === q} onClick={() => setQty(q)}
                className={cn('h-10 rounded-xl border font-mono text-sm font-bold', qty === q ? 'border-coin bg-coin/15 text-coin' : 'border-border text-fg-muted')}>
                ×{q}
              </button>
            ))}
          </div>
          <p className={cn('text-xs', balance < cost || cost > left ? 'text-danger' : 'text-fg-subtle')}>
            Ví của bạn: {formatCoin(balance)} Xu{Number.isFinite(left) ? ` · hôm nay còn tặng được ${formatCoin(left)} Xu` : ''}
            {balance < cost && <> · <Link href={routes.plan} className="font-semibold text-brand">Nạp Xu</Link></>}
          </p>
          <Field label="Lời nhắn (không bắt buộc)" htmlFor="gift-msg">
            <Input id="gift-msg" value={msg} maxLength={140} onChange={(e) => setMsg(e.target.value)} placeholder="Cố lên!" />
          </Field>
          <SwitchRow checked={fxOff} onChange={setFxOff} label="Tắt hiệu ứng khi tặng" description="Nhớ trên máy này" />
          <div className="flex flex-wrap gap-2">
            {QUICK.map((m) => (
              <button key={m} onClick={() => setMsg(m)} className="rounded-full border border-border px-3 py-1.5 text-xs text-fg-muted hover:text-fg">{m}</button>
            ))}
          </div>
        </div>
      </Sheet>
    </>
  )
}
