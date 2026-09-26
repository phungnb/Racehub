'use client'

import { useState, type ReactNode } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button, Card, ConfirmSheet, Field, Input } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { formatCoin, formatNumber } from '@/shared/lib/format'
import {
  creationFee, DEFAULT_POLICY, feePolicyText, LEVELS, runPolicyText, runReward, validatePolicy, xuToVnd, type EconomyPolicy,
} from '@/shared/lib/economy'
import { adminErrorMessage } from '../../api/adminApi'
import { usePublishPolicy } from '../../hooks/useAdmin'

const SIM_SLOTS = [5, 6, 20, 50, 100, 200, 500, 1000, 1001]
const SIM_KM = [2, 3, 5, 10, 21.1]

function Num({ id, label, value, onChange, unit, hint }: {
  id: string; label?: string; value: number; onChange: (v: number) => void; unit: string; hint?: string
}) {
  const [text, setText] = useState(String(value).replace('.', ','))
  const input = (
    <div className="relative">
      <Input id={id} inputMode="decimal" aria-label={label ? undefined : unit} className="pr-16 font-mono" value={text}
        onChange={(e) => { setText(e.target.value); const v = Number(e.target.value.replace(',', '.')); if (!Number.isNaN(v)) onChange(v) }} />
      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-fg-subtle">{unit}</span>
    </div>
  )
  return label ? <Field label={label} htmlFor={id} hint={hint}>{input}</Field> : input
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <Card className="space-y-3">
      <div>
        <h2 className="font-semibold">{title}</h2>
        {hint && <p className="text-xs text-fg-subtle">{hint}</p>}
      </div>
      {children}
    </Card>
  )
}

/** Danh sách hàng (bậc km, mức quy mô, mốc chuỗi) có thêm / xóa */
function Rows<T>({ items, onChange, make, render, addLabel }: {
  items: T[]; onChange: (v: T[]) => void; make: (last: T | undefined) => T; addLabel: string
  render: (item: T, set: (patch: Partial<T>) => void, i: number) => ReactNode
}) {
  return (
    <div className="space-y-2">
      {items.map((it, i) => (
        <div key={`${items.length}-${i}`} className="flex items-center gap-2">
          <div className="grid flex-1 grid-cols-2 gap-2">{render(it, (patch) => onChange(items.map((x, j) => (j === i ? { ...x, ...patch } : x))), i)}</div>
          <Button size="sm" variant="ghost" aria-label="Xóa dòng" onClick={() => onChange(items.filter((_, j) => j !== i))}>
            <Trash2 className="size-4" aria-hidden />
          </Button>
        </div>
      ))}
      <Button size="sm" variant="secondary" onClick={() => onChange([...items, make(items.at(-1))])}>
        <Plus className="size-4" aria-hidden />{addLabel}
      </Button>
    </div>
  )
}

/** Chính sách kinh tế v2 (Baseline v1.1): mọi con số do admin chỉnh — có mô phỏng trước khi lưu */
export function PolicyTab({ policy, raw }: { policy: EconomyPolicy; raw: Record<string, unknown> }) {
  const [p, setP] = useState<EconomyPolicy>(policy)
  const [confirm, setConfirm] = useState(false)
  const [formKey, setFormKey] = useState(0)
  const publish = usePublishPolicy()
  const set = (patch: Partial<EconomyPolicy>) => setP({ ...p, ...patch })
  const error = validatePolicy(p)
  const dirty = JSON.stringify(p) !== JSON.stringify(policy)

  const save = async () => {
    try {
      const v = await publish.mutateAsync({ current: raw, next: p })
      toast.success(`Đã áp dụng chính sách phiên bản ${v}`)
    } catch (e) {
      toast.error(adminErrorMessage(e))
    }
    setConfirm(false)
  }
  const reset = (to: EconomyPolicy) => { setP(to); setFormKey((k) => k + 1) }
  const monthly = runReward(5, p) * 30 + p.checkinXu * 30

  return (
    <div className="space-y-4" key={formKey}>
      <Section title="Giá trị Xu & XP" hint="Xu không đổi ra tiền mặt, không chuyển cho người khác — chỉ dùng trong RaceHub">
        <div className="grid grid-cols-2 gap-3">
          <Num id="pol-vnd" label="1 Xu tương đương" unit="đồng" value={p.xuVnd} onChange={(v) => set({ xuVnd: v })} />
          <Num id="pol-xp" label="XP mỗi km" unit="XP/km" value={p.xpPerKm} onChange={(v) => set({ xpPerKm: v })}
            hint="XP chỉ phát sinh từ km chạy" />
        </div>
      </Section>

      <Section title="Xu kiếm từ chạy bộ" hint="Tính trên tổng km trong ngày (giờ Việt Nam), nhiều bài chạy được cộng dồn">
        <div className="grid grid-cols-2 gap-3">
          <Num id="pol-free" label="Không tính Xu tới" unit="km" value={p.run.freeKm} onChange={(v) => set({ run: { ...p.run, freeKm: v } })} />
          <Num id="pol-cap" label="Trần mỗi ngày" unit="Xu" value={p.run.dailyCap} onChange={(v) => set({ run: { ...p.run, dailyCap: v } })} />
        </div>
        <p className="text-xs font-medium text-fg-muted">Bậc thưởng (đến km — Xu mỗi km)</p>
        <Rows items={p.run.tiers} addLabel="Thêm bậc" onChange={(tiers) => set({ run: { ...p.run, tiers } })}
          make={(last) => ({ upToKm: (last?.upToKm ?? p.run.freeKm) + 10, rate: 1 })}
          render={(t, s, i) => (<>
            <Num id={`pol-tier-km-${i}`} unit="km" value={t.upToKm} onChange={(v) => s({ upToKm: v })} />
            <Num id={`pol-tier-rate-${i}`} unit="Xu/km" value={t.rate} onChange={(v) => s({ rate: v })} />
          </>)} />
        <p className="text-sm text-fg-muted">{runPolicyText(p.run)}</p>
        <div className="grid grid-cols-5 gap-1.5 text-center">
          {SIM_KM.map((km) => (
            <div key={km} className="rounded-lg bg-bg/60 px-1 py-2">
              <p className="text-xs text-fg-subtle">{formatNumber(km)} km</p>
              <p className="font-mono text-sm font-semibold text-coin">{formatCoin(runReward(km, p))}</p>
            </div>
          ))}
        </div>
        <p className="text-xs text-fg-subtle">
          Chạy 5 km mỗi ngày + điểm danh ≈ {formatCoin(monthly)} Xu/tháng ({xuToVnd(monthly, p)}).
        </p>
      </Section>

      <Section title="Điểm danh & chuỗi tuần" hint="Điểm danh tự động khi có bài chạy hợp lệ trong ngày; chuỗi tính theo tuần đạt mục tiêu">
        <div className="grid grid-cols-2 gap-3">
          <Num id="pol-checkin" label="Thưởng điểm danh" unit="Xu" value={p.checkinXu} onChange={(v) => set({ checkinXu: v })} />
          <Num id="pol-checkin-km" label="Cần chạy tối thiểu" unit="km" value={p.checkinMinKm} onChange={(v) => set({ checkinMinKm: v })} />
        </div>
        <p className="text-xs font-medium text-fg-muted">Mốc chuỗi (số tuần liên tiếp — Xu thưởng)</p>
        <Rows items={p.streakRewards} addLabel="Thêm mốc" onChange={(streakRewards) => set({ streakRewards })}
          make={(last) => ({ weeks: (last?.weeks ?? 1) * 2, xu: (last?.xu ?? 10) * 2 })}
          render={(t, s, i) => (<>
            <Num id={`pol-streak-w-${i}`} unit="tuần" value={t.weeks} onChange={(v) => s({ weeks: v })} />
            <Num id={`pol-streak-x-${i}`} unit="Xu" value={t.xu} onChange={(v) => s({ xu: v })} />
          </>)} />
      </Section>

      <Section title="Giới thiệu bạn bè" hint="Chỉ trả khi người được mời đã xác thực email/SĐT và có bài chạy đủ km">
        <div className="grid grid-cols-2 gap-3">
          <Num id="pol-ref-in" label="Người mời nhận" unit="Xu" value={p.referral.inviterXu} onChange={(v) => set({ referral: { ...p.referral, inviterXu: v } })} />
          <Num id="pol-ref-ee" label="Người được mời nhận" unit="Xu" value={p.referral.refereeXu} onChange={(v) => set({ referral: { ...p.referral, refereeXu: v } })} />
          <Num id="pol-ref-cap" label="Tối đa mỗi tháng" unit="lượt" value={p.referral.monthlyCap} onChange={(v) => set({ referral: { ...p.referral, monthlyCap: v } })} />
          <Num id="pol-ref-km" label="Bài chạy đầu tối thiểu" unit="km" value={p.referral.minKm} onChange={(v) => set({ referral: { ...p.referral, minKm: v } })} />
        </div>
      </Section>

      <Section title="Chào mừng trở lại" hint="Cấp độ không bao giờ bị hạ khi nghỉ. Bài chạy đầu tiên sau kỳ nghỉ dài được thưởng, mỗi người tối đa một lần mỗi kỳ chờ.">
        <div className="grid grid-cols-3 gap-3">
          <Num id="pol-cb-days" label="Nghỉ tối thiểu" unit="ngày" value={p.comeback.minRestDays} onChange={(v) => set({ comeback: { ...p.comeback, minRestDays: v } })} />
          <Num id="pol-cb-xu" label="Thưởng" unit="Xu" value={p.comeback.xu} onChange={(v) => set({ comeback: { ...p.comeback, xu: v } })} />
          <Num id="pol-cb-cool" label="Kỳ chờ" unit="ngày" value={p.comeback.cooldownDays} onChange={(v) => set({ comeback: { ...p.comeback, cooldownDays: v } })} />
        </div>
      </Section>

      <Section title="Thưởng lên cấp" hint="Trả một lần khi đạt cấp">
        <div className="grid grid-cols-2 gap-3">
          {LEVELS.slice(1).map((l) => (
            <Num key={l.level} id={`pol-lv-${l.level}`} label={`Cấp ${l.level} · ${l.name}`} unit="Xu" value={p.levelUpXu[l.level] ?? 0}
              onChange={(v) => set({ levelUpXu: { ...p.levelUpXu, [l.level]: v } })} />
          ))}
        </div>
      </Section>

      <Section title="Phí tạo thử thách / giải chạy ảo theo quy mô"
        hint="Thu một lần theo số người tối đa, không phụ thuộc thời gian. Thử thách CLB trừ quỹ CLB; thách đấu CLB luôn miễn phí.">
        <p className="text-xs font-medium text-fg-muted">Mức (tối đa số người — phí)</p>
        <Rows items={p.capacityTiers} addLabel="Thêm mức" onChange={(capacityTiers) => set({ capacityTiers })}
          make={(last) => ({ max: (last?.max ?? 0) * 2 || 5, xu: (last?.xu ?? 0) * 2 })}
          render={(t, s, i) => (<>
            <Num id={`pol-cap-max-${i}`} unit="người" value={t.max} onChange={(v) => s({ max: v })} />
            <Num id={`pol-cap-xu-${i}`} unit="Xu" value={t.xu} onChange={(v) => s({ xu: v })} />
          </>)} />
        <p className="text-sm text-fg-muted">{feePolicyText(p.capacityTiers)} · lớn hơn: admin cấp riêng</p>
        <div className="overflow-hidden rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-xs text-fg-subtle">
              <tr><th className="px-3 py-2 text-left font-medium">Số người</th><th className="px-3 py-2 text-right font-medium">Phí</th><th className="px-3 py-2 text-right font-medium">Quy đổi</th></tr>
            </thead>
            <tbody>
              {SIM_SLOTS.map((s) => {
                const fee = creationFee(s, p.capacityTiers)
                const before = creationFee(s, policy.capacityTiers)
                return (
                  <tr key={s} className="border-t border-border">
                    <td className="px-3 py-2 font-mono">{formatNumber(s)}</td>
                    <td className={cn('px-3 py-2 text-right font-mono font-semibold', fee ? 'text-coin' : 'text-brand')}>
                      {fee === null ? 'Liên hệ admin' : fee ? `${formatCoin(fee)} Xu` : 'Miễn phí'}
                      {fee !== before && before !== null && <span className="ml-1 text-xs font-normal text-fg-subtle line-through">{formatCoin(before)}</span>}
                    </td>
                    <td className="px-3 py-2 text-right text-xs text-fg-muted">{fee ? xuToVnd(fee, p) : '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="Thử thách nội bộ CLB miễn phí theo gói"
        hint="Trong hạn mức: tạo không mất phí. Ngoài hạn mức (CLB ít người chạy, quá số thử thách cùng lúc, quá quy mô): tính phí quy mô như thường, trừ quỹ CLB. Thử thách công khai / cá nhân không áp dụng.">
        <p className="text-xs font-medium text-fg-muted">CLB miễn phí — chống &ldquo;CLB một người&rdquo;</p>
        <div className="grid grid-cols-2 gap-3">
          <Num id="pol-cc-min" label="Thành viên đang chạy tối thiểu" unit="người" value={p.clubChallenge.freeMinActiveMembers}
            onChange={(v) => set({ clubChallenge: { ...p.clubChallenge, freeMinActiveMembers: v } })} />
          <Num id="pol-cc-days" label="Có bài chạy hợp lệ trong" unit="ngày" value={p.clubChallenge.activeWindowDays}
            onChange={(v) => set({ clubChallenge: { ...p.clubChallenge, activeWindowDays: v } })} />
          <Num id="pol-cc-fopen" label="Thử thách cùng lúc" unit="cái" value={p.clubChallenge.freeMaxOpen}
            onChange={(v) => set({ clubChallenge: { ...p.clubChallenge, freeMaxOpen: v } })} />
          <Num id="pol-cc-fslots" label="Quy mô mỗi thử thách" unit="người" value={p.clubChallenge.freeMaxSlots}
            onChange={(v) => set({ clubChallenge: { ...p.clubChallenge, freeMaxSlots: v } })} />
        </div>
        <p className="text-xs font-medium text-fg-muted">CLB Pro</p>
        <div className="grid grid-cols-2 gap-3">
          <Num id="pol-cc-popen" label="Thử thách cùng lúc" unit="cái" value={p.clubChallenge.proMaxOpen}
            onChange={(v) => set({ clubChallenge: { ...p.clubChallenge, proMaxOpen: v } })} />
          <Num id="pol-cc-pslots" label="Quy mô mỗi thử thách" unit="người" value={p.clubChallenge.proMaxSlots}
            onChange={(v) => set({ clubChallenge: { ...p.clubChallenge, proMaxSlots: v } })} />
        </div>
      </Section>

      <Section title="Tiêu Xu khác">
        <div className="grid grid-cols-2 gap-3">
          <Num id="pol-gift" label="Trần tặng quà mỗi ngày" unit="Xu" value={p.giftDailyCapXu} onChange={(v) => set({ giftDailyCapXu: v })}
            hint="Chống lạm dụng / rửa Xu" />
          <Num id="pol-shield" label="Giá khiên chuỗi" unit="Xu" value={p.game.shieldPrice} onChange={(v) => set({ game: { ...p.game, shieldPrice: v } })} />
        </div>
      </Section>

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
          <li>1 Xu ≈ {formatNumber(p.xuVnd)}đ · {formatNumber(p.xpPerKm)} XP/km</li>
          <li>Chạy: {runPolicyText(p.run)}</li>
          <li>Điểm danh +{formatNumber(p.checkinXu)} Xu (chạy ≥ {formatNumber(p.checkinMinKm)} km)</li>
          <li>Phí quy mô: {feePolicyText(p.capacityTiers)}</li>
          <li>CLB miễn phí: {p.clubChallenge.freeMaxOpen} thử thách cùng lúc, ≤ {formatNumber(p.clubChallenge.freeMaxSlots)} người, cần {p.clubChallenge.freeMinActiveMembers} người chạy / {p.clubChallenge.activeWindowDays} ngày · Pro: {p.clubChallenge.proMaxOpen} cùng lúc, ≤ {formatNumber(p.clubChallenge.proMaxSlots)} người</li>
        </ul>
      </ConfirmSheet>
    </div>
  )
}
