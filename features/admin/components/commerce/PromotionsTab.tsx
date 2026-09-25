'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Gift, Megaphone, Percent, TicketPercent, Users, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button, Card, ConfirmSheet, EmptyState, ErrorState, Field, Input, SegmentedControl, Skeleton } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { formatCoin, formatNumber } from '@/shared/lib/format'
import { adminErrorMessage, type AccountHit } from '../../api/adminApi'
import { listPromotions, previewSegment, runGrant, savePromo, type Promotion, type Reward, type Segment, type SegmentType } from '../../api/commerceApi'
import { AccountPicker } from '../economy/AccountPicker'

type View = 'grant' | 'code' | 'sale' | 'history'
const SEGMENTS: { v: SegmentType; label: string }[] = [
  { v: 'ALL', label: 'Tất cả' }, { v: 'ACTIVE', label: 'Đang chạy' }, { v: 'INACTIVE', label: 'Lâu không chạy' }, { v: 'NEW', label: 'Người mới' },
  { v: 'VIP', label: 'Đang VIP' }, { v: 'FREE', label: 'Gói miễn phí' }, { v: 'CLUB', label: 'Thành viên CLB' }, { v: 'LEVEL', label: 'Từ cấp' },
  { v: 'USERS', label: 'Chọn từng người' },
]
const toLocal = (iso: string | null) => (iso ? new Date(new Date(iso).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '')
const fromLocal = (v: string) => (v ? new Date(v).toISOString() : null)
const digits = (v: string) => Number(v.replace(/\D/g, '') || 0)
const rewardText = (r: Reward) => [r.xu ? `${formatCoin(r.xu)} Xu` : null, r.passes ? `${r.passes.qty} lượt ≤${r.passes.max_slots} người` : null,
  r.plan ? `${r.plan.code} ${r.plan.months} tháng` : null].filter(Boolean).join(' + ') || '—'

/** Khuyến mãi: tặng hàng loạt theo nhóm, mã khuyến mãi, đợt giảm giá / nạp thêm Xu, lịch sử */
export function PromotionsTab() {
  const [view, setView] = useState<View>('grant')
  return (
    <div className="space-y-3">
      <SegmentedControl value={view} onChange={setView} options={[
        { value: 'grant', label: 'Tặng nhóm' }, { value: 'code', label: 'Mã' }, { value: 'sale', label: 'Giảm giá' }, { value: 'history', label: 'Lịch sử' },
      ]} />
      {view === 'grant' ? <GrantForm /> : view === 'code' ? <CodeForm /> : view === 'sale' ? <SaleForm /> : <History />}
    </div>
  )
}

function useRefresh() {
  const qc = useQueryClient()
  return () => { void qc.invalidateQueries({ queryKey: ['admin'] }); void qc.invalidateQueries({ queryKey: ['billing'] }) }
}

function SegmentPicker({ value, onChange }: { value: Segment; onChange: (s: Segment) => void }) {
  const [club, setClub] = useState<AccountHit | null>(null)
  const [users, setUsers] = useState<AccountHit[]>([])
  const [picker, setPicker] = useState<AccountHit | null>(null)
  const preview = useQuery({ queryKey: ['admin', 'segment', value], queryFn: () => previewSegment(value), enabled: value.type !== 'CLUB' || !!value.club_id })
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">Gửi cho</p>
      <div className="flex flex-wrap gap-1.5">
        {SEGMENTS.map((s) => (
          <button key={s.v} type="button" onClick={() => onChange({ type: s.v, days: 30, min_tier: 1, min_level: 3, club_id: club?.id, ids: users.map((u) => u.id) })}
            aria-pressed={value.type === s.v}
            className={cn('rounded-full border px-3 py-1.5 text-xs font-semibold', value.type === s.v ? 'border-brand bg-brand/10' : 'border-border text-fg-muted')}>{s.label}</button>
        ))}
      </div>
      {(value.type === 'ACTIVE' || value.type === 'INACTIVE' || value.type === 'NEW') && (
        <Field label={value.type === 'NEW' ? 'Đăng ký trong vòng (ngày)' : value.type === 'ACTIVE' ? 'Có bài chạy trong (ngày)' : 'Không chạy ít nhất (ngày)'} htmlFor="seg-days">
          <Input id="seg-days" inputMode="numeric" value={value.days ?? 30} onChange={(e) => onChange({ ...value, days: digits(e.target.value) || 1 })} />
        </Field>
      )}
      {value.type === 'VIP' && (
        <Field label="Từ bậc VIP" htmlFor="seg-tier"><Input id="seg-tier" inputMode="numeric" value={value.min_tier ?? 1} onChange={(e) => onChange({ ...value, min_tier: Math.min(3, digits(e.target.value) || 1) })} /></Field>
      )}
      {value.type === 'LEVEL' && (
        <Field label="Từ cấp" htmlFor="seg-level"><Input id="seg-level" inputMode="numeric" value={value.min_level ?? 3} onChange={(e) => onChange({ ...value, min_level: Math.min(8, digits(e.target.value) || 1) })} /></Field>
      )}
      {value.type === 'CLUB' && (
        <AccountPicker id="seg-club" value={club} onChange={(a) => { const c = a?.kind === 'CLUB' ? a : null; setClub(c); onChange({ ...value, club_id: c?.id }); if (a && a.kind !== 'CLUB') toast.error('Hãy chọn một CLB') }} />
      )}
      {value.type === 'USERS' && (
        <div className="space-y-2">
          <AccountPicker id="seg-user" value={picker} onChange={(a) => {
            if (a?.kind === 'USER' && !users.some((u) => u.id === a.id)) { const next = [...users, a]; setUsers(next); onChange({ ...value, ids: next.map((u) => u.id) }) }
            setPicker(null)
          }} />
          <div className="flex flex-wrap gap-1.5">
            {users.map((u) => (
              <span key={u.id} className="flex items-center gap-1 rounded-full bg-surface-2 px-2 py-1 text-xs">{u.name}
                <button type="button" aria-label={`Bỏ ${u.name}`} onClick={() => { const next = users.filter((x) => x.id !== u.id); setUsers(next); onChange({ ...value, ids: next.map((x) => x.id) }) }}>
                  <X className="size-3" aria-hidden /></button></span>
            ))}
          </div>
        </div>
      )}
      <p className="flex items-center gap-1.5 text-xs text-fg-muted"><Users className="size-3.5" aria-hidden />
        {preview.data ? `${formatNumber(preview.data.count)} người${preview.data.sample.length ? ` — ví dụ: ${preview.data.sample.join(', ')}` : ''}` : 'Đang đếm…'}
      </p>
    </div>
  )
}

function RewardFields({ value, onChange }: { value: Reward; onChange: (r: Reward) => void }) {
  return (
    <div className="space-y-3 rounded-xl border border-border p-3">
      <p className="text-sm font-medium">Phần thưởng</p>
      <Field label="Xu (Xu thưởng)" htmlFor="rw-xu"><Input id="rw-xu" inputMode="numeric" className="font-mono" value={value.xu || ''} onChange={(e) => onChange({ ...value, xu: digits(e.target.value) })} placeholder="0" /></Field>
      <label className="flex items-center justify-between text-sm">Tặng lượt tạo thử thách / giải
        <input type="checkbox" checked={!!value.passes} onChange={(e) => onChange({ ...value, passes: e.target.checked ? { qty: 1, max_slots: 20, days: 30 } : null })} className="size-5 accent-[var(--color-brand)]" /></label>
      {value.passes && (
        <div className="grid grid-cols-3 gap-2">
          <Field label="Số lượt" htmlFor="rw-qty"><Input id="rw-qty" inputMode="numeric" value={value.passes.qty} onChange={(e) => onChange({ ...value, passes: { ...value.passes!, qty: Math.min(100, digits(e.target.value) || 1) } })} /></Field>
          <Field label="≤ người" htmlFor="rw-slots"><Input id="rw-slots" inputMode="numeric" value={value.passes.max_slots} onChange={(e) => onChange({ ...value, passes: { ...value.passes!, max_slots: Math.min(10000, digits(e.target.value) || 1) } })} /></Field>
          <Field label="Hạn (ngày)" htmlFor="rw-days"><Input id="rw-days" inputMode="numeric" value={value.passes.days} onChange={(e) => onChange({ ...value, passes: { ...value.passes!, days: Math.min(365, digits(e.target.value) || 1) } })} /></Field>
        </div>
      )}
      <label className="flex items-center justify-between text-sm">Tặng gói VIP
        <input type="checkbox" checked={!!value.plan} onChange={(e) => onChange({ ...value, plan: e.target.checked ? { code: 'VIP1', months: 1 } : null })} className="size-5 accent-[var(--color-brand)]" /></label>
      {value.plan && (
        <div className="grid grid-cols-2 gap-2">
          <select aria-label="Gói" value={value.plan.code} onChange={(e) => onChange({ ...value, plan: { ...value.plan!, code: e.target.value } })} className="h-11 rounded-xl border border-border bg-surface px-3 text-sm">
            {['VIP1', 'VIP2', 'VIP3'].map((c) => <option key={c}>{c}</option>)}
          </select>
          <select aria-label="Số tháng" value={value.plan.months} onChange={(e) => onChange({ ...value, plan: { ...value.plan!, months: Number(e.target.value) } })} className="h-11 rounded-xl border border-border bg-surface px-3 text-sm">
            {[1, 3, 6, 12].map((m) => <option key={m} value={m}>{m} tháng</option>)}
          </select>
        </div>
      )}
    </div>
  )
}

const hasReward = (r: Reward) => (r.xu ?? 0) > 0 || !!r.passes || !!r.plan

function GrantForm() {
  const refresh = useRefresh()
  const [title, setTitle] = useState('')
  const [message, setMessage] = useState('')
  const [segment, setSegment] = useState<Segment>({ type: 'ALL' })
  const [reward, setReward] = useState<Reward>({ xu: 50 })
  const [confirm, setConfirm] = useState(false)
  const run = useMutation({
    mutationFn: () => runGrant({ title: title.trim(), message: message.trim(), segment, reward }),
    onSuccess: (r) => { toast.success(`Đã tặng cho ${formatNumber(r.recipients)} người`); setConfirm(false); setTitle(''); setMessage(''); refresh() },
    onError: (e) => { toast.error(adminErrorMessage(e)); setConfirm(false) },
  })
  return (
    <Card className="space-y-3">
      <p className="flex items-center gap-2 font-semibold"><Megaphone className="size-4 text-coin" aria-hidden />Tặng hàng loạt</p>
      <Field label="Tên đợt (hiện trong thông báo)" htmlFor="g-title"><Input id="g-title" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} placeholder="VD: Mừng 10.000 runner" /></Field>
      <Field label="Lời nhắn (không bắt buộc)" htmlFor="g-msg"><Input id="g-msg" value={message} maxLength={300} onChange={(e) => setMessage(e.target.value)} /></Field>
      <SegmentPicker value={segment} onChange={setSegment} />
      <RewardFields value={reward} onChange={setReward} />
      <Button block onClick={() => setConfirm(true)} disabled={title.trim().length < 2 || !hasReward(reward)}>Xem lại & gửi</Button>
      <ConfirmSheet open={confirm} onClose={() => setConfirm(false)} onConfirm={() => run.mutate()} loading={run.isPending} danger={false}
        title="Gửi khuyến mãi?" confirmLabel="Gửi ngay" description={`${title} — ${rewardText(reward)} mỗi người. Mỗi người chỉ nhận một lần trong đợt này; không hoàn tác được.`} />
    </Card>
  )
}

function CodeForm() {
  const refresh = useRefresh()
  const [title, setTitle] = useState('')
  const [code, setCode] = useState('')
  const [maxUses, setMaxUses] = useState('')
  const [endsAt, setEndsAt] = useState<string | null>(null)
  const [limit, setLimit] = useState(false)
  const [segment, setSegment] = useState<Segment>({ type: 'NEW', days: 14 })
  const [reward, setReward] = useState<Reward>({ xu: 20 })
  const save = useMutation({
    mutationFn: () => savePromo({ kind: 'CODE', title: title.trim(), code, max_uses: maxUses ? Number(maxUses) : null, ends_at: endsAt, reward, segment: limit ? segment : null }),
    onSuccess: () => { toast.success(`Đã tạo mã ${code}`); setCode(''); setTitle(''); refresh() },
    onError: (e) => toast.error(adminErrorMessage(e)),
  })
  return (
    <Card className="space-y-3">
      <p className="flex items-center gap-2 font-semibold"><TicketPercent className="size-4 text-coin" aria-hidden />Mã khuyến mãi</p>
      <p className="text-xs text-fg-muted">Người dùng nhập ở Ví → &ldquo;Nhập mã khuyến mãi&rdquo;. Mỗi tài khoản dùng một lần; nhập sai 10 lần / giờ sẽ bị khóa tạm.</p>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Mã" htmlFor="c-code"><Input id="c-code" className="font-mono uppercase" value={code} onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 24))} placeholder="RUN2026" /></Field>
        <Field label="Tổng lượt dùng" htmlFor="c-max" hint="Để trống = không giới hạn"><Input id="c-max" inputMode="numeric" value={maxUses} onChange={(e) => setMaxUses(e.target.value.replace(/\D/g, ''))} /></Field>
      </div>
      <Field label="Tên mã (hiện khi nhập thành công)" htmlFor="c-title"><Input id="c-title" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} placeholder="Quà chào mừng" /></Field>
      <Field label="Hết hạn" htmlFor="c-end" hint="Để trống = không hạn"><Input id="c-end" type="datetime-local" value={toLocal(endsAt)} onChange={(e) => setEndsAt(fromLocal(e.target.value))} /></Field>
      <RewardFields value={reward} onChange={setReward} />
      <label className="flex items-center justify-between text-sm">Chỉ cho một nhóm người dùng
        <input type="checkbox" checked={limit} onChange={(e) => setLimit(e.target.checked)} className="size-5 accent-[var(--color-brand)]" /></label>
      {limit && <SegmentPicker value={segment} onChange={setSegment} />}
      <Button block onClick={() => save.mutate()} loading={save.isPending} disabled={code.length < 4 || title.trim().length < 2 || !hasReward(reward)}>Tạo mã</Button>
    </Card>
  )
}

function SaleForm() {
  const refresh = useRefresh()
  const [title, setTitle] = useState('')
  const [message, setMessage] = useState('')
  const [applies, setApplies] = useState<'ALL' | 'PLAN' | 'XU'>('PLAN')
  const [plan, setPlan] = useState('')
  const [discount, setDiscount] = useState(20)
  const [bonus, setBonus] = useState(0)
  const [startsAt, setStartsAt] = useState<string | null>(null)
  const [endsAt, setEndsAt] = useState<string | null>(null)
  const save = useMutation({
    mutationFn: () => savePromo({ kind: 'SALE', title: title.trim(), message: message.trim() || null, applies_to: applies, plan_code: applies === 'PLAN' && plan ? plan : null,
      discount_pct: discount, bonus_pct: applies === 'PLAN' ? 0 : bonus, starts_at: startsAt ?? undefined, ends_at: endsAt }),
    onSuccess: () => { toast.success('Đã bật đợt giảm giá'); setTitle(''); refresh() },
    onError: (e) => toast.error(adminErrorMessage(e)),
  })
  return (
    <Card className="space-y-3">
      <p className="flex items-center gap-2 font-semibold"><Percent className="size-4 text-coin" aria-hidden />Giảm giá / nạp thêm Xu</p>
      <p className="text-xs text-fg-muted">Áp thẳng vào đơn hàng trong khoảng thời gian chọn; trang Gói VIP & Nạp Xu hiện giá gạch và băng rôn đợt khuyến mãi.</p>
      <Field label="Tên đợt" htmlFor="s-title"><Input id="s-title" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} placeholder="Sale 10/10" /></Field>
      <Field label="Lời nhắn (không bắt buộc)" htmlFor="s-msg"><Input id="s-msg" value={message} maxLength={300} onChange={(e) => setMessage(e.target.value)} /></Field>
      <div className="grid grid-cols-3 gap-1.5" role="radiogroup" aria-label="Áp dụng cho">
        {(['PLAN', 'XU', 'ALL'] as const).map((a) => (
          <button key={a} type="button" role="radio" aria-checked={applies === a} onClick={() => setApplies(a)}
            className={cn('rounded-lg border py-2 text-xs font-semibold', applies === a ? 'border-brand bg-brand/10' : 'border-border text-fg-muted')}>
            {a === 'PLAN' ? 'Gói VIP / Pro' : a === 'XU' ? 'Nạp Xu' : 'Tất cả'}
          </button>
        ))}
      </div>
      {applies === 'PLAN' && (
        <select aria-label="Gói áp dụng" value={plan} onChange={(e) => setPlan(e.target.value)} className="h-11 w-full rounded-xl border border-border bg-surface px-3 text-sm">
          <option value="">Mọi gói</option>{['VIP1', 'VIP2', 'VIP3', 'CLUB_PRO'].map((c) => <option key={c}>{c}</option>)}
        </select>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Giảm giá (%)" htmlFor="s-disc"><Input id="s-disc" inputMode="numeric" value={discount} onChange={(e) => setDiscount(Math.min(90, digits(e.target.value)))} /></Field>
        {applies !== 'PLAN' && <Field label="Tặng thêm Xu khi nạp (%)" htmlFor="s-bonus"><Input id="s-bonus" inputMode="numeric" value={bonus} onChange={(e) => setBonus(Math.min(300, digits(e.target.value)))} /></Field>}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Bắt đầu" htmlFor="s-start" hint="Trống = ngay"><Input id="s-start" type="datetime-local" value={toLocal(startsAt)} onChange={(e) => setStartsAt(fromLocal(e.target.value))} /></Field>
        <Field label="Kết thúc" htmlFor="s-end" hint="Trống = tới khi tắt"><Input id="s-end" type="datetime-local" value={toLocal(endsAt)} onChange={(e) => setEndsAt(fromLocal(e.target.value))} /></Field>
      </div>
      <Button block onClick={() => save.mutate()} loading={save.isPending} disabled={title.trim().length < 2 || (!discount && !bonus)}>Bật đợt khuyến mãi</Button>
    </Card>
  )
}

function History() {
  const refresh = useRefresh()
  const q = useQuery({ queryKey: ['admin', 'promotions'], queryFn: listPromotions })
  const toggle = useMutation({
    mutationFn: (p: Promotion) => savePromo({ ...p, kind: p.kind as 'CODE' | 'SALE', is_active: !p.is_active }),
    onSuccess: () => { toast.success('Đã cập nhật'); refresh() },
    onError: (e) => toast.error(adminErrorMessage(e)),
  })
  if (q.isPending) return <Skeleton className="h-40" />
  if (q.isError) return <ErrorState message={adminErrorMessage(q.error)} error={q.error} onRetry={() => void q.refetch()} />
  if (!q.data.length) return <EmptyState icon={Gift} title="Chưa có khuyến mãi nào" />
  return (
    <ul className="divide-y divide-border rounded-xl border border-border bg-surface">
      {q.data.map((p) => (
        <li key={p.id} className={cn('flex items-center gap-3 p-3', !p.is_active && 'opacity-60')}>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold">{p.kind === 'CODE' ? `${p.code} · ` : ''}{p.title}</span>
            <span className="block text-xs text-fg-muted">
              {p.kind === 'GRANT' ? `Tặng nhóm · ${rewardText(p.reward)} · ${formatNumber(p.recipients)} người nhận`
                : p.kind === 'CODE' ? `Mã · ${rewardText(p.reward)} · đã dùng ${formatNumber(p.recipients)}${p.max_uses ? `/${formatNumber(p.max_uses)}` : ''}`
                : `Giảm giá · ${p.discount_pct ? `−${p.discount_pct}%` : ''}${p.bonus_pct ? ` +${p.bonus_pct}% Xu` : ''} ${p.applies_to === 'XU' ? 'nạp Xu' : p.applies_to === 'PLAN' ? (p.plan_code ?? 'mọi gói') : 'tất cả'} · ${formatNumber(p.orders)} đơn`}
              {p.ends_at ? ` · đến ${new Date(p.ends_at).toLocaleDateString('vi-VN')}` : ''}
            </span>
            <span className="block text-[11px] text-fg-subtle">{new Date(p.created_at).toLocaleString('vi-VN')}{p.creator ? ` · ${p.creator}` : ''}</span>
          </span>
          {p.kind !== 'GRANT' && (
            <Button size="sm" variant="secondary" onClick={() => toggle.mutate(p)} loading={toggle.isPending && toggle.variables?.id === p.id}>{p.is_active ? 'Tắt' : 'Bật'}</Button>
          )}
        </li>
      ))}
    </ul>
  )
}
