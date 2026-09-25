'use client'

// Khuyến mãi vật phẩm (migration 005100): chọn mẫu → chọn vật phẩm → vài thông số → Đăng. Mỗi vật phẩm một chương trình.
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Clock, Flame, Gift, Package, PartyPopper, Percent, RotateCcw, Shirt, Sparkles, UserPlus } from 'lucide-react'
import { toast } from 'sonner'
import { Button, Card, ConfirmSheet, EmptyState, ErrorState, Field, Input, Skeleton } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { formatCoin, formatNumber } from '@/shared/lib/format'
import { adminErrorMessage } from '../../api/adminApi'
import { endItemPromo, listItemPromos, saveItemPromo, type ItemPromo, type ItemPromoCatalog, type ItemPromoKind } from '../../api/commerceApi'

const KINDS: Record<ItemPromoKind, { label: string; hint: string; icon: typeof Gift }> = {
  SALE: { label: 'Giảm giá', hint: 'Giảm % trong một khoảng thời gian', icon: Percent },
  FLASH: { label: 'Flash sale', hint: 'Giảm sâu ≤ 72 giờ, có đồng hồ đếm ngược', icon: Flame },
  FREE: { label: 'Miễn phí', hint: 'Tặng không (bắt buộc giới hạn lượt / người)', icon: Gift },
  TRIAL: { label: 'Dùng thử', hint: 'Mặc thử đồ nhân vật N ngày, mỗi người 1 lần', icon: Shirt },
  BUNDLE: { label: 'Gói đồ', hint: 'Nhiều món đồ nhân vật, một giá gói', icon: Package },
  EVENT: { label: 'Sự kiện', hint: 'Giảm theo dịp (Tết, 30/4, 2/9…), gom theo tên dịp', icon: PartyPopper },
  FIRST_PURCHASE: { label: 'Lần mua đầu', hint: 'Chỉ người chưa từng mua bằng Xu', icon: Sparkles },
  COMEBACK: { label: 'Chào mừng trở lại', hint: 'Runner nghỉ ≥ 14 ngày vừa quay lại', icon: RotateCcw },
}
const SEGMENTS = { ALL: 'Tất cả', NEW: 'Người mới (≤ 14 ngày)', COMEBACK: 'Quay lại', VIP: 'VIP' } as const

const inDays = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString()
const nextSunday = () => { const t = new Date(); t.setDate(t.getDate() + ((7 - t.getDay()) % 7 || 7)); t.setHours(23, 59, 0, 0); return t.toISOString() }
/** Chiến dịch dựng sẵn: chọn là điền form, chỉ cần chọn vật phẩm + Đăng */
const PRESETS: { label: string; icon: typeof Gift; p: Partial<ItemPromo> }[] = [
  { label: 'Người mới', icon: UserPlus, p: { kind: 'FREE', title: 'Quà chào runner mới', item_type: 'GIFT', per_user_limit: 3, segment: 'NEW', ends_at: inDays(30) } },
  { label: 'Cuối tuần', icon: Clock, p: { kind: 'SALE', title: 'Cuối tuần giảm 20%', discount_pct: 20, ends_at: nextSunday() } },
  { label: 'Sự kiện', icon: PartyPopper, p: { kind: 'EVENT', title: 'Mừng Quốc khánh 2/9', event_key: 'Quốc khánh', discount_pct: 30, ends_at: inDays(7) } },
  { label: 'Quay lại', icon: RotateCcw, p: { kind: 'COMEBACK', title: 'Chào mừng trở lại!', discount_pct: 30, segment: 'COMEBACK', ends_at: inDays(14) } },
  { label: 'Lần đầu', icon: Sparkles, p: { kind: 'FIRST_PURCHASE', title: 'Lần mua đầu -50%', discount_pct: 50, per_user_limit: 1 } },
]

const toLocal = (iso: string | null | undefined) => (iso ? new Date(new Date(iso).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '')
const fromLocal = (v: string) => (v ? new Date(v).toISOString() : null)
const num = (v: string) => (v.trim() === '' ? null : Math.max(0, Number(v.replace(/\D/g, '')) || 0))

export function ItemPromos() {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['admin', 'item-promos'], queryFn: listItemPromos })
  const [edit, setEdit] = useState<ItemPromo | null>(null)
  const [ending, setEnding] = useState<ItemPromo | null>(null)
  const end = useMutation({
    mutationFn: (id: string) => endItemPromo(id),
    onSuccess: () => { toast.success('Đã kết thúc chương trình — giá về giá gốc'); setEnding(null); void qc.invalidateQueries({ queryKey: ['admin', 'item-promos'] }) },
    onError: (e) => toast.error(adminErrorMessage(e)),
  })
  if (q.isPending) return <Skeleton className="h-64" />
  if (q.isError) return <ErrorState message={adminErrorMessage(q.error)} error={q.error} onRetry={() => void q.refetch()} />
  const live = q.data.promotions.filter((p) => p.live)
  const past = q.data.promotions.filter((p) => !p.live)

  if (edit) return <PromoForm init={edit} cat={q.data} onClose={() => setEdit(null)} />
  return (
    <div className="space-y-4">
      <Card className="space-y-3">
        <p className="text-sm font-semibold">Tạo nhanh theo chiến dịch</p>
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((x) => (
            <Button key={x.label} size="sm" variant="secondary" onClick={() => setEdit({ kind: 'SALE', title: '', segment: 'ALL', item_type: 'AVATAR', ...x.p })}>
              <x.icon className="size-4" aria-hidden />{x.label}
            </Button>
          ))}
        </div>
        <p className="text-sm font-semibold">Hoặc chọn loại chương trình</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {(Object.keys(KINDS) as ItemPromoKind[]).map((k) => {
            const K = KINDS[k]
            return (
              <button key={k} type="button" onClick={() => setEdit({ kind: k, title: '', segment: k === 'COMEBACK' ? 'COMEBACK' : 'ALL',
                item_type: k === 'BUNDLE' ? null : 'AVATAR', discount_pct: ['SALE', 'EVENT', 'COMEBACK'].includes(k) ? 20 : k === 'FLASH' ? 40 : k === 'FIRST_PURCHASE' ? 50 : 0,
                per_user_limit: k === 'FREE' ? 1 : k === 'BUNDLE' ? 1 : null, trial_days: k === 'TRIAL' ? 3 : null,
                ends_at: k === 'FLASH' ? new Date(Date.now() + 6 * 3_600_000).toISOString() : null })}
                className="flex items-start gap-3 rounded-xl border border-border p-3 text-left hover:border-brand">
                <K.icon className="mt-0.5 size-5 shrink-0 text-brand" aria-hidden />
                <span><span className="block text-sm font-semibold">{K.label}</span><span className="block text-xs text-fg-muted">{K.hint}</span></span>
              </button>
            )
          })}
        </div>
        <p className="text-xs text-fg-muted">
          Luật chung: mỗi vật phẩm chỉ một chương trình cùng lúc (không cộng dồn); quà giảm giá / miễn phí chỉ cộng Tỏa sáng theo Xu thực trả;
          số lượng giới hạn là số thật, không hiển thị ảo.
        </p>
      </Card>

      <section className="space-y-2">
        <h3 className="font-semibold">Đang chạy ({live.length})</h3>
        {live.length ? live.map((p) => <PromoRow key={p.id} p={p} onEdit={() => setEdit(p)} onEnd={() => setEnding(p)} />)
          : <EmptyState icon={Percent} title="Chưa có chương trình nào" description="Tạo nhanh bằng các nút phía trên." />}
      </section>
      {past.length > 0 && (
        <section className="space-y-2">
          <h3 className="font-semibold text-fg-muted">Đã kết thúc / chưa bắt đầu</h3>
          {past.map((p) => <PromoRow key={p.id} p={p} onEdit={() => setEdit(p)} />)}
        </section>
      )}
      <ConfirmSheet open={!!ending} onClose={() => setEnding(null)} onConfirm={() => ending?.id && end.mutate(ending.id)} loading={end.isPending}
        title="Kết thúc chương trình?" description="Giá vật phẩm về giá gốc ngay." confirmLabel="Kết thúc" />
    </div>
  )
}

function PromoRow({ p, onEdit, onEnd }: { p: ItemPromo; onEdit: () => void; onEnd?: () => void }) {
  const K = KINDS[p.kind]
  return (
    <Card className="flex items-center gap-3 p-3">
      <K.icon className="size-5 shrink-0 text-brand" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">{p.title} <span className="font-normal text-fg-muted">· {K.label}</span></p>
        <p className="truncate text-xs text-fg-muted">
          {p.kind === 'BUNDLE' ? `${p.bundle_items?.length ?? 0} món · ${formatCoin(p.fixed_price ?? 0)} Xu` : `${p.item_name ?? p.item_code}`}
          {p.discount_pct ? ` · -${p.discount_pct}%` : ''}{p.segment && p.segment !== 'ALL' ? ` · ${SEGMENTS[p.segment]}` : ''}
          {' · '}đã dùng {formatNumber(p.sold ?? 0)}{p.quantity_limit ? `/${formatNumber(p.quantity_limit)}` : ''} · thu {formatCoin(p.xu_paid ?? 0)} Xu
          {p.ends_at ? ` · hết ${new Date(p.ends_at).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })}` : ''}
        </p>
      </div>
      <Button size="sm" variant="ghost" onClick={onEdit}>Sửa</Button>
      {onEnd && <Button size="sm" variant="secondary" onClick={onEnd}>Kết thúc</Button>}
    </Card>
  )
}

function PromoForm({ init, cat, onClose }: { init: ItemPromo; cat: ItemPromoCatalog; onClose: () => void }) {
  const qc = useQueryClient()
  const [p, setP] = useState<ItemPromo>(init)
  const set = (x: Partial<ItemPromo>) => setP((v) => ({ ...v, ...x }))
  const K = KINDS[p.kind]
  const isBundle = p.kind === 'BUNDLE'
  const list = p.item_type === 'GIFT' ? cat.gifts : cat.avatar_items
  const base = list.find((i) => i.code === p.item_code)?.price_xu ?? 0
  const pct = p.discount_pct ?? 0
  const final = p.kind === 'FREE' || p.kind === 'TRIAL' ? 0 : Math.round(base * (100 - pct) / 100)
  const bundleBase = (p.bundle_items ?? []).reduce((s, c) => s + (cat.avatar_items.find((i) => i.code === c)?.price_xu ?? 0), 0)
  const save = useMutation({
    mutationFn: () => saveItemPromo(p),
    onSuccess: () => { toast.success(p.id ? 'Đã cập nhật chương trình' : 'Đã đăng chương trình'); void qc.invalidateQueries({ queryKey: ['admin', 'item-promos'] }); onClose() },
    onError: (e) => toast.error(adminErrorMessage(e)),
  })
  return (
    <Card className="space-y-4">
      <div className="flex items-center gap-2">
        <K.icon className="size-5 text-brand" aria-hidden />
        <p className="font-semibold">{p.id ? 'Sửa' : 'Tạo'}: {K.label}</p>
        <Button size="sm" variant="ghost" className="ml-auto" onClick={onClose}>Đóng</Button>
      </div>
      <Field label="Tên chương trình" htmlFor="ip-title"><Input id="ip-title" value={p.title} maxLength={80} onChange={(e) => set({ title: e.target.value })} placeholder="VD: Cuối tuần giảm 20%" /></Field>

      {isBundle ? (
        <div className="space-y-2">
          <p className="text-sm font-medium">Đồ trong gói (2–12 món) · giá lẻ {formatCoin(bundleBase)} Xu</p>
          <div className="grid max-h-60 gap-1 overflow-y-auto rounded-xl border border-border p-2 sm:grid-cols-2">
            {cat.avatar_items.map((i) => {
              const on = (p.bundle_items ?? []).includes(i.code)
              return (
                <label key={i.code} className={cn('flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm', on && 'bg-brand/10')}>
                  <input type="checkbox" checked={on} className="accent-[var(--color-brand)]"
                    onChange={() => set({ bundle_items: on ? (p.bundle_items ?? []).filter((c) => c !== i.code) : [...(p.bundle_items ?? []), i.code] })} />
                  <span className="min-w-0 flex-1 truncate">{i.name}</span><span className="font-mono text-xs text-coin">{formatCoin(i.price_xu)}</span>
                </label>
              )
            })}
          </div>
          <Field label="Giá gói (Xu)" htmlFor="ip-fixed" hint={bundleBase && p.fixed_price != null ? `Rẻ hơn mua lẻ ${Math.round(100 - (p.fixed_price * 100) / bundleBase)}%` : undefined}>
            <Input id="ip-fixed" inputMode="numeric" value={p.fixed_price ?? ''} onChange={(e) => set({ fixed_price: num(e.target.value) })} />
          </Field>
        </div>
      ) : (
        <div className="space-y-2">
          {p.kind !== 'TRIAL' && (
            <div className="flex gap-2">
              {(['AVATAR', 'GIFT'] as const).map((t) => (
                <Button key={t} size="sm" variant={p.item_type === t ? 'primary' : 'secondary'} onClick={() => set({ item_type: t, item_code: null })}>
                  {t === 'AVATAR' ? 'Đồ nhân vật' : 'Quà tặng'}
                </Button>
              ))}
            </div>
          )}
          <Field label="Vật phẩm" htmlFor="ip-item">
            <select id="ip-item" value={p.item_code ?? ''} onChange={(e) => set({ item_code: e.target.value || null })}
              className="h-11 w-full rounded-xl border border-border bg-surface-2 px-3 text-sm">
              <option value="">— Chọn —</option>
              {list.map((i) => <option key={i.code} value={i.code}>{i.name} · {formatCoin(i.price_xu)} Xu</option>)}
            </select>
          </Field>
          {['SALE', 'FLASH', 'EVENT', 'FIRST_PURCHASE', 'COMEBACK'].includes(p.kind) && (
            <Field label={`Giảm ${pct}%`} htmlFor="ip-pct" hint={base ? `${formatCoin(base)} → ${formatCoin(final)} Xu` : 'Chọn vật phẩm để xem giá cuối'}>
              <input id="ip-pct" type="range" min={5} max={90} step={5} value={pct} onChange={(e) => set({ discount_pct: Number(e.target.value) })} className="w-full accent-[var(--color-brand)]" />
            </Field>
          )}
          {p.kind === 'TRIAL' && (
            <Field label="Số ngày dùng thử" htmlFor="ip-trial"><Input id="ip-trial" inputMode="numeric" value={p.trial_days ?? ''} onChange={(e) => set({ trial_days: num(e.target.value) })} /></Field>
          )}
          {p.kind === 'EVENT' && (
            <Field label="Tên dịp" htmlFor="ip-event"><Input id="ip-event" value={p.event_key ?? ''} maxLength={40} onChange={(e) => set({ event_key: e.target.value })} placeholder="VD: Tết 2027" /></Field>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Field label="Tổng số lượt (trống = không giới hạn)" htmlFor="ip-q"><Input id="ip-q" inputMode="numeric" value={p.quantity_limit ?? ''} onChange={(e) => set({ quantity_limit: num(e.target.value) })} /></Field>
        <Field label={p.kind === 'FREE' ? 'Lượt / người (bắt buộc)' : 'Lượt / người'} htmlFor="ip-u"><Input id="ip-u" inputMode="numeric" value={p.per_user_limit ?? ''} onChange={(e) => set({ per_user_limit: num(e.target.value) })} /></Field>
        <Field label="Bắt đầu" htmlFor="ip-s"><Input id="ip-s" type="datetime-local" value={toLocal(p.starts_at)} onChange={(e) => set({ starts_at: fromLocal(e.target.value) })} /></Field>
        <Field label={p.kind === 'FLASH' ? 'Kết thúc (≤ 72 giờ)' : 'Kết thúc (trống = không hạn)'} htmlFor="ip-e"><Input id="ip-e" type="datetime-local" value={toLocal(p.ends_at)} onChange={(e) => set({ ends_at: fromLocal(e.target.value) })} /></Field>
      </div>
      <div className="space-y-1.5">
        <p className="text-sm font-medium">Áp dụng cho</p>
        <div className="flex flex-wrap gap-1.5">
          {(Object.keys(SEGMENTS) as (keyof typeof SEGMENTS)[]).map((s) => (
            <button key={s} type="button" aria-pressed={p.segment === s} onClick={() => set({ segment: s })}
              className={cn('rounded-full border px-3 py-1.5 text-xs font-semibold', p.segment === s ? 'border-brand bg-brand/15' : 'border-border text-fg-muted')}>{SEGMENTS[s]}</button>
          ))}
        </div>
      </div>
      <Field label="Nhãn trên vật phẩm (không bắt buộc)" htmlFor="ip-badge"><Input id="ip-badge" value={p.badge ?? ''} maxLength={24} onChange={(e) => set({ badge: e.target.value })} placeholder="Tự động: -30%, FLASH SALE…" /></Field>
      <Button block onClick={() => save.mutate()} loading={save.isPending} disabled={!p.title.trim() || (!isBundle && !p.item_code)}>{p.id ? 'Lưu' : 'Đăng chương trình'}</Button>
    </Card>
  )
}
