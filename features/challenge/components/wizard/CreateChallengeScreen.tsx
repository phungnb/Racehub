'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useMemo, useRef, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, Check, Coins, Lock, Minus, Plus, Shield, Users, X } from 'lucide-react'
import { toast } from 'sonner'
import { useMyProfile } from '@/features/auth'
import { getClub, isStaff, useClubInbox } from '@/features/club'
import { Button, Card, Field, Input, Textarea } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { formatCoin, formatNumber } from '@/shared/lib/format'
import { challengeErrorMessage, createChallenge, previewFee } from '../../api/challengeApi'
import {
  AUDIENCE_LABEL, defaultDraft, FORMAT_META, formatScore, OBJECTIVE_META, rewardSummary, TEAM_MODE_META, validateDraft,
  type Audience, type ChallengeDraft, type ChallengeFormat, type DraftErrors, type Objective, type TeamMode,
} from '../../model/challenge'
import { FORMAT_ICON, FORMAT_TONE } from '../list/ChallengeCard'

const STEPS = ['Loại', 'Luật chơi', 'Thời gian & thưởng', 'Xem lại'] as const
const DAY = 86_400_000

const toLocalInput = (iso: string) => {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : '')
const fmtWhen = (iso: string) => new Date(iso).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' })

export function CreateChallengeScreen({ clubId }: { clubId?: string | null }) {
  const router = useRouter()
  const { profile } = useMyProfile()
  const inbox = useClubInbox()
  const staffClubs = (inbox.data ?? []).filter((c) => c.member_status === 'APPROVED' && isStaff(c.role))
  const [d, setD] = useState<ChallengeDraft>(() => defaultDraft(new Date(), clubId ?? null))
  const [step, setStep] = useState(0)
  const [errors, setErrors] = useState<DraftErrors>({})
  const [busy, setBusy] = useState(false)
  const key = useRef(`web-${crypto.randomUUID()}`)
  const set = (patch: Partial<ChallengeDraft>) => setD((prev) => ({ ...prev, ...patch }))
  const balance = Number(profile?.xu ?? 0)
  const fee = useQuery({
    queryKey: ['challenge-fee', d.format, d.maxSlots, d.start, d.end, d.audience],
    queryFn: () => previewFee(d), enabled: step === 3,
  })
  const cost = (fee.data ?? 0) + (d.rewardXu > 0 && d.rewardSource === 'CREATOR' ? d.rewardXu : 0)
  const short = step === 3 && fee.isSuccess && cost > balance

  const next = () => {
    if (step < 3) {
      const e = validateDraft(d, (step + 1) as 1 | 2 | 3)
      setErrors(e)
      if (Object.keys(e).length) { toast.error('Kiểm tra lại các ô được đánh dấu.'); return }
      setStep(step + 1)
      window.scrollTo({ top: 0 })
      return
    }
    void submit()
  }

  const submit = async () => {
    for (const s of [1, 2, 3] as const) {
      const e = validateDraft(d, s)
      if (Object.keys(e).length) { setErrors(e); setStep(s - 1); return }
    }
    setBusy(true)
    try {
      const r = await createChallenge(d, key.current)
      toast.success(d.audience === 'CLUB_ONLY' ? 'Đã tạo và báo cho cả CLB!' : 'Đã tạo thử thách!')
      router.replace(`/challenges/${r.challenge_id}${r.invite_code ? `?code=${r.invite_code}` : ''}`)
    } catch (e) {
      toast.error(challengeErrorMessage(e))
      setBusy(false)
    }
  }

  return (
    <div className="space-y-5 pb-28">
      <div className="flex items-center gap-2">
        {step === 0
          ? <Link href="/challenges" aria-label="Đóng" className="-ml-2 grid size-11 place-items-center rounded-full text-fg-muted hover:bg-surface-2"><X className="size-5" aria-hidden /></Link>
          : <button onClick={() => setStep(step - 1)} aria-label="Quay lại" className="-ml-2 grid size-11 place-items-center rounded-full text-fg-muted hover:bg-surface-2"><ArrowLeft className="size-5" aria-hidden /></button>}
        <h1 className="text-xl font-bold">Tạo thử thách</h1>
        <span className="ml-auto font-mono text-sm text-fg-muted">{step + 1}/4</span>
      </div>
      <ol className="grid grid-cols-4 gap-1.5" aria-label="Các bước">
        {STEPS.map((s, i) => (
          <li key={s} aria-current={i === step ? 'step' : undefined}>
            <span className={cn('block h-1 rounded-full', i <= step ? 'bg-brand' : 'bg-surface-2')} />
            <span className={cn('mt-1.5 block truncate text-xs', i === step ? 'font-semibold text-fg' : 'text-fg-subtle')}>{s}</span>
          </li>
        ))}
      </ol>

      {step === 0 && <StepType d={d} set={set} errors={errors} staffClubs={staffClubs} />}
      {step === 1 && <StepRules d={d} set={set} errors={errors} />}
      {step === 2 && <StepTime d={d} set={set} errors={errors} balance={balance} />}
      {step === 3 && <StepReview d={d} balance={balance} fee={fee.data} feeLoading={fee.isLoading} cost={cost}
        clubName={staffClubs.find((c) => c.club_id === d.clubId)?.name} canUseClub={staffClubs.length > 0}
        onEdit={(to, patch) => { if (patch) set(patch); setStep(to) }} />}

      <div className="fixed inset-x-0 bottom-[calc(3.5rem+1px+env(safe-area-inset-bottom))] z-30 mx-auto flex max-w-md gap-2 border-t border-border bg-bg/95 px-4 py-3 backdrop-blur-md">
        {step > 0 && <Button variant="secondary" size="lg" className="shrink-0 whitespace-nowrap" onClick={() => setStep(step - 1)} disabled={busy}>Quay lại</Button>}
        <Button block size="lg" onClick={next} loading={busy} disabled={short || (step === 3 && fee.isLoading)}>
          {step < 3 ? 'Tiếp tục' : short ? 'Không đủ Xu' : 'Tạo thử thách'}
        </Button>
      </div>
    </div>
  )
}

type StepProps = { d: ChallengeDraft; set: (p: Partial<ChallengeDraft>) => void; errors: DraftErrors }

function StepType({ d, set, errors, staffClubs }: StepProps & { staffClubs: { club_id: string; name: string; accent_color: string | null }[] }) {
  const formats = Object.keys(FORMAT_META) as ChallengeFormat[]
  const audiences: Audience[] = staffClubs.length ? ['PUBLIC', 'INVITE_ONLY', 'CLUB_ONLY'] : ['PUBLIC', 'INVITE_ONLY']
  return (
    <div className="space-y-5">
      <section>
        <p className="mb-2 text-sm font-medium text-fg-muted">Hình thức</p>
        <div role="radiogroup" aria-label="Hình thức" className="grid grid-cols-1 gap-2">
          {formats.map((f) => {
            const Icon = FORMAT_ICON[f]
            const on = d.format === f
            return (
              <button key={f} role="radio" aria-checked={on}
                onClick={() => set({ format: f, objective: f === 'TEAM' || f === 'COLLECTIVE' ? (d.objective === 'STREAK_DAYS' ? 'DISTANCE' : d.objective) : d.objective,
                  audience: f === 'DUEL' && d.audience === 'PUBLIC' ? 'INVITE_ONLY' : d.audience })}
                className={cn('flex items-center gap-3 rounded-xl border p-3 text-left transition-colors',
                  on ? 'border-brand/60 bg-brand/10' : 'border-border bg-surface hover:border-fg-subtle')}>
                <span className={cn('grid size-10 shrink-0 place-items-center rounded-xl', FORMAT_TONE[f])}><Icon className="size-5" aria-hidden /></span>
                <span className="flex-1"><span className="block font-semibold">{FORMAT_META[f].label}</span>
                  <span className="block text-sm text-fg-muted">{FORMAT_META[f].description}</span></span>
                {on && <Check className="size-5 text-brand" aria-hidden />}
              </button>
            )
          })}
        </div>
      </section>

      <Field label="Tên thử thách" htmlFor="c-title" error={errors.title} hint={`${d.title.trim().length}/120`}>
        <Input id="c-title" value={d.title} onChange={(e) => set({ title: e.target.value })} maxLength={120}
          placeholder={d.format === 'SOLO_GOAL' ? 'VD: 100 km tháng 10' : d.format === 'DUEL' ? 'VD: Solo 30 km trong tuần' : 'VD: Đại chiến Chim Ưng vs Cá Mập'} />
      </Field>
      <Field label="Mô tả (không bắt buộc)" htmlFor="c-desc">
        <Textarea id="c-desc" value={d.description} onChange={(e) => set({ description: e.target.value })} maxLength={2000}
          placeholder="Lời nhắn, quà tặng thêm, điểm tập trung…" />
      </Field>

      {d.format !== 'SOLO_GOAL' && (
        <section>
          <p className="mb-2 text-sm font-medium text-fg-muted">Ai được tham gia</p>
          <div role="radiogroup" aria-label="Phạm vi" className="grid gap-2">
            {audiences.filter((a) => !(d.format === 'DUEL' && a === 'PUBLIC')).map((a) => {
              const on = d.audience === a
              const Icon = a === 'PUBLIC' ? Users : a === 'INVITE_ONLY' ? Lock : Shield
              return (
                <button key={a} role="radio" aria-checked={on}
                  onClick={() => set({ audience: a, clubId: a === 'CLUB_ONLY' ? d.clubId ?? staffClubs[0]?.club_id ?? null : null,
                    rewardSource: a === 'CLUB_ONLY' ? 'CLUB' : 'CREATOR' })}
                  className={cn('flex items-center gap-3 rounded-xl border p-3 text-left', on ? 'border-brand/60 bg-brand/10' : 'border-border bg-surface hover:border-fg-subtle')}>
                  <Icon className={cn('size-5', on ? 'text-brand' : 'text-fg-subtle')} aria-hidden />
                  <span className="flex-1">
                    <span className="block text-sm font-semibold">{AUDIENCE_LABEL[a]}</span>
                    <span className="block text-xs text-fg-muted">
                      {a === 'PUBLIC' ? 'Hiện ở mục Khám phá, ai cũng vào được' : a === 'INVITE_ONLY' ? 'Ẩn khỏi Khám phá, chỉ vào được bằng link có mã' : 'Chỉ thành viên CLB, miễn phí tạo, thưởng trích quỹ CLB'}
                    </span>
                  </span>
                  {on && <Check className="size-5 text-brand" aria-hidden />}
                </button>
              )
            })}
          </div>
          {d.audience === 'CLUB_ONLY' && (
            <div className="mt-3 space-y-1.5">
              <p className="text-sm font-medium text-fg-muted">CLB tổ chức</p>
              <div className="flex flex-wrap gap-2">
                {staffClubs.map((c) => (
                  <button key={c.club_id} onClick={() => set({ clubId: c.club_id })} aria-pressed={d.clubId === c.club_id}
                    className={cn('flex min-h-10 items-center gap-2 rounded-full border px-3 text-sm font-medium',
                      d.clubId === c.club_id ? 'border-fg bg-surface-2' : 'border-border text-fg-muted')}>
                    <Shield className="size-4" style={{ color: c.accent_color ?? undefined }} aria-hidden />{c.name}
                  </button>
                ))}
              </div>
              {errors.clubId && <p role="alert" className="text-xs text-danger">{errors.clubId}</p>}
            </div>
          )}
        </section>
      )}
    </div>
  )
}

function NumberField({ label, value, onChange, unit, step = 1, min = 0, max, error, hint, id }: {
  label: string; value: number; onChange: (v: number) => void; unit?: string; step?: number; min?: number; max?: number
  error?: string; hint?: ReactNode; id: string
}) {
  const clamp = (v: number) => Math.min(max ?? Infinity, Math.max(min, Math.round(v / step) * step))
  return (
    <Field label={label} htmlFor={id} error={error} hint={hint}>
      <div className="flex items-center gap-2">
        <Button type="button" variant="secondary" aria-label={`Giảm ${label}`} className="w-11 shrink-0 px-0" onClick={() => onChange(clamp(value - step))}><Minus className="size-4" aria-hidden /></Button>
        <div className="relative flex-1">
          <Input id={id} inputMode="decimal" value={Number.isFinite(value) ? String(value).replace('.', ',') : ''} className="pr-14 text-center font-mono text-lg"
            onChange={(e) => { const v = Number(e.target.value.replace(',', '.')); if (!Number.isNaN(v)) onChange(v) }} />
          {unit && <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-fg-subtle">{unit}</span>}
        </div>
        <Button type="button" variant="secondary" aria-label={`Tăng ${label}`} className="w-11 shrink-0 px-0" onClick={() => onChange(clamp(value + step))}><Plus className="size-4" aria-hidden /></Button>
      </div>
    </Field>
  )
}

function StepRules({ d, set, errors }: StepProps) {
  const objectives = (Object.keys(OBJECTIVE_META) as Objective[])
    .filter((o) => !(o === 'STREAK_DAYS' && (d.format === 'TEAM' || d.format === 'COLLECTIVE')))
  const unit = OBJECTIVE_META[d.objective].unit
  const needTarget = d.format === 'SOLO_GOAL' || d.format === 'COLLECTIVE'
  return (
    <div className="space-y-5">
      <section>
        <p className="mb-2 text-sm font-medium text-fg-muted">Tính điểm theo</p>
        <div role="radiogroup" aria-label="Tính điểm theo" className="grid grid-cols-2 gap-2">
          {objectives.map((o) => (
            <button key={o} role="radio" aria-checked={d.objective === o}
              onClick={() => set({ objective: o, minKm: o === 'STREAK_DAYS' ? Math.max(d.minKm, 2) : d.minKm })}
              className={cn('rounded-xl border p-3 text-left', d.objective === o ? 'border-brand/60 bg-brand/10' : 'border-border bg-surface')}>
              <span className="block text-sm font-semibold">{OBJECTIVE_META[o].label}</span>
              <span className="block text-xs text-fg-muted">{OBJECTIVE_META[o].hint}</span>
            </button>
          ))}
        </div>
      </section>

      <NumberField id="c-target" label={needTarget ? 'Mục tiêu' : 'Mục tiêu (không bắt buộc)'} unit={unit} value={d.targetValue}
        step={d.objective === 'DISTANCE' ? 5 : 1} onChange={(v) => set({ targetValue: v })} error={errors.targetValue}
        hint={needTarget ? (d.format === 'COLLECTIVE' ? 'Tổng của cả cộng đồng' : 'Mục tiêu của riêng bạn') : 'Để 0 nếu chỉ xếp hạng ai nhiều hơn'} />

      {d.format === 'TEAM' && (
        <>
          <section>
            <p className="mb-2 text-sm font-medium text-fg-muted">Cách tính điểm đội</p>
            <div role="radiogroup" aria-label="Cách tính điểm đội" className="grid gap-2">
              {(Object.keys(TEAM_MODE_META) as TeamMode[]).map((m) => (
                <button key={m} role="radio" aria-checked={d.gameMode === m} onClick={() => set({ gameMode: m })}
                  className={cn('rounded-xl border p-3 text-left', d.gameMode === m ? 'border-xp/60 bg-xp/10' : 'border-border bg-surface')}>
                  <span className="block text-sm font-semibold">{TEAM_MODE_META[m].label}</span>
                  <span className="block text-xs text-fg-muted">{TEAM_MODE_META[m].description}</span>
                </button>
              ))}
            </div>
          </section>
          <section className="space-y-2">
            <p className="text-sm font-medium text-fg-muted">Các đội</p>
            {d.teamNames.map((n, i) => (
              <div key={i} className="flex gap-2">
                <Input value={n} maxLength={40} aria-label={`Tên đội ${i + 1}`}
                  onChange={(e) => set({ teamNames: d.teamNames.map((x, j) => (j === i ? e.target.value : x)) })} />
                {d.teamNames.length > 2 && (
                  <Button type="button" variant="ghost" aria-label={`Bỏ đội ${i + 1}`} className="w-11 shrink-0 px-0"
                    onClick={() => set({ teamNames: d.teamNames.filter((_, j) => j !== i) })}><X className="size-4" aria-hidden /></Button>
                )}
              </div>
            ))}
            {d.teamNames.length < 8 && (
              <Button type="button" variant="secondary" size="sm" onClick={() => set({ teamNames: [...d.teamNames, `Đội ${d.teamNames.length + 1}`] })}>
                <Plus className="size-4" aria-hidden />Thêm đội
              </Button>
            )}
            {errors.teamNames && <p role="alert" className="text-xs text-danger">{errors.teamNames}</p>}
          </section>
          <NumberField id="c-teamsize" label="Số người mỗi đội" value={d.teamSize} onChange={(v) => set({ teamSize: v })}
            hint={d.teamSize > 0 ? 'Đội đủ người sẽ khóa' : '0 = tự do, không giới hạn'} />
        </>
      )}

      <details className="rounded-[var(--radius-card)] border border-border bg-surface p-4" open={!!(errors.minKm || errors.minPace)}>
        <summary className="cursor-pointer text-sm font-semibold">Luật hợp lệ (chống gian lận)</summary>
        <div className="mt-4 space-y-4">
          <NumberField id="c-minkm" label={d.objective === 'STREAK_DAYS' ? 'Tối thiểu mỗi ngày' : 'Tối thiểu mỗi bài'} unit="km" step={0.5}
            value={d.minKm} onChange={(v) => set({ minKm: v })} error={errors.minKm} />
          <div className="grid grid-cols-2 gap-3">
            <NumberField id="c-pmin" label="Pace nhanh nhất" unit="ph/km" step={0.5} min={1} value={d.minPace} onChange={(v) => set({ minPace: v })} error={errors.minPace} />
            <NumberField id="c-pmax" label="Pace chậm nhất" unit="ph/km" step={0.5} min={1} value={d.maxPace} onChange={(v) => set({ maxPace: v })} />
          </div>
          <NumberField id="c-cap" label="Trần mỗi người mỗi ngày" unit="km" step={5} value={d.dailyCapKm} onChange={(v) => set({ dailyCapKm: v })}
            hint="0 = không giới hạn. Nên đặt cho thử thách đội để một người không gánh cả đội" error={errors.dailyCapKm} />
        </div>
      </details>
    </div>
  )
}

function StepTime({ d, set, errors, balance }: StepProps & { balance: number }) {
  const quick = [{ label: '1 tuần', days: 7 }, { label: '2 tuần', days: 14 }, { label: '1 tháng', days: 30 }]
  const clubTreasury = useQuery({ queryKey: ['club', d.clubId], queryFn: () => getClub(d.clubId!), enabled: d.rewardSource === 'CLUB' && !!d.clubId })
  const fund = d.rewardSource === 'CLUB' ? Number(clubTreasury.data?.treasury_balance ?? 0) : balance
  return (
    <div className="space-y-5">
      <section className="space-y-3">
        <div className="flex flex-wrap gap-2">
          {quick.map((q) => (
            <Button key={q.days} type="button" variant="secondary" size="sm"
              onClick={() => set({ end: new Date(Date.parse(d.start) + q.days * DAY).toISOString() })}>{q.label}</Button>
          ))}
        </div>
        <Field label="Bắt đầu" htmlFor="c-start" error={errors.start}>
          <Input id="c-start" type="datetime-local" value={toLocalInput(d.start)} onChange={(e) => set({ start: fromLocalInput(e.target.value) })} />
        </Field>
        <Field label="Kết thúc" htmlFor="c-end" error={errors.end}>
          <Input id="c-end" type="datetime-local" value={toLocalInput(d.end)} onChange={(e) => set({ end: fromLocalInput(e.target.value) })} />
        </Field>
      </section>

      {d.format !== 'DUEL' && d.format !== 'SOLO_GOAL' && (
        <NumberField id="c-slots" label="Số người tối đa" value={d.maxSlots} step={10} min={2} max={10000} onChange={(v) => set({ maxSlots: v })}
          error={errors.maxSlots} hint="Ảnh hưởng tới phí tạo thử thách công khai" />
      )}

      <section className="space-y-3">
        <p className="text-sm font-medium text-fg-muted">Giải thưởng (không bắt buộc)</p>
        <NumberField id="c-reward" label="Treo thưởng" unit="Xu" step={50} max={100000} value={d.rewardXu} onChange={(v) => set({ rewardXu: v })}
          error={errors.rewardXu ?? (d.rewardXu > fund ? `${d.rewardSource === 'CLUB' ? 'Quỹ CLB' : 'Ví của bạn'} chỉ có ${formatCoin(fund)} Xu` : undefined)}
          hint={`Trừ từ ${d.rewardSource === 'CLUB' ? 'quỹ CLB' : 'ví của bạn'} ngay khi tạo, hoàn lại nếu không ai đạt hoặc thử thách bị hủy`} />
        {d.format === 'RANKED' && d.rewardXu > 0 && (
          <div role="radiogroup" aria-label="Cách chia thưởng" className="grid grid-cols-2 gap-2">
            {(['WINNER', 'TOP3'] as const).map((s) => (
              <button key={s} role="radio" aria-checked={d.rewardSplit === s} onClick={() => set({ rewardSplit: s })}
                className={cn('rounded-xl border p-3 text-left text-sm', d.rewardSplit === s ? 'border-coin/60 bg-coin/10' : 'border-border bg-surface')}>
                <span className="block font-semibold">{s === 'WINNER' ? 'Người về nhất' : 'Top 3'}</span>
                <span className="block text-xs text-fg-muted">{s === 'WINNER' ? 'Nhận toàn bộ' : '50% · 30% · 20%'}</span>
              </button>
            ))}
          </div>
        )}
        <p className="text-xs text-fg-subtle">RaceHub không có cược giữa người chơi: thưởng do người tạo hoặc quỹ CLB treo.</p>
      </section>
    </div>
  )
}

function StepReview({ d, balance, fee, feeLoading, cost, clubName, canUseClub, onEdit }: {
  d: ChallengeDraft; balance: number; fee?: number; feeLoading: boolean; cost: number; clubName?: string; canUseClub: boolean
  onEdit: (step: number, patch?: Partial<ChallengeDraft>) => void
}) {
  const reward = d.rewardXu > 0 && d.rewardSource === 'CREATOR' ? d.rewardXu : 0
  const total = cost
  const Icon = FORMAT_ICON[d.format]
  const days = Math.max(1, Math.round((Date.parse(d.end) - Date.parse(d.start)) / DAY))
  const perDay = d.targetValue > 0 ? d.targetValue / days : 0
  const summary = useMemo(() => rewardSummary({ reward_xu: d.rewardXu, reward_split: d.format === 'RANKED' ? d.rewardSplit : d.format === 'TEAM' ? 'TEAM' : d.format === 'DUEL' ? 'WINNER' : 'FINISHERS', format: d.format }), [d])
  return (
    <div className="space-y-4">
      <Card className="space-y-3">
        <div className="flex items-center gap-3">
          <span className={cn('grid size-11 place-items-center rounded-xl', FORMAT_TONE[d.format])}><Icon className="size-5" aria-hidden /></span>
          <div className="min-w-0"><p className="text-xs font-semibold text-fg-muted">{FORMAT_META[d.format].label}{d.format === 'TEAM' ? ` · ${TEAM_MODE_META[d.gameMode].label}` : ''}</p>
            <p className="truncate text-lg font-bold">{d.title}</p></div>
        </div>
        <ul className="space-y-1.5 text-sm">
          <li><span className="text-fg-subtle">Tính theo: </span>{OBJECTIVE_META[d.objective].label}{d.targetValue > 0 ? ` · mục tiêu ${formatScore(d.objective, d.targetValue)}` : ''}</li>
          <li><span className="text-fg-subtle">Thời gian: </span>{fmtWhen(d.start)} → {fmtWhen(d.end)} ({days} ngày)</li>
          {perDay > 0 && <li><span className="text-fg-subtle">Trung bình cần: </span>{formatScore(d.objective, perDay)}/ngày</li>}
          <li><span className="text-fg-subtle">Phạm vi: </span>{d.audience === 'CLUB_ONLY' ? `Nội bộ ${clubName ?? 'CLB'}` : AUDIENCE_LABEL[d.format === 'DUEL' && d.audience === 'PUBLIC' ? 'INVITE_ONLY' : d.audience]}</li>
          {d.format === 'TEAM' && <li><span className="text-fg-subtle">Đội: </span>{d.teamNames.filter((n) => n.trim()).join(' · ')}</li>}
          <li><span className="text-fg-subtle">Luật: </span>≥ {formatNumber(d.minKm)} km/{d.objective === 'STREAK_DAYS' ? 'ngày' : 'bài'} · pace {d.minPace}–{d.maxPace} ph/km{d.dailyCapKm > 0 ? ` · tối đa ${d.dailyCapKm} km/ngày` : ''}</li>
          {summary && <li><span className="text-fg-subtle">Thưởng: </span>{summary}</li>}
        </ul>
      </Card>

      <Card className="space-y-2">
        <Row label="Phí tạo thử thách" value={feeLoading ? '…' : fee ? `${formatCoin(fee)} Xu` : 'Miễn phí'} />
        {reward > 0 && <Row label="Treo thưởng từ ví" value={`${formatCoin(reward)} Xu`} />}
        {d.rewardXu > 0 && d.rewardSource === 'CLUB' && <Row label="Treo thưởng từ quỹ CLB" value={`${formatCoin(d.rewardXu)} Xu`} />}
        <div className="border-t border-border pt-2">
          <Row label="Trừ từ ví của bạn" value={`${formatCoin(total)} Xu`} strong />
          <p className={cn('mt-1 flex items-center gap-1 text-xs', total > balance ? 'text-danger' : 'text-fg-subtle')}>
            <Coins className="size-3.5" aria-hidden />Ví hiện có {formatCoin(balance)} Xu{total > balance ? ' — không đủ' : ''}
          </p>
        </div>
      </Card>

      {!feeLoading && total > balance && (
        <Card className="space-y-3 border-warning/40 bg-warning/5">
          <p className="font-semibold">Ví chưa đủ {formatCoin(total - balance)} Xu. Bạn có thể:</p>
          <div className="space-y-2">
            {(fee ?? 0) > 0 && d.format !== 'DUEL' && d.maxSlots > 10 && (
              <Suggestion title="Giảm số người tối đa" text="Phí tạo tính theo quy mô: thử thách nhỏ rẻ hơn nhiều"
                action="Sửa" onClick={() => onEdit(2, { maxSlots: 10 })} />
            )}
            {reward > 0 && (
              <Suggestion title="Bỏ hoặc giảm tiền treo thưởng" text={`Đang treo ${formatCoin(reward)} Xu từ ví của bạn`} action="Sửa" onClick={() => onEdit(2)} />
            )}
            {canUseClub && d.audience !== 'CLUB_ONLY' && (
              <Suggestion title="Tạo trong CLB bạn quản lý" text="Thử thách nội bộ CLB miễn phí tạo, thưởng có thể trích quỹ CLB"
                action="Đổi" onClick={() => onEdit(0)} />
            )}
            {d.format !== 'SOLO_GOAL' && (
              <Suggestion title="Mục tiêu cá nhân luôn miễn phí" text="Tự đặt mục tiêu cho riêng mình, không mất phí"
                action="Đổi" onClick={() => onEdit(0, { format: 'SOLO_GOAL', audience: 'PUBLIC', targetValue: d.targetValue || 50 })} />
            )}
            <p className="text-sm text-fg-muted">Hoặc chạy thêm để kiếm Xu: mỗi km hợp lệ được khoảng 1 Xu.</p>
          </div>
        </Card>
      )}
    </div>
  )
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <p className="flex items-center justify-between text-sm">
      <span className="text-fg-muted">{label}</span>
      <span className={cn('font-mono tabular', strong ? 'text-lg font-bold text-coin' : 'font-semibold')}>{value}</span>
    </p>
  )
}

function Suggestion({ title, text, action, onClick }: { title: string; text: string; action: string; onClick: () => void }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-surface p-3">
      <span className="min-w-0 flex-1"><span className="block text-sm font-semibold">{title}</span><span className="block text-xs text-fg-muted">{text}</span></span>
      <Button size="sm" variant="secondary" onClick={onClick}>{action}</Button>
    </div>
  )
}
