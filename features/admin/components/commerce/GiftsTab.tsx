'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Flag, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button, Card, EmptyState, ErrorState, Field, Input, SectionTitle, Sheet, Skeleton } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { formatCoin } from '@/shared/lib/format'
import { adminErrorMessage, type AccountHit } from '../../api/adminApi'
import { listGifts, listOrganizers, saveGift, setOrganizer, type AdminGift } from '../../api/commerceApi'
import { AccountPicker } from '../economy/AccountPicker'

const TIERS: AdminGift['tier'][] = ['CHEER', 'BOOST', 'HYPE', 'LEGEND']
const TIER_LABEL: Record<AdminGift['tier'], string> = { CHEER: 'Cổ vũ', BOOST: 'Tiếp sức', HYPE: 'Bùng nổ', LEGEND: 'Huyền thoại' }
type Draft = Omit<AdminGift, 'sent_30d' | 'burn_30d'>
const EMPTY: Draft = { code: '', name: '', emoji: '🎁', price_xu: 10, tier: 'CHEER', description: '', vip_tier: 0, season_from: null, season_to: null, is_active: true, sort: 50 }

/** Kho quà: sửa giá / tên / biểu tượng / tầng / VIP / mùa, bật tắt, thêm quà mới — kèm số liệu 30 ngày */
export function GiftsTab() {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['admin', 'gifts'], queryFn: listGifts })
  const [edit, setEdit] = useState<{ draft: Draft; isNew: boolean } | null>(null)
  const save = useMutation({
    mutationFn: (g: Draft) => saveGift({ ...g, description: g.description?.trim() || null }),
    onSuccess: () => { toast.success('Đã lưu quà'); setEdit(null); void qc.invalidateQueries({ queryKey: ['admin', 'gifts'] }); void qc.invalidateQueries({ queryKey: ['game', 'gifts'] }) },
    onError: (e) => toast.error(adminErrorMessage(e)),
  })
  if (q.isPending) return <Skeleton className="h-96" />
  if (q.isError) return <ErrorState message={adminErrorMessage(q.error)} error={q.error} onRetry={() => void q.refetch()} />
  const burn = q.data.reduce((s, g) => s + g.burn_30d, 0)
  const d = edit?.draft
  const set = (patch: Partial<Draft>) => edit && setEdit({ ...edit, draft: { ...edit.draft, ...patch } })

  return (
    <div className="space-y-3">
      <Card className="flex items-center justify-between text-sm">
        <span className="text-fg-muted">Xu đốt qua quà 30 ngày</span>
        <span className="font-mono font-bold text-coin">{formatCoin(burn)} Xu</span>
      </Card>
      <p className="text-xs text-fg-muted">Người tặng mất Xu (về hệ thống), người nhận chỉ nhận quà + điểm Tỏa sáng — không có đường chuyển Xu giữa người dùng.</p>
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {q.data.map((g) => (
          <li key={g.code}>
            <button onClick={() => setEdit({ draft: g, isNew: false })}
              className={cn('flex w-full items-center gap-2 rounded-xl border bg-surface p-2.5 text-left', g.is_active ? 'border-border' : 'border-dashed border-border opacity-60')}>
              <span className="text-3xl" aria-hidden>{g.emoji}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{g.name}</span>
                <span className="block font-mono text-xs text-coin">{formatCoin(g.price_xu)} Xu</span>
                <span className="block text-[11px] text-fg-subtle">{TIER_LABEL[g.tier]}{g.vip_tier ? ` · VIP${g.vip_tier}` : ''}{g.season_from ? ' · mùa' : ''} · {formatCoin(g.sent_30d)} lượt</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      <Button block variant="secondary" onClick={() => setEdit({ draft: EMPTY, isNew: true })}><Plus className="size-4" aria-hidden />Thêm quà</Button>

      <Sheet open={!!edit} onClose={() => setEdit(null)} title={edit?.isNew ? 'Thêm quà' : `Sửa quà ${d?.name ?? ''}`}
        footer={<Button block onClick={() => d && save.mutate(d)} loading={save.isPending} disabled={!d || d.name.trim().length < 2 || !/^[a-z0-9_]{2,40}$/.test(d.code) || !(d.price_xu >= 1)}>Lưu</Button>}>
        {d && (
          <div className="space-y-3">
            <div className="grid grid-cols-[5rem_1fr] gap-3">
              <Field label="Biểu tượng" htmlFor="g-emoji"><Input id="g-emoji" className="text-center text-2xl" value={d.emoji} maxLength={16} onChange={(e) => set({ emoji: e.target.value })} /></Field>
              <Field label="Tên" htmlFor="g-name"><Input id="g-name" value={d.name} maxLength={40} onChange={(e) => set({ name: e.target.value })} /></Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Mã (không đổi được)" htmlFor="g-code"><Input id="g-code" value={d.code} disabled={!edit.isNew}
                onChange={(e) => set({ code: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 40) })} placeholder="energy_drink" /></Field>
              <Field label="Giá" htmlFor="g-price"><Input id="g-price" inputMode="numeric" className="font-mono" value={d.price_xu || ''}
                onChange={(e) => set({ price_xu: Number(e.target.value.replace(/\D/g, '') || 0) })} /></Field>
            </div>
            <Field label="Mô tả" htmlFor="g-desc"><Input id="g-desc" value={d.description ?? ''} maxLength={120} onChange={(e) => set({ description: e.target.value })} /></Field>
            <div className="grid grid-cols-4 gap-1.5" role="radiogroup" aria-label="Tầng quà">
              {TIERS.map((t) => (
                <button key={t} role="radio" aria-checked={d.tier === t} onClick={() => set({ tier: t })}
                  className={cn('rounded-lg border py-2 text-xs font-semibold', d.tier === t ? 'border-brand bg-brand/10' : 'border-border text-fg-muted')}>{TIER_LABEL[t]}</button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Chỉ VIP từ cấp" htmlFor="g-vip" hint="0 = mọi người"><Input id="g-vip" inputMode="numeric" value={String(d.vip_tier)}
                onChange={(e) => set({ vip_tier: Math.min(3, Number(e.target.value.replace(/\D/g, '') || 0)) })} /></Field>
              <Field label="Thứ tự" htmlFor="g-sort"><Input id="g-sort" inputMode="numeric" value={String(d.sort)} onChange={(e) => set({ sort: Number(e.target.value.replace(/\D/g, '') || 0) })} /></Field>
              <Field label="Mùa từ ngày" htmlFor="g-from" hint="Để trống = quanh năm"><Input id="g-from" type="date" value={d.season_from ?? ''} onChange={(e) => set({ season_from: e.target.value || null })} /></Field>
              <Field label="đến ngày" htmlFor="g-to"><Input id="g-to" type="date" value={d.season_to ?? ''} onChange={(e) => set({ season_to: e.target.value || null })} /></Field>
            </div>
            <label className="flex items-center justify-between text-sm font-medium">Đang bán
              <input type="checkbox" checked={d.is_active} onChange={(e) => set({ is_active: e.target.checked })} className="size-5 accent-[var(--color-brand)]" /></label>
          </div>
        )}
      </Sheet>
    </div>
  )
}

/** Quyền tổ chức giải chạy ảo: chỉ CLB / cá nhân được admin cấp mới tạo được giải */
export function OrganizersTab() {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['admin', 'organizers'], queryFn: listOrganizers })
  const [target, setTarget] = useState<AccountHit | null>(null)
  const [note, setNote] = useState('')
  const change = useMutation({
    mutationFn: (v: { kind: AccountHit['kind']; id: string; allow: boolean }) => setOrganizer(v.kind, v.id, v.allow, v.allow ? note.trim() || null : null),
    onSuccess: (_, v) => {
      toast.success(v.allow ? 'Đã cấp quyền tổ chức giải' : 'Đã thu hồi quyền'); setTarget(null); setNote('')
      void qc.invalidateQueries({ queryKey: ['admin', 'organizers'] })
    },
    onError: (e) => toast.error(adminErrorMessage(e)),
  })
  return (
    <div className="space-y-4">
      <Card className="space-y-3">
        <p className="font-semibold">Cấp quyền tổ chức giải</p>
        <AccountPicker id="org-target" value={target} onChange={setTarget} />
        <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="Ghi chú (đối tác, hợp đồng…)" aria-label="Ghi chú" />
        <Button block disabled={!target} loading={change.isPending} onClick={() => target && change.mutate({ kind: target.kind, id: target.id, allow: true })}>Cấp quyền</Button>
        <p className="text-xs text-fg-muted">Giải của CLB: ban quản trị CLB tạo, phí trừ quỹ CLB. Giải cá nhân: phí trừ ví người tạo. Phí theo quy mô như thử thách, dùng lượt miễn phí trước.</p>
      </Card>
      <section>
        <SectionTitle>Đang có quyền</SectionTitle>
        {q.isPending ? <Skeleton className="h-24" /> : q.isError ? <ErrorState message={adminErrorMessage(q.error)} error={q.error} onRetry={() => void q.refetch()} />
          : !q.data.length ? <EmptyState icon={Flag} title="Chưa cấp cho ai" description="Hiện chỉ admin tạo được giải chạy ảo." />
          : (
            <ul className="divide-y divide-border rounded-xl border border-border bg-surface">
              {q.data.map((g) => (
                <li key={g.owner_type + g.owner_id} className="flex items-center gap-3 p-3">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{g.name ?? g.owner_id}</span>
                    <span className="block text-xs text-fg-muted">{g.owner_type === 'CLUB' ? 'CLB' : 'Cá nhân'}{g.note ? ` · ${g.note}` : ''} · từ {new Date(g.created_at).toLocaleDateString('vi-VN')}</span>
                  </span>
                  <Button size="sm" variant="ghost" aria-label="Thu hồi quyền" onClick={() => change.mutate({ kind: g.owner_type, id: g.owner_id, allow: false })}>
                    <Trash2 className="size-4" aria-hidden />
                  </Button>
                </li>
              ))}
            </ul>
          )}
      </section>
    </div>
  )
}
