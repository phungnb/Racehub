'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Settings2, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { Button, Card, ErrorState, Field, Input, Sheet, Skeleton, Textarea } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { formatCoin, formatNumber } from '@/shared/lib/format'
import { SHINE_NAMES } from '@/shared/lib/shine'
import { adminErrorMessage, listAvatarItems } from '../../api/adminApi'
import { getShineOverview, saveShineItem, setShineConfig, type ShineConfig, type ShineItem, type ShineKind } from '../../api/commerceApi'

const KIND_LABEL: Record<ShineKind, string> = { PASS: 'Lượt tạo thử thách', SHIELD: 'Khiên giữ chuỗi', COSMETIC: 'Vật phẩm nhân vật' }
const EMPTY: ShineItem = { code: '', name: '', description: null, kind: 'COSMETIC', cost: 1000, period_limit: null, limit_period: 'MONTH', min_senders: 0, is_active: true, sort: 100, params: {} }
const num = (v: string) => Number(v.replace(',', '.')) || 0

/** Quản trị → Quà tặng → Cửa hàng Tỏa sáng: quà nhận được đổi ra quyền lợi (≈ 30–35% giá trị Xu), không đổi ra Xu */
export function ShineAdmin() {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['admin', 'shine'], queryFn: getShineOverview, retry: false })
  const [edit, setEdit] = useState<{ item: ShineItem; isNew: boolean } | null>(null)
  const [cfg, setCfg] = useState<ShineConfig | null>(null)
  const refresh = () => void qc.invalidateQueries({ queryKey: ['admin', 'shine'] })
  const save = useMutation({ mutationFn: saveShineItem, onSuccess: () => { toast.success('Đã lưu'); setEdit(null); refresh() }, onError: (e) => toast.error(adminErrorMessage(e)) })
  const saveCfg = useMutation({ mutationFn: setShineConfig, onSuccess: () => { toast.success('Đã lưu cài đặt'); setCfg(null); refresh() }, onError: (e) => toast.error(adminErrorMessage(e)) })
  const items = useQuery({ queryKey: ['admin', 'items'], queryFn: listAvatarItems, enabled: edit?.item.kind === 'COSMETIC', staleTime: 5 * 60_000 })

  return (
    <section className="space-y-3">
      <h2 className="flex items-center gap-2 font-semibold"><Sparkles className="size-4 text-coin" aria-hidden />Cửa hàng Tỏa sáng
        <Button size="sm" variant="ghost" className="ml-auto" onClick={() => q.data && setCfg(q.data.config)}><Settings2 className="size-4" aria-hidden />Cài đặt</Button></h2>
      {q.isPending ? <Skeleton className="h-40" /> : q.isError ? <ErrorState message={adminErrorMessage(q.error)} error={q.error} onRetry={() => void q.refetch()} /> : (
        <>
          <Card className="grid grid-cols-2 gap-3 p-3 text-center text-xs sm:grid-cols-4">
            <Metric label="Quà tặng 30 ngày (Tỏa sáng)" value={formatCoin(q.data.gifted_30d)} />
            <Metric label="Phần được tính để đổi" value={formatCoin(q.data.countable_30d)} />
            <Metric label="Đã đổi" value={formatCoin(q.data.spent_30d)} />
            <Metric label="≈ Xu trả lại qua quyền lợi" value={`${formatCoin(q.data.xu_equiv_30d)} Xu`} hint={q.data.gifted_30d ? `${Math.round((q.data.xu_equiv_30d / q.data.gifted_30d) * 100)}% Xu đã đốt` : undefined} />
          </Card>
          {!!q.data.tiers_count?.length && (
            <p className="text-xs text-fg-muted">Runner theo bậc: {q.data.tiers_count.filter((t) => t.tier > 0).map((t) => `${SHINE_NAMES[t.tier]} ${formatNumber(t.users)}`).join(' · ') || 'chưa ai đạt bậc'}</p>
          )}
          <ul className="divide-y divide-border rounded-xl border border-border bg-surface">
            {q.data.items.map((i) => (
              <li key={i.code}>
                <button onClick={() => setEdit({ item: i, isNew: false })} className={cn('flex w-full items-center gap-3 p-3 text-left', !i.is_active && 'opacity-50')}>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{i.name}</span>
                    <span className="block text-xs text-fg-muted">
                      {KIND_LABEL[i.kind]}{i.item_name ? `: ${i.item_name}` : ''}{i.period_limit ? ` · ${i.period_limit} lần/${i.limit_period === 'WEEK' ? 'tuần' : 'tháng'}` : ''}
                      {i.min_senders ? ` · cần ${i.min_senders} người tặng` : ''} · {formatNumber(i.redeemed_30d ?? 0)} lượt đổi 30 ngày
                    </span>
                  </span>
                  <span className="font-mono text-sm font-bold text-coin">✨{formatNumber(i.cost)}</span>
                </button>
              </li>
            ))}
          </ul>
          <Button block variant="secondary" onClick={() => setEdit({ item: EMPTY, isNew: true })}><Plus className="size-4" aria-hidden />Thêm món</Button>
        </>
      )}

      <Sheet open={!!edit} onClose={() => setEdit(null)} title={edit?.isNew ? 'Thêm món Tỏa sáng' : 'Sửa món Tỏa sáng'}
        footer={<Button block loading={save.isPending} disabled={!edit || edit.item.name.trim().length < 2 || edit.item.cost < 1} onClick={() => edit && save.mutate(edit.item)}>Lưu</Button>}>
        {edit && (() => {
          const i = edit.item
          const set = (patch: Partial<ShineItem>) => setEdit({ ...edit, item: { ...i, ...patch } })
          const setP = (patch: ShineItem['params']) => set({ params: { ...i.params, ...patch } })
          const ratio = i.params.xu_value ? Math.round(((i.params.xu_value ?? 0) / i.cost) * 100) : null
          return (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Mã" htmlFor="sh-code"><Input id="sh-code" value={i.code} disabled={!edit.isNew} className="font-mono uppercase"
                  onChange={(e) => set({ code: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '') })} placeholder="AURA_ROSE" /></Field>
                <Field label="Loại" htmlFor="sh-kind">
                  <select id="sh-kind" value={i.kind} onChange={(e) => set({ kind: e.target.value as ShineKind })} className="h-11 w-full rounded-xl border border-border bg-surface px-2 text-sm">
                    {(Object.keys(KIND_LABEL) as ShineKind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
                  </select>
                </Field>
              </div>
              <Field label="Tên" htmlFor="sh-name"><Input id="sh-name" maxLength={80} value={i.name} onChange={(e) => set({ name: e.target.value })} /></Field>
              <Field label="Mô tả" htmlFor="sh-desc"><Textarea id="sh-desc" rows={2} value={i.description ?? ''} onChange={(e) => set({ description: e.target.value || null })} /></Field>
              {i.kind === 'COSMETIC' && (
                <Field label="Vật phẩm nhân vật" htmlFor="sh-item" hint="Sau khi lưu, vật phẩm này chỉ đổi được bằng Tỏa sáng (không bán bằng Xu)">
                  <select id="sh-item" value={i.params.item_code ?? ''} onChange={(e) => setP({ item_code: e.target.value })} className="h-11 w-full rounded-xl border border-border bg-surface px-2 text-sm">
                    <option value="">Chọn vật phẩm…</option>
                    {(items.data ?? []).map((x) => <option key={x.code} value={x.code}>{x.name}</option>)}
                  </select>
                </Field>
              )}
              {i.kind === 'PASS' && (
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Quy mô tối đa (người)" htmlFor="sh-slots"><Input id="sh-slots" inputMode="numeric" className="font-mono" value={i.params.max_slots ?? ''} onChange={(e) => setP({ max_slots: num(e.target.value) })} /></Field>
                  <Field label="Hạn dùng (ngày)" htmlFor="sh-days"><Input id="sh-days" inputMode="numeric" className="font-mono" value={i.params.days ?? 30} onChange={(e) => setP({ days: num(e.target.value) })} /></Field>
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <Field label="Giá (Tỏa sáng)" htmlFor="sh-cost"><Input id="sh-cost" inputMode="numeric" className="font-mono" value={i.cost || ''} onChange={(e) => set({ cost: num(e.target.value) })} /></Field>
                <Field label="Giá trị tương đương (Xu)" htmlFor="sh-xu" hint={ratio !== null ? `Tỷ lệ đổi ≈ ${ratio}% (nên ≤ 35%)` : 'Để admin so sánh'}>
                  <Input id="sh-xu" inputMode="numeric" className="font-mono" value={i.params.xu_value ?? ''} onChange={(e) => setP({ xu_value: num(e.target.value) })} /></Field>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <Field label="Giới hạn lần" htmlFor="sh-lim"><Input id="sh-lim" inputMode="numeric" className="font-mono" value={i.period_limit ?? ''} placeholder="Không"
                  onChange={(e) => set({ period_limit: num(e.target.value) || null })} /></Field>
                <Field label="Mỗi" htmlFor="sh-per">
                  <select id="sh-per" value={i.limit_period} onChange={(e) => set({ limit_period: e.target.value as 'WEEK' | 'MONTH' })} className="h-11 w-full rounded-xl border border-border bg-surface px-2 text-sm">
                    <option value="WEEK">Tuần</option><option value="MONTH">Tháng</option>
                  </select>
                </Field>
                <Field label="Cần số người tặng" htmlFor="sh-snd"><Input id="sh-snd" inputMode="numeric" className="font-mono" value={i.min_senders || ''} placeholder="0"
                  onChange={(e) => set({ min_senders: num(e.target.value) })} /></Field>
              </div>
              {ratio !== null && ratio > 50 && <p className="text-xs text-warning">Tỷ lệ đổi trên 50% — nuôi tài khoản ảo để đổi có thể có lời.</p>}
              <label className="flex items-center justify-between text-sm font-medium">Đang bán
                <input type="checkbox" checked={i.is_active} onChange={(e) => set({ is_active: e.target.checked })} className="size-5 accent-[var(--color-brand)]" /></label>
            </div>
          )
        })()}
      </Sheet>

      <Sheet open={!!cfg} onClose={() => setCfg(null)} title="Cài đặt Tỏa sáng" description="Ngưỡng bậc (khung ảnh đại diện) và luật chống gian lận"
        footer={<Button block loading={saveCfg.isPending} onClick={() => cfg && saveCfg.mutate(cfg)}>Lưu</Button>}>
        {cfg && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              {cfg.tiers.map((t, k) => (
                <Field key={k} label={`Bậc ${SHINE_NAMES[k + 1]} từ`} htmlFor={`sh-t${k}`}>
                  <Input id={`sh-t${k}`} inputMode="numeric" className="font-mono" value={t}
                    onChange={(e) => setCfg({ ...cfg, tiers: cfg.tiers.map((x, j) => (j === k ? num(e.target.value) : x)) })} /></Field>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Mỗi người tặng góp tối đa / tuần" htmlFor="sh-cap"><Input id="sh-cap" inputMode="numeric" className="font-mono" value={cfg.perSenderWeeklyCap} onChange={(e) => setCfg({ ...cfg, perSenderWeeklyCap: num(e.target.value) })} /></Field>
              <Field label="Lời cảm ơn / ngày" htmlFor="sh-thx"><Input id="sh-thx" inputMode="numeric" className="font-mono" value={cfg.thanksPerDay} onChange={(e) => setCfg({ ...cfg, thanksPerDay: num(e.target.value) })} /></Field>
              <Field label="Người tặng: tài khoản từ (ngày)" htmlFor="sh-age"><Input id="sh-age" inputMode="numeric" className="font-mono" value={cfg.minSenderAgeDays} onChange={(e) => setCfg({ ...cfg, minSenderAgeDays: num(e.target.value) })} /></Field>
              <Field label="Người tặng: số bài chạy tối thiểu" htmlFor="sh-runs"><Input id="sh-runs" inputMode="numeric" className="font-mono" value={cfg.minSenderRuns} onChange={(e) => setCfg({ ...cfg, minSenderRuns: num(e.target.value) })} /></Field>
            </div>
          </div>
        )}
      </Sheet>
    </section>
  )
}

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <p className="font-mono text-base font-bold">{value}</p>
      <p className="text-fg-muted">{label}</p>
      {hint && <p className="text-fg-subtle">{hint}</p>}
    </div>
  )
}
