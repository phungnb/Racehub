'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Button, Card, ConfirmSheet, Field, Input } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { formatCoin, formatNumber } from '@/shared/lib/format'
import { creationFee, DEFAULT_POLICY, feePolicyText, runReward, validatePolicy, xuToVnd, type EconomyPolicy } from '@/shared/lib/economy'
import { adminErrorMessage } from '../../api/adminApi'
import { usePublishPolicy } from '../../hooks/useAdmin'

const SIM_SLOTS = [2, 5, 6, 10, 11, 20, 50, 100, 500]
const SIM_KM = [3, 5, 10, 21.1, 42.2]

function Num({ id, label, value, onChange, unit, hint }: {
  id: string; label: string; value: number; onChange: (v: number) => void; unit: string; hint?: string
}) {
  const [text, setText] = useState(String(value).replace('.', ','))
  return (
    <Field label={label} htmlFor={id} hint={hint}>
      <div className="relative">
        <Input id={id} inputMode="decimal" className="pr-20 font-mono" value={text}
          onChange={(e) => { setText(e.target.value); const v = Number(e.target.value.replace(',', '.')); if (!Number.isNaN(v)) onChange(v) }} />
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-fg-subtle">{unit}</span>
      </div>
    </Field>
  )
}

/** Chính sách Xu: giá trị tham chiếu, mức thưởng chạy, biểu phí thử thách — có mô phỏng trước khi lưu */
export function PolicyTab({ policy, raw }: { policy: EconomyPolicy; raw: Record<string, unknown> }) {
  const [p, setP] = useState<EconomyPolicy>(policy)
  const [confirm, setConfirm] = useState(false)
  const [formKey, setFormKey] = useState(0)
  const publish = usePublishPolicy()
  const f = p.challengeFee
  const setFee = (patch: Partial<EconomyPolicy['challengeFee']>) => setP({ ...p, challengeFee: { ...f, ...patch } })
  const error = validatePolicy(p)
  const dirty = JSON.stringify(p) !== JSON.stringify(policy)

  const save = async () => {
    try {
      const v = await publish.mutateAsync({ current: raw, next: p })
      toast.success(`Đã áp dụng chính sách phiên bản ${v}`)
      setConfirm(false)
    } catch (e) {
      toast.error(adminErrorMessage(e))
      setConfirm(false)
    }
  }
  const reset = (to: EconomyPolicy) => { setP(to); setFormKey((k) => k + 1) }

  return (
    <div className="space-y-4" key={formKey}>
      <Card className="space-y-3">
        <h2 className="font-semibold">Giá trị Xu</h2>
        <Num id="pol-vnd" label="1 Xu tương đương" unit="đồng" value={p.xuVnd} onChange={(v) => setP({ ...p, xuVnd: v })}
          hint="Chỉ để quy đổi tham chiếu khi bán gói Xu, tài trợ, hiển thị — Xu không rút ra tiền" />
      </Card>

      <Card className="space-y-3">
        <h2 className="font-semibold">Xu kiếm từ chạy bộ</h2>
        <div className="grid grid-cols-2 gap-3">
          <Num id="pol-first" label="Km đầu tiên" unit="Xu" value={p.firstKmXu} onChange={(v) => setP({ ...p, firstKmXu: v })} />
          <Num id="pol-extra" label="Mỗi km tiếp theo" unit="Xu/km" value={p.extraKmXu} onChange={(v) => setP({ ...p, extraKmXu: v })} />
        </div>
        <Num id="pol-cap" label="Trần mỗi ngày" unit="Xu/ngày" value={p.maxDailyReward} onChange={(v) => setP({ ...p, maxDailyReward: v })}
          hint="Chặn cày Xu: chạy bao nhiêu cũng không vượt mức này trong một ngày" />
        <div className="grid grid-cols-5 gap-1.5 text-center">
          {SIM_KM.map((km) => (
            <div key={km} className="rounded-lg bg-bg/60 px-1 py-2">
              <p className="text-xs text-fg-subtle">{formatNumber(km)} km</p>
              <p className="font-mono text-sm font-semibold text-coin">{formatCoin(runReward(km, p))}</p>
            </div>
          ))}
        </div>
        <p className="text-xs text-fg-subtle">
          Chạy 5 km mỗi ngày ≈ {formatCoin(runReward(5, p) * 30)} Xu/tháng ({xuToVnd(runReward(5, p) * 30, p)}).
        </p>
      </Card>

      <Card className="space-y-3">
        <h2 className="font-semibold">Phí tạo thử thách (theo số người tối đa)</h2>
        <div className="grid grid-cols-2 gap-3">
          <Num id="pol-free" label="Miễn phí tới" unit="người" value={f.freeMaxSlots} onChange={(v) => setFee({ freeMaxSlots: v })} />
          <Num id="pol-mid" label="Mức giữa tới" unit="người" value={f.midMaxSlots} onChange={(v) => setFee({ midMaxSlots: v })} />
          <Num id="pol-midrate" label="Đơn giá mức giữa" unit="Xu/người" value={f.midRatePerSlot} onChange={(v) => setFee({ midRatePerSlot: v })} />
          <Num id="pol-rate" label="Đơn giá trên mức giữa" unit="Xu/người" value={f.ratePerSlot} onChange={(v) => setFee({ ratePerSlot: v })} />
        </div>
        <p className="text-sm text-fg-muted">{feePolicyText(f)}. Thử thách CLB trừ vào quỹ CLB.</p>
        <div className="overflow-hidden rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-xs text-fg-subtle">
              <tr><th className="px-3 py-2 text-left font-medium">Số người</th><th className="px-3 py-2 text-right font-medium">Phí</th><th className="px-3 py-2 text-right font-medium">Quy đổi</th></tr>
            </thead>
            <tbody>
              {SIM_SLOTS.map((s) => {
                const fee = creationFee(s, f)
                const before = creationFee(s, policy.challengeFee)
                return (
                  <tr key={s} className="border-t border-border">
                    <td className="px-3 py-2 font-mono">{formatNumber(s)}</td>
                    <td className={cn('px-3 py-2 text-right font-mono font-semibold', fee ? 'text-coin' : 'text-brand')}>
                      {fee ? `${formatCoin(fee)} Xu` : 'Miễn phí'}
                      {fee !== before && <span className="ml-1 text-xs font-normal text-fg-subtle line-through">{formatCoin(before)}</span>}
                    </td>
                    <td className="px-3 py-2 text-right text-xs text-fg-muted">{fee ? xuToVnd(fee, p) : '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <div className="flex gap-2">
        <Button variant="secondary" className="shrink-0" disabled={!dirty} onClick={() => reset(policy)}>Hoàn tác</Button>
        <Button variant="ghost" className="shrink-0" onClick={() => reset(DEFAULT_POLICY)}>Mặc định</Button>
        <Button block disabled={!dirty || !!error} onClick={() => setConfirm(true)}>Lưu chính sách</Button>
      </div>

      <ConfirmSheet open={confirm} onClose={() => setConfirm(false)} onConfirm={save} loading={publish.isPending} danger={false}
        title="Áp dụng chính sách mới?" confirmLabel="Áp dụng ngay"
        description="Áp dụng cho bài chạy và thử thách tạo từ bây giờ. Không ảnh hưởng Xu đã phát hay thử thách đã tạo. Mỗi lần lưu là một phiên bản trong nhật ký.">
        <ul className="space-y-1 text-sm">
          <li>1 Xu ≈ {formatNumber(p.xuVnd)}đ</li>
          <li>Chạy: km đầu {formatNumber(p.firstKmXu)} Xu, mỗi km tiếp {formatNumber(p.extraKmXu)} Xu, tối đa {formatNumber(p.maxDailyReward)} Xu/ngày</li>
          <li>Thử thách: {feePolicyText(f)}</li>
        </ul>
      </ConfirmSheet>
    </div>
  )
}
