'use client'

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Crown, Landmark, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button, Card, ErrorState, Field, Input, SectionTitle, Skeleton, Textarea } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { formatVnd } from '@/shared/lib/economy'
import { formatCoin } from '@/shared/lib/format'
import { vietQrUrl } from '@/shared/lib/vietqr'
import { MONTH_LABEL, usePricing, type PaymentAccount, type Plan, type XuPackage } from '@/features/billing'
import { adminErrorMessage, type AccountHit } from '../../api/adminApi'
import { grantPlan, savePlan, saveXuPackage, setPaymentAccount } from '../../api/commerceApi'
import { AccountPicker } from '../economy/AccountPicker'

const MONTHS = [1, 3, 6, 12]
const digits = (v: string) => Number(v.replace(/\D/g, '') || 0)

function useRefresh() {
  const qc = useQueryClient()
  return () => { void qc.invalidateQueries({ queryKey: ['billing'] }); void qc.invalidateQueries({ queryKey: ['admin'] }) }
}

/** Gói & giá: tài khoản nhận tiền, bảng giá VIP / CLB Pro, lượt tạo mỗi tháng, gói nạp Xu, cấp gói thủ công */
export function PlansTab() {
  const q = usePricing()
  if (q.isPending) return <Skeleton className="h-96" />
  if (q.isError) return <ErrorState message={adminErrorMessage(q.error)} onRetry={() => void q.refetch()} />
  return (
    <div className="space-y-6">
      <PaymentForm current={q.data.payment} />
      <section className="space-y-3">
        <SectionTitle>Bảng giá gói</SectionTitle>
        {q.data.plans.map((p) => <PlanEditor key={p.code + JSON.stringify(p)} plan={p} />)}
      </section>
      <PackagesEditor packages={q.data.packages} />
      <GrantPlanForm plans={q.data.plans} />
    </div>
  )
}

function PaymentForm({ current }: { current: PaymentAccount }) {
  const refresh = useRefresh()
  const [bin, setBin] = useState(current.bank_bin ?? '')
  const [no, setNo] = useState(current.account_no ?? '')
  const [name, setName] = useState(current.account_name ?? '')
  const save = useMutation({
    mutationFn: () => setPaymentAccount(bin.trim(), no.trim(), name.trim()),
    onSuccess: () => { toast.success('Đã lưu tài khoản nhận tiền'); refresh() },
    onError: (e) => toast.error(adminErrorMessage(e)),
  })
  const ready = /^\d{6}$/.test(bin) && no.length >= 4 && name.trim().length >= 3
  return (
    <Card className="space-y-3">
      <p className="flex items-center gap-2 font-semibold"><Landmark className="size-4 text-fg-muted" aria-hidden />Tài khoản nhận tiền (VietQR)</p>
      {!current.account_no && <p className="rounded-lg bg-warning/10 p-2 text-xs text-warning">Chưa cài — người mua sẽ không thấy mã QR.</p>}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Mã BIN ngân hàng" htmlFor="pay-bin" hint="VD: 970436 (VCB), 970422 (MB)">
          <Input id="pay-bin" inputMode="numeric" value={bin} onChange={(e) => setBin(e.target.value.replace(/\D/g, '').slice(0, 6))} />
        </Field>
        <Field label="Số tài khoản" htmlFor="pay-no">
          <Input id="pay-no" value={no} onChange={(e) => setNo(e.target.value.replace(/[^0-9A-Za-z]/g, '').slice(0, 30))} />
        </Field>
      </div>
      <Field label="Tên chủ tài khoản" htmlFor="pay-name"><Input id="pay-name" value={name} onChange={(e) => setName(e.target.value.toUpperCase())} /></Field>
      {ready && (
        // eslint-disable-next-line @next/next/no-img-element -- xem thử mã QR động
        <img src={vietQrUrl({ bin, account_no: no, account_name: name }, 10000, 'RHTEST')} alt="Xem thử mã VietQR 10.000đ" className="mx-auto w-40 rounded-lg bg-white p-1" />
      )}
      <Button block onClick={() => save.mutate()} loading={save.isPending} disabled={!ready}>Lưu tài khoản</Button>
    </Card>
  )
}

function PlanEditor({ plan }: { plan: Plan }) {
  const refresh = useRefresh()
  const [name, setName] = useState(plan.name)
  const [desc, setDesc] = useState(plan.description ?? '')
  const [perks, setPerks] = useState(plan.perks.join('\n'))
  const [active, setActive] = useState(plan.active)
  const [prices, setPrices] = useState(() => MONTHS.map((m) => {
    const p = plan.prices.find((x) => x.months === m)
    return { months: m, price_vnd: p?.price_vnd ?? 0, active: !!p?.active }
  }))
  const [credits, setCredits] = useState(plan.credits)
  const save = useMutation({
    mutationFn: () => savePlan({
      code: plan.code, name: name.trim(), description: desc.trim() || null, active,
      perks: perks.split('\n').map((s) => s.trim()).filter(Boolean),
      prices: prices.filter((p) => p.price_vnd > 0 || p.active),
      credits: credits.filter((c) => c.capacity > 0 && c.per_month > 0),
    }),
    onSuccess: () => { toast.success(`Đã lưu ${name}`); refresh() },
    onError: (e) => toast.error(adminErrorMessage(e)),
  })
  return (
    <Card className="space-y-3">
      <div className="flex items-center gap-2">
        <Crown className="size-4 text-coin" aria-hidden />
        <p className="flex-1 font-semibold">{plan.code} · {plan.owner_type === 'CLUB' ? 'CLB' : 'Cá nhân'}</p>
        <label className="flex items-center gap-2 text-sm">Đang bán
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="size-5 accent-[var(--color-brand)]" /></label>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Tên hiển thị" htmlFor={`pl-name-${plan.code}`}><Input id={`pl-name-${plan.code}`} value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Mô tả ngắn" htmlFor={`pl-desc-${plan.code}`}><Input id={`pl-desc-${plan.code}`} value={desc} onChange={(e) => setDesc(e.target.value)} /></Field>
      </div>
      <p className="text-xs font-medium text-fg-muted">Giá theo kỳ hạn (0 = không bán)</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {prices.map((p, i) => (
          <label key={p.months} className={cn('space-y-1 rounded-xl border p-2', p.active ? 'border-brand/50' : 'border-border')}>
            <span className="flex items-center justify-between text-xs font-semibold">{MONTH_LABEL[p.months]}
              <input type="checkbox" checked={p.active} aria-label={`Bán kỳ ${MONTH_LABEL[p.months]}`} className="size-4 accent-[var(--color-brand)]"
                onChange={(e) => setPrices(prices.map((x, j) => (j === i ? { ...x, active: e.target.checked } : x)))} /></span>
            <Input inputMode="numeric" className="font-mono" value={p.price_vnd ? p.price_vnd.toLocaleString('vi-VN') : ''} placeholder="0" aria-label={`Giá ${MONTH_LABEL[p.months]}`}
              onChange={(e) => setPrices(prices.map((x, j) => (j === i ? { ...x, price_vnd: digits(e.target.value) } : x)))} />
          </label>
        ))}
      </div>
      <p className="text-xs font-medium text-fg-muted">Lượt tạo thử thách / giải mỗi tháng (quy mô tối đa — số lượt)</p>
      <div className="space-y-2">
        {credits.map((c, i) => (
          <div key={i} className="flex items-center gap-2">
            <Input inputMode="numeric" className="font-mono" value={c.capacity || ''} placeholder="≤ người" aria-label="Quy mô tối đa"
              onChange={(e) => setCredits(credits.map((x, j) => (j === i ? { ...x, capacity: digits(e.target.value) } : x)))} />
            <Input inputMode="numeric" className="font-mono" value={c.per_month || ''} placeholder="lượt/tháng" aria-label="Số lượt mỗi tháng"
              onChange={(e) => setCredits(credits.map((x, j) => (j === i ? { ...x, per_month: digits(e.target.value) } : x)))} />
            <Button size="sm" variant="ghost" aria-label="Xóa" onClick={() => setCredits(credits.filter((_, j) => j !== i))}><Trash2 className="size-4" aria-hidden /></Button>
          </div>
        ))}
        <Button size="sm" variant="secondary" onClick={() => setCredits([...credits, { capacity: 50, per_month: 1 }])}><Plus className="size-4" aria-hidden />Thêm lượt</Button>
      </div>
      <Field label="Quyền lợi (mỗi dòng một ý)" htmlFor={`pl-perks-${plan.code}`}>
        <Textarea id={`pl-perks-${plan.code}`} rows={4} value={perks} onChange={(e) => setPerks(e.target.value)} />
      </Field>
      <Button block onClick={() => save.mutate()} loading={save.isPending}>Lưu {plan.code}</Button>
    </Card>
  )
}

function PackagesEditor({ packages }: { packages: XuPackage[] }) {
  const refresh = useRefresh()
  const [rows, setRows] = useState<(Omit<XuPackage, 'id'> & { id?: string })[]>(packages)
  const save = useMutation({
    mutationFn: async () => { for (const r of rows) await saveXuPackage(r) },
    onSuccess: () => { toast.success('Đã lưu gói nạp Xu'); refresh() },
    onError: (e) => toast.error(adminErrorMessage(e)),
  })
  const set = (i: number, patch: Partial<XuPackage>) => setRows(rows.map((x, j) => (j === i ? { ...x, ...patch } : x)))
  return (
    <section className="space-y-3">
      <SectionTitle>Gói nạp Xu</SectionTitle>
      <Card className="space-y-2">
        <div className="grid grid-cols-[1fr_1fr_1.3fr_auto] gap-2 text-[11px] font-semibold text-fg-subtle"><span>Xu</span><span>Tặng thêm</span><span>Giá (đ)</span><span>Bán</span></div>
        {rows.map((r, i) => (
          <div key={r.id ?? `new-${i}`} className="grid grid-cols-[1fr_1fr_1.3fr_auto] items-center gap-2">
            <Input inputMode="numeric" className="font-mono" value={r.xu || ''} aria-label="Số Xu" onChange={(e) => set(i, { xu: digits(e.target.value) })} />
            <Input inputMode="numeric" className="font-mono" value={r.bonus_xu || ''} placeholder="0" aria-label="Xu tặng thêm" onChange={(e) => set(i, { bonus_xu: digits(e.target.value) })} />
            <Input inputMode="numeric" className="font-mono" value={r.price_vnd ? r.price_vnd.toLocaleString('vi-VN') : ''} aria-label="Giá"
              onChange={(e) => set(i, { price_vnd: digits(e.target.value) })} />
            <input type="checkbox" checked={r.active} aria-label="Đang bán" onChange={(e) => set(i, { active: e.target.checked })} className="size-5 accent-[var(--color-brand)]" />
          </div>
        ))}
        <p className="text-xs text-fg-subtle">
          {rows.filter((r) => r.active && r.xu > 0).map((r) => `${formatCoin(r.xu + r.bonus_xu)} Xu = ${formatVnd(r.price_vnd)}`).join(' · ')}
        </p>
        <div className="flex gap-2">
          <Button variant="secondary" className="shrink-0" onClick={() => setRows([...rows, { xu: 100, bonus_xu: 0, price_vnd: 10000, active: true, sort: rows.length + 1 }])}>
            <Plus className="size-4" aria-hidden />Thêm gói
          </Button>
          <Button block onClick={() => save.mutate()} loading={save.isPending}>Lưu gói nạp</Button>
        </div>
      </Card>
    </section>
  )
}

function GrantPlanForm({ plans }: { plans: Plan[] }) {
  const refresh = useRefresh()
  const [target, setTarget] = useState<AccountHit | null>(null)
  const [plan, setPlan] = useState('')
  const [months, setMonths] = useState(1)
  const [reason, setReason] = useState('')
  const options = plans.filter((p) => !target || p.owner_type === target.kind)
  const code = options.find((p) => p.code === plan)?.code ?? options[0]?.code ?? ''
  const grant = useMutation({
    mutationFn: () => grantPlan({ kind: target!.kind, id: target!.id, plan: code, months, reason: reason.trim() }),
    onSuccess: () => { toast.success(`Đã cấp ${code} ${MONTH_LABEL[months]} cho ${target?.name}`); setReason(''); refresh() },
    onError: (e) => toast.error(adminErrorMessage(e)),
  })
  return (
    <section className="space-y-3">
      <SectionTitle>Cấp gói thủ công</SectionTitle>
      <Card className="space-y-3">
        <p className="text-xs text-fg-muted">Dùng cho tài trợ, đối tác, bồi hoàn. Có nhật ký và thông báo cho người nhận.</p>
        <AccountPicker id="grant-plan-target" value={target} onChange={setTarget} />
        <div className="flex flex-wrap gap-2">
          {options.map((p) => (
            <button key={p.code} onClick={() => setPlan(p.code)} aria-pressed={code === p.code}
              className={cn('rounded-full border px-3 py-1.5 text-sm font-semibold', code === p.code ? 'border-brand bg-brand/10' : 'border-border text-fg-muted')}>{p.name}</button>
          ))}
        </div>
        <div className="flex gap-2">
          {MONTHS.map((m) => (
            <button key={m} onClick={() => setMonths(m)} aria-pressed={months === m}
              className={cn('flex-1 rounded-xl border py-2 text-sm font-semibold', months === m ? 'border-brand bg-brand/10' : 'border-border text-fg-muted')}>{MONTH_LABEL[m]}</button>
          ))}
        </div>
        <Field label="Lý do" htmlFor="grant-plan-reason"><Input id="grant-plan-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="VD: Tài trợ giải CLB tháng 10" /></Field>
        <Button block onClick={() => grant.mutate()} loading={grant.isPending} disabled={!target || !code || reason.trim().length < 3}>Cấp gói</Button>
      </Card>
    </section>
  )
}
