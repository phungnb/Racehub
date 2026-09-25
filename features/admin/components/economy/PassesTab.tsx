'use client'

import { useState } from 'react'
import { Shield, Ticket, User } from 'lucide-react'
import { toast } from 'sonner'
import { Button, Card, ConfirmSheet, EmptyState, ErrorState, Field, Input, Skeleton } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { formatCoin, formatNumber } from '@/shared/lib/format'
import { creationFee, type EconomyPolicy } from '@/shared/lib/economy'
import { adminErrorMessage, type AccountHit, type Pass } from '../../api/adminApi'
import { useGrantPass, usePasses, useRevokePass } from '../../hooks/useAdmin'
import { AccountPicker } from './AccountPicker'

const SLOT_CHOICES = [10, 20, 50, 100, 500]
const EXPIRY = [{ label: 'Không hạn', days: 0 }, { label: '30 ngày', days: 30 }, { label: '90 ngày', days: 90 }]
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('vi-VN')

/** Tặng vé tạo thử thách miễn phí cho cá nhân / CLB; xem và thu hồi vé đã tặng */
export function PassesTab({ policy }: { policy: EconomyPolicy }) {
  const [target, setTarget] = useState<AccountHit | null>(null)
  const [qty, setQty] = useState(1)
  const [slots, setSlots] = useState(50)
  const [days, setDays] = useState(30)
  const [note, setNote] = useState('')
  const [revoking, setRevoking] = useState<Pass | null>(null)
  const [revokeReason, setRevokeReason] = useState('')
  const [now] = useState(() => Date.now())
  const grant = useGrantPass()
  const revoke = useRevokePass()
  const passes = usePasses()
  const worth = (creationFee(slots, policy.capacityTiers) ?? 0) * qty

  const submit = async () => {
    if (!target) return
    try {
      await grant.mutateAsync({ kind: target.kind, id: target.id, quantity: qty, maxSlots: slots,
        expiresAt: days ? new Date(Date.now() + days * 86_400_000).toISOString() : null, note: note.trim() })
      toast.success(`Đã tặng ${qty} lượt tạo cho ${target.name}`)
      setNote('')
    } catch (e) {
      toast.error(adminErrorMessage(e))
    }
  }

  const doRevoke = async () => {
    if (!revoking) return
    try {
      await revoke.mutateAsync({ id: revoking.id, reason: revokeReason.trim() })
      toast.success('Đã thu hồi vé')
      setRevoking(null); setRevokeReason('')
    } catch (e) {
      toast.error(adminErrorMessage(e))
    }
  }

  return (
    <div className="space-y-4">
      <Card className="space-y-4">
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand/15 text-brand"><Ticket className="size-5" aria-hidden /></span>
          <p className="text-sm text-fg-muted">Mỗi vé miễn phí trọn phí tạo cho <b className="text-fg">một</b> thử thách có số người tối đa không vượt mức của vé.
            Vé tự dùng khi tạo — vé CLB dùng cho thử thách nội bộ CLB, vé cá nhân cho thử thách của người đó.</p>
        </div>
        <Field label="Tặng cho" htmlFor="pass-target">
          <AccountPicker id="pass-target" value={target} onChange={setTarget} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Số vé" htmlFor="pass-qty" error={qty < 1 || qty > 100 ? '1 đến 100 vé' : null}>
            <Input id="pass-qty" inputMode="numeric" className="font-mono" value={qty}
              onChange={(e) => setQty(Math.floor(Number(e.target.value) || 0))} />
          </Field>
          <Field label="Tối đa mỗi thử thách" htmlFor="pass-slots" error={slots < 1 || slots > 10000 ? '1 đến 10.000 người' : null}>
            <Input id="pass-slots" inputMode="numeric" className="font-mono" value={slots}
              onChange={(e) => setSlots(Math.floor(Number(e.target.value) || 0))} />
          </Field>
        </div>
        <div className="flex flex-wrap gap-2">
          {SLOT_CHOICES.map((v) => (
            <button key={v} onClick={() => setSlots(v)} aria-pressed={slots === v}
              className={cn('rounded-full border px-3 py-1.5 text-xs font-semibold', slots === v ? 'border-brand bg-brand/10' : 'border-border text-fg-muted')}>
              {formatNumber(v)} người
            </button>
          ))}
        </div>
        <div className="space-y-1.5">
          <p className="text-sm font-medium text-fg-muted">Hạn dùng</p>
          <div className="flex gap-2">
            {EXPIRY.map((x) => (
              <button key={x.days} onClick={() => setDays(x.days)} aria-pressed={days === x.days}
                className={cn('flex-1 rounded-xl border px-3 py-2 text-sm font-semibold', days === x.days ? 'border-brand bg-brand/10' : 'border-border text-fg-muted')}>
                {x.label}
              </button>
            ))}
          </div>
        </div>
        <Field label="Ghi chú (hiện cho người nhận)" htmlFor="pass-note">
          <Input id="pass-note" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} placeholder="Ví dụ: Mừng CLB đạt 50 thành viên" />
        </Field>
        <p className="text-xs text-fg-subtle">Tương đương tối đa {formatCoin(worth)} Xu phí tạo theo biểu phí hiện tại.</p>
        <Button block onClick={submit} loading={grant.isPending} disabled={!target || qty < 1 || qty > 100 || slots < 1 || slots > 10000}>
          <Ticket className="size-4" aria-hidden /> Tặng {qty} vé
        </Button>
      </Card>

      <h2 className="text-lg font-semibold">Vé đã tặng</h2>
      {passes.isPending ? (
        <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-16" />)}</div>
      ) : passes.isError ? (
        <ErrorState message={adminErrorMessage(passes.error)} error={passes.error} onRetry={() => void passes.refetch()} />
      ) : !passes.data.length ? (
        <EmptyState icon={Ticket} title="Chưa tặng vé nào" description="Vé giúp CLB mới hoặc người tổ chức tích cực tạo thử thách lớn mà không mất Xu." />
      ) : (
        <ul className="space-y-2">
          {passes.data.map((p) => {
            const expired = !!p.expires_at && Date.parse(p.expires_at) <= now
            const active = p.remaining > 0 && !expired
            return (
              <li key={p.id} className={cn('flex items-center gap-3 rounded-xl border border-border bg-surface p-3', !active && 'opacity-60')}>
                <span className="grid size-9 shrink-0 place-items-center rounded-full bg-surface-2 text-fg-muted">
                  {p.owner_type === 'CLUB' ? <Shield className="size-4" aria-hidden /> : <User className="size-4" aria-hidden />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{p.owner_name ?? 'Tài khoản đã xóa'}</p>
                  <p className="truncate text-xs text-fg-muted">
                    ≤ {formatNumber(p.max_slots)} người · {p.expires_at ? `hạn ${fmtDate(p.expires_at)}` : 'không hạn'}{p.note ? ` · ${p.note}` : ''}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-mono text-sm font-semibold">{p.remaining}/{p.total}</p>
                  <p className="text-xs text-fg-subtle">{active ? 'còn lại' : expired ? 'hết hạn' : 'đã hết'}</p>
                </div>
                {active && <Button size="sm" variant="ghost" onClick={() => setRevoking(p)}>Thu hồi</Button>}
              </li>
            )
          })}
        </ul>
      )}

      <ConfirmSheet open={!!revoking} onClose={() => setRevoking(null)} onConfirm={doRevoke} loading={revoke.isPending}
        title="Thu hồi vé còn lại?" confirmLabel="Thu hồi"
        description={revoking ? `${revoking.remaining} vé của ${revoking.owner_name ?? 'tài khoản'} sẽ hết hiệu lực. Thử thách đã tạo bằng vé không bị ảnh hưởng.` : undefined}>
        <Field label="Lý do" htmlFor="revoke-reason" error={revokeReason.trim().length > 0 && revokeReason.trim().length < 5 ? 'Ít nhất 5 ký tự' : null}>
          <Input id="revoke-reason" value={revokeReason} onChange={(e) => setRevokeReason(e.target.value)} placeholder="Ví dụ: Cấp nhầm CLB" />
        </Field>
      </ConfirmSheet>
    </div>
  )
}
