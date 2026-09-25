'use client'

import { useRef, useState } from 'react'
import { Minus, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { Button, Card, ConfirmSheet, Field, Input, SegmentedControl, Textarea } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { formatCoin } from '@/shared/lib/format'
import { xuToVnd, type EconomyPolicy } from '@/shared/lib/economy'
import { adminErrorMessage, type AccountHit } from '../../api/adminApi'
import { useGrantXu } from '../../hooks/useAdmin'
import { AccountPicker } from './AccountPicker'

const QUICK = [10, 50, 100, 500, 1000]
const REASONS_ADD = ['Thưởng sự kiện', 'Tài trợ giải CLB', 'Bồi hoàn lỗi hệ thống', 'Quà đối tác']
const REASONS_SUB = ['Thu hồi do gian lận', 'Cộng nhầm, điều chỉnh lại']

/** Cộng / trừ Xu cho một người hoặc quỹ CLB. Bắt buộc lý do; có nhật ký và báo người nhận. */
export function GrantXuTab({ policy }: { policy: EconomyPolicy }) {
  const [target, setTarget] = useState<AccountHit | null>(null)
  const [mode, setMode] = useState<'ADD' | 'SUB'>('ADD')
  const [amount, setAmount] = useState(100)
  const [kind, setKind] = useState<'BONUS' | 'PAID'>('BONUS')
  const [reason, setReason] = useState('')
  const [confirm, setConfirm] = useState(false)
  const key = useRef(`grant-${crypto.randomUUID()}`)
  const grant = useGrantXu()

  const signed = mode === 'ADD' ? amount : -amount
  const after = target ? Math.round((target.balance + signed) * 10) / 10 : 0
  const error = !(amount > 0) ? 'Nhập số Xu lớn hơn 0' : amount > 1_000_000 ? 'Tối đa 1.000.000 Xu mỗi lần'
    : target && after < 0 ? `Chỉ trừ được tối đa ${formatCoin(target.balance)} Xu` : null
  const reasonError = reason.trim().length > 0 && reason.trim().length < 5 ? 'Ít nhất 5 ký tự' : null
  const ready = !!target && !error && reason.trim().length >= 5

  const submit = async () => {
    if (!target) return
    try {
      const r = await grant.mutateAsync({ kind: target.kind, id: target.id, amount: signed, coinKind: kind, reason: reason.trim(), key: key.current })
      toast.success(r.pending ? 'Vượt ngưỡng tự duyệt — đã gửi yêu cầu, chờ một admin khác duyệt ở tab Phê duyệt.'
        : r.duplicate ? 'Lệnh này đã được thực hiện trước đó.' : `${mode === 'ADD' ? 'Đã cộng' : 'Đã trừ'} ${formatCoin(amount)} Xu cho ${target.name}`)
      setTarget({ ...target, balance: Number(r.balance) })
      setReason('')
      key.current = `grant-${crypto.randomUUID()}`
      setConfirm(false)
    } catch (e) {
      toast.error(adminErrorMessage(e))
      setConfirm(false)
    }
  }

  return (
    <div className="space-y-4">
      <Card className="space-y-4">
        <Field label="Người nhận" htmlFor="grant-target" hint="Ví của một người hoặc quỹ CLB. Không cần gõ dấu: “nguyen an”, “nbnr”, email hoặc ID.">
          <AccountPicker id="grant-target" value={target} onChange={setTarget} />
        </Field>

        <SegmentedControl value={mode} onChange={(v) => setMode(v)}
          options={[{ value: 'ADD', label: 'Cộng Xu' }, { value: 'SUB', label: 'Trừ Xu' }]} />

        <Field label="Số Xu" htmlFor="grant-amount" error={error} hint={amount > 0 ? `Giá trị tham chiếu ${xuToVnd(amount, policy)}` : undefined}>
          <div className="flex items-center gap-2">
            <Button type="button" variant="secondary" aria-label="Giảm" className="w-11 shrink-0 px-0" onClick={() => setAmount(Math.max(0, amount - 10))}><Minus className="size-4" aria-hidden /></Button>
            <Input id="grant-amount" inputMode="decimal" className="text-center font-mono text-lg" value={String(amount).replace('.', ',')}
              onChange={(e) => { const v = Number(e.target.value.replace(',', '.')); if (!Number.isNaN(v)) setAmount(v) }} />
            <Button type="button" variant="secondary" aria-label="Tăng" className="w-11 shrink-0 px-0" onClick={() => setAmount(amount + 10)}><Plus className="size-4" aria-hidden /></Button>
          </div>
        </Field>
        <div className="flex flex-wrap gap-2">
          {QUICK.map((v) => (
            <button key={v} onClick={() => setAmount(v)} aria-pressed={amount === v}
              className={cn('rounded-full border px-3 py-1.5 font-mono text-xs font-semibold', amount === v ? 'border-coin bg-coin/10 text-coin' : 'border-border text-fg-muted')}>
              {formatCoin(v)}
            </button>
          ))}
        </div>

        <div className="space-y-1.5">
          <p className="text-sm font-medium text-fg-muted">Loại Xu</p>
          <div role="radiogroup" className="grid grid-cols-2 gap-2">
            {([['BONUS', 'Xu thưởng', 'Quà tặng, sự kiện — dùng trong app, không rút'], ['PAID', 'Xu nạp', 'Khách đã trả tiền (chuyển khoản, đối tác)']] as const).map(([k, t, d]) => (
              <button key={k} role="radio" aria-checked={kind === k} onClick={() => setKind(k)}
                className={cn('rounded-xl border p-3 text-left', kind === k ? 'border-coin/60 bg-coin/10' : 'border-border')}>
                <span className="block text-sm font-semibold">{t}</span>
                <span className="block text-xs text-fg-muted">{d}</span>
              </button>
            ))}
          </div>
        </div>

        <Field label="Lý do (ghi vào nhật ký và gửi cho người nhận)" htmlFor="grant-reason" error={reasonError}>
          <Textarea id="grant-reason" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)}
            placeholder="Ví dụ: Thưởng top 3 giải Hồ Tây tháng 10" />
        </Field>
        <div className="flex flex-wrap gap-2">
          {(mode === 'ADD' ? REASONS_ADD : REASONS_SUB).map((r) => (
            <button key={r} onClick={() => setReason(r)} className="rounded-full border border-border px-3 py-1.5 text-xs text-fg-muted hover:text-fg">{r}</button>
          ))}
        </div>
      </Card>

      {target && !error && (
        <Card className="flex items-center justify-between text-sm">
          <span className="text-fg-muted">Số dư {formatCoin(target.balance)} → </span>
          <span className={cn('font-mono text-lg font-bold', mode === 'ADD' ? 'text-brand' : 'text-warning')}>{formatCoin(after)} Xu</span>
        </Card>
      )}

      <Button block size="lg" variant={mode === 'ADD' ? 'primary' : 'danger'} disabled={!ready} onClick={() => setConfirm(true)}>
        {mode === 'ADD' ? `Cộng ${formatCoin(amount)} Xu` : `Trừ ${formatCoin(amount)} Xu`}
      </Button>

      <ConfirmSheet open={confirm} onClose={() => setConfirm(false)} onConfirm={submit} loading={grant.isPending} danger={mode === 'SUB'}
        title={mode === 'ADD' ? 'Xác nhận cộng Xu' : 'Xác nhận trừ Xu'} confirmLabel={mode === 'ADD' ? 'Cộng Xu' : 'Trừ Xu'}
        description="Lệnh được ghi sổ cái và nhật ký quản trị, không xóa được. Muốn hoàn tác hãy tạo lệnh ngược lại.">
        {target && (
          <ul className="space-y-1.5 text-sm">
            <li><span className="text-fg-subtle">Tài khoản: </span>{target.kind === 'CLUB' ? 'Quỹ CLB ' : ''}{target.name}</li>
            <li><span className="text-fg-subtle">Số Xu: </span><span className="font-mono font-semibold">{mode === 'ADD' ? '+' : '−'}{formatCoin(amount)}</span> ({kind === 'BONUS' ? 'Xu thưởng' : 'Xu nạp'})</li>
            <li><span className="text-fg-subtle">Lý do: </span>{reason.trim()}</li>
          </ul>
        )}
      </ConfirmSheet>
    </div>
  )
}
