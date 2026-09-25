'use client'

import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, Gift, Minus, Plus, TrendingUp } from 'lucide-react'
import { Button, Field, Input, Sheet, Textarea } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { formatCoin, formatNumber } from '@/shared/lib/format'
import { listAvatarItems } from '../../../api/adminApi'
import { estimateQuest, type AdminQuest, type QuestCategory, type QuestMetric, type QuestPeriod } from '../../../api/commerceApi'
import { CATEGORY_LABEL, METRIC_UNIT, PERIOD_LABEL } from '../../../model/questLibrary'

const METRICS: { v: QuestMetric; label: string; periods?: QuestPeriod[]; minKm?: boolean; hour?: boolean; noTiers?: boolean }[] = [
  { v: 'TOTAL_KM', label: 'Tổng km trong kỳ' },
  { v: 'RUN_KM', label: 'Một bài dài ít nhất' },
  { v: 'RUN_COUNT', label: 'Số bài chạy', minKm: true },
  { v: 'ACTIVE_DAYS', label: 'Số ngày có chạy', minKm: true },
  { v: 'WEEKEND_RUNS', label: 'Số bài chạy cuối tuần (T7, CN)', minKm: true },
  { v: 'EARLY_RUNS', label: 'Số bài chạy sớm', minKm: true, hour: true },
  { v: 'CHALLENGE_FINISHES', label: 'Số thử thách hoàn thành' },
  { v: 'CHALLENGE_JOINS', label: 'Số thử thách tham gia' },
  { v: 'COMMUNITY_KM', label: 'Km cả cộng đồng (mục tiêu chung)', periods: ['WEEKLY', 'MONTHLY', 'EVENT'], minKm: true, noTiers: true },
  { v: 'CHECKIN', label: 'Điểm danh', periods: ['DAILY'], noTiers: true },
  { v: 'WEEK_KM', label: 'Km trong tuần (cũ)', periods: ['WEEKLY'] },
  { v: 'WEEK_RUN_DAYS', label: 'Ngày chạy trong tuần (cũ)', periods: ['WEEKLY'] },
]
const PERIODS: QuestPeriod[] = ['DAILY', 'WEEKLY', 'MONTHLY', 'EVENT', 'ONCE']
const BADGE_ICONS = ['Medal', 'Trophy', 'Flag', 'Flame', 'Sparkles', 'Globe', 'Moon', 'Sun', 'Heart', 'Flower2', 'Gift', 'PartyPopper', 'Mountain', 'Users']
const toLocal = (iso: string | null) => (iso ? new Date(new Date(iso).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '')
const fromLocal = (v: string) => (v ? new Date(v).toISOString() : null)
const num = (v: string) => Number(v.replace(',', '.')) || 0

function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value)
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t) }, [value, ms])
  return v
}

export function QuestEditor({ edit, onChange, onClose, onSave, saving, source }: {
  edit: AdminQuest | null; onChange: (q: AdminQuest) => void; onClose: () => void; onSave: () => void; saving: boolean; source?: string | null
}) {
  const set = (patch: Partial<AdminQuest>) => edit && onChange({ ...edit, ...patch })
  const m = METRICS.find((x) => x.v === edit?.metric)
  const unit = edit ? METRIC_UNIT[edit.metric] ?? '' : ''
  const tiered = !!edit?.tiers?.length
  const [extrasOpen, setExtrasOpen] = useState(() => !!(edit?.reward_item || edit?.reward_badge || edit?.reward_passes))
  const items = useQuery({ queryKey: ['admin', 'items'], queryFn: listAvatarItems, enabled: extrasOpen, staleTime: 5 * 60_000 })

  const valid = !!edit && edit.title.trim().length >= 2 && (tiered ? edit.tiers!.every((t, i) => t.target > 0 && (!i || t.target > edit.tiers![i - 1].target)) : edit.target > 0)
    && (edit.period !== 'EVENT' || (!!edit.starts_at && !!edit.ends_at))

  const setPeriod = (p: QuestPeriod) => {
    const ok = (x: (typeof METRICS)[number]) => !x.periods || x.periods.includes(p)
    set({ period: p, metric: m && ok(m) ? edit!.metric : 'TOTAL_KM' })
  }
  const setTiers = (tiers: { target: number; xu: number }[] | null) =>
    set(tiers ? { tiers, target: tiers.at(-1)?.target ?? 0, reward_xu: Math.round(tiers.reduce((s, t) => s + t.xu, 0) * 10) / 10 } : { tiers: null })

  return (
    <Sheet open={!!edit} onClose={onClose} title={edit?.id ? 'Sửa nhiệm vụ' : 'Tạo nhiệm vụ'} description={source ? `Từ gợi ý: ${source}` : undefined}
      footer={<Button block onClick={onSave} loading={saving} disabled={!valid}>Lưu</Button>}>
      {edit && (
        <div className="space-y-3">
          <Field label="Tên nhiệm vụ" htmlFor="q-title"><Input id="q-title" value={edit.title} maxLength={80} onChange={(e) => set({ title: e.target.value })} placeholder="VD: Tuần lễ chạy 30 km" /></Field>
          <Field label="Mô tả (hiện dưới tên)" htmlFor="q-desc"><Textarea id="q-desc" rows={2} value={edit.description ?? ''} onChange={(e) => set({ description: e.target.value })} /></Field>

          <div className="grid grid-cols-5 gap-1" role="radiogroup" aria-label="Kỳ">
            {PERIODS.map((p) => (
              <button key={p} type="button" role="radio" aria-checked={edit.period === p} onClick={() => setPeriod(p)}
                className={cn('rounded-lg border py-2 text-[11px] font-semibold', edit.period === p ? 'border-brand bg-brand/10' : 'border-border text-fg-muted')}>{PERIOD_LABEL[p]}</button>
            ))}
          </div>
          {edit.period === 'ONCE' && <p className="text-xs text-fg-subtle">Một lần: mỗi người nhận một lần, tính các bài chạy từ lúc tạo nhiệm vụ — hợp cho người mới / cột mốc.</p>}

          <div className="grid grid-cols-2 gap-3">
            <Field label="Chỉ số" htmlFor="q-metric">
              <select id="q-metric" value={edit.metric} onChange={(e) => {
                const v = e.target.value as QuestMetric
                set({ metric: v, ...(METRICS.find((x) => x.v === v)?.noTiers ? { tiers: null } : {}) })
              }} className="h-11 w-full rounded-xl border border-border bg-surface px-2 text-sm">
                {METRICS.filter((x) => !x.periods || x.periods.includes(edit.period)).map((x) => <option key={x.v} value={x.v}>{x.label}</option>)}
              </select>
            </Field>
            <Field label="Nhóm" htmlFor="q-cat">
              <select id="q-cat" value={edit.category ?? 'RUN'} onChange={(e) => set({ category: e.target.value as QuestCategory })}
                className="h-11 w-full rounded-xl border border-border bg-surface px-2 text-sm">
                {(Object.keys(CATEGORY_LABEL) as QuestCategory[]).map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
              </select>
            </Field>
          </div>

          {(m?.minKm || m?.hour) && (
            <div className="grid grid-cols-2 gap-3">
              {m.minKm && <Field label={edit.metric === 'COMMUNITY_KM' ? 'Mỗi người góp tối thiểu (km)' : 'Bài tính từ (km)'} htmlFor="q-min">
                <Input id="q-min" inputMode="decimal" className="font-mono" value={edit.params?.min_km ?? 1}
                  onChange={(e) => set({ params: { ...edit.params, min_km: num(e.target.value) } })} /></Field>}
              {m.hour && <Field label="Chạy trước (giờ)" htmlFor="q-hour">
                <Input id="q-hour" inputMode="numeric" className="font-mono" value={edit.params?.before_hour ?? 7}
                  onChange={(e) => set({ params: { ...edit.params, before_hour: Math.min(23, Math.max(1, num(e.target.value))) } })} /></Field>}
            </div>
          )}

          {!m?.noTiers && (
            <div className="grid grid-cols-2 gap-1.5" role="radiogroup" aria-label="Kiểu mục tiêu">
              {[false, true].map((t) => (
                <button key={String(t)} type="button" role="radio" aria-checked={tiered === t}
                  onClick={() => setTiers(t ? [{ target: edit.target || 1, xu: edit.reward_xu }] : null)}
                  className={cn('rounded-lg border py-2 text-xs font-semibold', tiered === t ? 'border-brand bg-brand/10' : 'border-border text-fg-muted')}>
                  {t ? 'Nhiều bậc' : 'Một mục tiêu'}
                </button>
              ))}
            </div>
          )}

          {tiered ? (
            <div className="space-y-2 rounded-xl border border-border p-3">
              <p className="text-xs text-fg-muted">Đạt bậc nào trả thêm Xu của bậc đó — chỉ tính tới bậc cao nhất đạt được, tăng dần.</p>
              {edit.tiers!.map((t, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="w-12 text-xs font-semibold text-fg-subtle">Bậc {i + 1}</span>
                  <Input aria-label={`Mục tiêu bậc ${i + 1}`} inputMode="decimal" className="font-mono" value={t.target || ''}
                    onChange={(e) => setTiers(edit.tiers!.map((x, j) => (j === i ? { ...x, target: num(e.target.value) } : x)))} />
                  <span className="text-xs text-fg-subtle">{unit}</span>
                  <Input aria-label={`Xu bậc ${i + 1}`} inputMode="decimal" className="w-20 font-mono" value={t.xu || ''}
                    onChange={(e) => setTiers(edit.tiers!.map((x, j) => (j === i ? { ...x, xu: num(e.target.value) } : x)))} />
                  <span className="text-xs text-fg-subtle">Xu</span>
                  <button type="button" aria-label="Xóa bậc" disabled={edit.tiers!.length <= 1}
                    onClick={() => setTiers(edit.tiers!.filter((_, j) => j !== i))} className="grid size-8 place-items-center rounded-lg text-fg-muted disabled:opacity-30"><Minus className="size-4" /></button>
                </div>
              ))}
              {edit.tiers!.length < 5 && (
                <Button size="sm" variant="secondary" onClick={() => {
                  const last = edit.tiers!.at(-1)!
                  setTiers([...edit.tiers!, { target: Math.round(last.target * 1.6) || 1, xu: last.xu }])
                }}><Plus className="size-4" aria-hidden />Thêm bậc</Button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <Field label={`Mục tiêu (${unit})`} htmlFor="q-target"><Input id="q-target" inputMode="decimal" className="font-mono" value={edit.target || ''}
                onChange={(e) => set({ target: num(e.target.value) })} /></Field>
              <Field label="Thưởng (Xu)" htmlFor="q-xu"><Input id="q-xu" inputMode="decimal" className="font-mono" value={edit.reward_xu || ''}
                onChange={(e) => set({ reward_xu: num(e.target.value) })} /></Field>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Field label="Bắt đầu" htmlFor="q-start" hint={edit.period === 'EVENT' ? 'Bắt buộc' : 'Để trống = ngay'}>
              <Input id="q-start" type="datetime-local" value={toLocal(edit.starts_at)} onChange={(e) => set({ starts_at: fromLocal(e.target.value) })} /></Field>
            <Field label="Kết thúc" htmlFor="q-end" hint={edit.period === 'EVENT' ? 'Bắt buộc' : 'Để trống = không hạn'}>
              <Input id="q-end" type="datetime-local" value={toLocal(edit.ends_at)} onChange={(e) => set({ ends_at: fromLocal(e.target.value) })} /></Field>
          </div>
          <div className="grid grid-cols-4 gap-1.5" role="radiogroup" aria-label="Dành cho">
            {[0, 1, 2, 3].map((t) => (
              <button key={t} type="button" role="radio" aria-checked={edit.min_vip_tier === t} onClick={() => set({ min_vip_tier: t })}
                className={cn('rounded-lg border py-2 text-xs font-semibold', edit.min_vip_tier === t ? 'border-brand bg-brand/10' : 'border-border text-fg-muted')}>
                {t === 0 ? 'Mọi người' : `VIP${t}+`}
              </button>
            ))}
          </div>

          <button type="button" onClick={() => setExtrasOpen((v) => !v)} aria-expanded={extrasOpen}
            className="flex w-full items-center gap-2 rounded-xl border border-dashed border-border px-3 py-2.5 text-left text-sm font-semibold">
            <Gift className="size-4 text-coin" aria-hidden />Thưởng thêm (vật phẩm, huy hiệu, lượt tạo)
            <span className="ml-auto text-xs font-normal text-fg-subtle">{[edit.reward_item && 'vật phẩm', edit.reward_badge && 'huy hiệu', edit.reward_passes && 'lượt tạo'].filter(Boolean).join(', ') || 'không'}</span>
          </button>
          {extrasOpen && (
            <div className="space-y-3 rounded-xl border border-border p-3">
              <p className="text-xs text-fg-muted">Trao một lần khi hoàn thành hết nhiệm vụ. Nên dùng cho sự kiện / cột mốc thay vì tăng Xu.</p>
              <Field label="Vật phẩm nhân vật" htmlFor="q-item">
                <select id="q-item" value={edit.reward_item ?? ''} onChange={(e) => set({ reward_item: e.target.value || null })}
                  className="h-11 w-full rounded-xl border border-border bg-surface px-2 text-sm">
                  <option value="">Không</option>
                  {(items.data ?? []).map((i) => <option key={i.code} value={i.code}>{i.name}</option>)}
                </select>
              </Field>
              <div className="grid grid-cols-[1fr_auto] gap-2">
                <Field label="Huy hiệu giới hạn (tên)" htmlFor="q-badge"><Input id="q-badge" maxLength={60} value={edit.reward_badge?.title ?? ''} placeholder="VD: Xông đất 2027"
                  onChange={(e) => set({ reward_badge: e.target.value ? { icon: edit.reward_badge?.icon ?? 'Medal', title: e.target.value } : null })} /></Field>
                <Field label="Biểu tượng" htmlFor="q-bicon">
                  <select id="q-bicon" value={edit.reward_badge?.icon ?? 'Medal'} disabled={!edit.reward_badge}
                    onChange={(e) => edit.reward_badge && set({ reward_badge: { ...edit.reward_badge, icon: e.target.value } })}
                    className="h-11 rounded-xl border border-border bg-surface px-2 text-sm">
                    {BADGE_ICONS.map((i) => <option key={i} value={i}>{i}</option>)}
                  </select>
                </Field>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <Field label="Lượt tạo" htmlFor="q-pq"><Input id="q-pq" inputMode="numeric" className="font-mono" value={edit.reward_passes?.qty ?? ''} placeholder="0"
                  onChange={(e) => { const qty = num(e.target.value); set({ reward_passes: qty > 0 ? { max_slots: 20, days: 30, ...edit.reward_passes, qty } : null }) }} /></Field>
                <Field label="Quy mô ≤" htmlFor="q-ps"><Input id="q-ps" inputMode="numeric" className="font-mono" value={edit.reward_passes?.max_slots ?? 20} disabled={!edit.reward_passes}
                  onChange={(e) => edit.reward_passes && set({ reward_passes: { ...edit.reward_passes, max_slots: num(e.target.value) } })} /></Field>
                <Field label="Hạn (ngày)" htmlFor="q-pd"><Input id="q-pd" inputMode="numeric" className="font-mono" value={edit.reward_passes?.days ?? 30} disabled={!edit.reward_passes}
                  onChange={(e) => edit.reward_passes && set({ reward_passes: { ...edit.reward_passes, days: num(e.target.value) } })} /></Field>
              </div>
            </div>
          )}

          <Estimate quest={edit} unit={unit} />

          <label className="flex items-center justify-between text-sm font-medium">Đang bật
            <input type="checkbox" checked={edit.is_active} onChange={(e) => set({ is_active: e.target.checked })} className="size-5 accent-[var(--color-brand)]" /></label>
          <p className="text-xs text-fg-subtle">Hoàn thành là tự nhận thưởng, mỗi kỳ một lần (sự kiện / một lần: một lần cả đợt). Không có XP — XP chỉ đến từ km. Bài chạy bị hủy thì thu hồi Xu.</p>
        </div>
      )}
    </Sheet>
  )
}

const PERIOD_UNIT: Record<QuestPeriod, string> = { DAILY: 'ngày', WEEKLY: 'tuần', MONTHLY: 'tháng', EVENT: 'đợt', ONCE: 'đợt' }

/** Ước tính số người đạt + Xu chi ra, dựa trên các kỳ đã qua */
function Estimate({ quest, unit }: { quest: AdminQuest; unit: string }) {
  const input = useDebounced({ period: quest.period, metric: quest.metric, target: quest.target, reward_xu: quest.reward_xu, tiers: quest.tiers ?? null,
    params: quest.params ?? {}, starts_at: quest.starts_at, ends_at: quest.ends_at }, 600)
  const ready = input.target > 0 && (!input.tiers || input.tiers.every((t) => t.target > 0))
  const q = useQuery({ queryKey: ['admin', 'quest-estimate', JSON.stringify(input)], queryFn: () => estimateQuest(input), enabled: ready, retry: false, staleTime: 60_000 })
  if (!ready) return null
  const e = q.data
  const per = PERIOD_UNIT[quest.period]
  const cap = e?.limits ? (quest.period === 'DAILY' ? e.limits.dailyXuCap : quest.period === 'WEEKLY' ? e.limits.weeklyXuCap : null) : null
  const warns: string[] = []
  if (cap !== null && quest.reward_xu > cap) warns.push(`Thưởng ${formatCoin(quest.reward_xu)} Xu vượt trần ${per} ${cap} Xu — mỗi người chỉ nhận tối đa ${cap} Xu/${per} từ mọi nhiệm vụ ${per}.`)
  if (e?.supported && e.tiers.length && e.active_runners >= 5) {
    if (e.tiers[0].rate < 0.1) warns.push('Mục tiêu khó: dưới 10% runner đạt được — cân nhắc thêm bậc thấp hơn.')
    if (e.tiers.at(-1)!.rate > 0.8) warns.push('Mục tiêu quá dễ: trên 80% runner đạt — tăng mục tiêu hoặc thêm bậc cao.')
  }
  return (
    <div className="space-y-1.5 rounded-xl bg-surface-2 p-3 text-xs">
      <p className="flex items-center gap-1.5 font-semibold"><TrendingUp className="size-4 text-brand" aria-hidden />Ước tính trước khi đăng</p>
      {q.isPending ? <p className="text-fg-muted">Đang tính…</p>
        : q.isError ? <p className="text-fg-muted">Chưa ước tính được (cần migration 004600).</p>
        : !e?.supported ? <p className="text-fg-muted">Chỉ số này chưa ước tính được.</p>
        : (
          <>
            <p className="text-fg-muted">Dựa trên {e.samples} {per} gần nhất · khoảng {formatNumber(e.active_runners)} runner hoạt động mỗi {per}:</p>
            <ul className="space-y-0.5">
              {e.tiers.map((t) => (
                <li key={t.target} className="flex justify-between gap-2">
                  <span>Đạt {formatNumber(t.target)} {unit}</span>
                  <span className="font-mono">~{formatNumber(t.completers)} người ({Math.round(t.rate * 100)}%)</span>
                </li>
              ))}
            </ul>
            <p className="font-semibold">
              ≈ {formatCoin(e.xu_per_period)} Xu / {per}{e.periods > 1 ? ` × ${e.periods} ${per} ≈ ${formatCoin(e.xu_total)} Xu` : ''}
              {e.open_ended ? <span className="font-normal text-fg-subtle"> (tính cho 30 ngày, nhiệm vụ không hạn)</span> : null}
            </p>
          </>
        )}
      {warns.map((w) => <p key={w} className="flex gap-1.5 text-warning"><AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />{w}</p>)}
    </div>
  )
}
