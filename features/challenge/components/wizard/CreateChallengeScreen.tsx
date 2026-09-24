'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useMemo, useRef, useState, type ReactNode } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { ArrowLeft, CalendarRange, Check, Coins, Flag, Lock, Minus, Plus, Scale, Shield, Ticket, Users, X } from 'lucide-react'
import { toast } from 'sonner'
import { useMyProfile } from '@/features/auth'
import { isStaff, useClubInbox } from '@/features/club'
import { Button, Card, Field, Input, Textarea } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { formatCoin, formatNumber } from '@/shared/lib/format'
import { creationFee, DEFAULT_POLICY, xuToVnd } from '@/shared/lib/economy'
import { routes } from '@/shared/config/routes'
import { challengeErrorMessage, createChallenge, quoteChallenge, setChallengeOptions, setChallengePledge, type ChallengeQuote } from '../../api/challengeApi'
import {
  AUDIENCE_LABEL, defaultDraft, effectiveSlots, FORMAT_META, formatScore, OBJECTIVE_META, pledgePayload, pledgeSupported, rewardSummary,
  isTeamPledge, TEAM_MODE_META, validateDraft, weeklyPreset,
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

/** Ai trả bao nhiêu: phí (sau khi dùng vé) + treo thưởng, tách ví cá nhân / quỹ CLB — khớp create_challenge_v2 */
function billFor(d: ChallengeDraft, q: ChallengeQuote) {
  const feeDue = q.pass ? 0 : q.fee
  const reward = d.rewardXu > 0 ? d.rewardXu : 0
  const fromWallet = (q.payer === 'USER' ? feeDue : 0) + (d.rewardSource === 'CREATOR' ? reward : 0)
  const fromClub = (q.payer === 'CLUB' ? feeDue : 0) + (d.rewardSource === 'CLUB' && d.audience === 'CLUB_ONLY' ? reward : 0)
  return {
    feeDue, fromWallet, fromClub,
    walletShort: Math.max(0, fromWallet - q.walletBalance),
    clubShort: q.payer === 'CLUB' ? Math.max(0, fromClub - q.payerBalance) : 0,
  }
}
type Bill = ReturnType<typeof billFor>
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
  const quote = useQuery({
    queryKey: ['challenge-quote', d.format, effectiveSlots(d), d.audience, d.clubId],
    queryFn: () => quoteChallenge(d), enabled: step >= 2, placeholderData: keepPreviousData,
  })
  const bill = quote.data ? billFor(d, quote.data) : null
  const short = step === 3 && !!bill && (bill.walletShort > 0 || bill.clubShort > 0)

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
      if (d.requireHr) await setChallengeOptions(r.challenge_id, { require_hr: true })
      if (d.pledge.enabled && pledgeSupported(d)) {
        // Bật mục tiêu tự đăng ký ngay sau khi tạo (cùng người tạo, trước khi ai tham gia)
        await setChallengePledge(r.challenge_id, pledgePayload(d.pledge, d.format === 'TEAM'))
          .catch((e) => toast.error(`Đã tạo thử thách nhưng chưa bật được mục tiêu tự đăng ký: ${challengeErrorMessage(e)}`))
      }
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
      {step === 2 && <StepTime d={d} set={set} errors={errors} balance={balance} quote={quote.data} />}
      {step === 3 && <StepReview d={d} quote={quote.data} bill={bill} loading={quote.isPending} failed={quote.isError}
        onRetry={() => void quote.refetch()} clubName={staffClubs.find((c) => c.club_id === d.clubId)?.name}
        onEdit={(to, patch) => { if (patch) set(patch); setStep(to) }} />}

      <div className="fixed inset-x-0 bottom-[calc(3.5rem+1px+env(safe-area-inset-bottom))] z-30 mx-auto flex max-w-md gap-2 border-t border-border bg-bg/95 px-4 py-3 backdrop-blur-md">
        {step > 0 && <Button variant="secondary" size="lg" className="shrink-0 whitespace-nowrap" onClick={() => setStep(step - 1)} disabled={busy}>Quay lại</Button>}
        <Button block size="lg" onClick={next} loading={busy} disabled={short || (step === 3 && !bill)}>
          {step < 3 ? 'Tiếp tục' : short ? (bill?.clubShort ? 'Quỹ CLB không đủ' : 'Không đủ Xu') : 'Tạo thử thách'}
        </Button>
      </div>
    </div>
  )
}

type StepProps = { d: ChallengeDraft; set: (p: Partial<ChallengeDraft>) => void; errors: DraftErrors }

function StepType({ d, set, errors, staffClubs }: StepProps & { staffClubs: { club_id: string; name: string; accent_color: string | null }[] }) {
  const formats = Object.keys(FORMAT_META) as ChallengeFormat[]
  const audiences: Audience[] = staffClubs.length ? ['PUBLIC', 'INVITE_ONLY', 'CLUB_ONLY'] : ['PUBLIC', 'INVITE_ONLY']
  const templateClub = d.clubId ?? staffClubs[0]?.club_id ?? null
  return (
    <div className="space-y-5">
      {templateClub && (
        <section>
          <p className="mb-2 text-sm font-medium text-fg-muted">Mẫu nhanh cho CLB</p>
          <div className="grid gap-2">
            <button type="button" onClick={() => set(weeklyPreset(new Date(), templateClub))}
              className={cn('rounded-xl border p-3 text-left', d.pledge.enabled && d.format === 'SOLO_GOAL' ? 'border-brand/60 bg-brand/10' : 'border-border bg-surface hover:border-fg-subtle')}>
              <CalendarRange className="mb-1.5 size-5 text-brand" aria-hidden />
              <span className="block text-sm font-semibold">Thử thách tuần</span>
              <span className="block text-xs text-fg-muted">Mỗi người tự chọn mốc 21 · 42 · 60 · 100 km</span>
            </button>
          </div>
        </section>
      )}
      <section>
        <p className="mb-2 text-sm font-medium text-fg-muted">Hình thức</p>
        <div role="radiogroup" aria-label="Hình thức" className="grid grid-cols-1 gap-2">
          {formats.flatMap((f) => (f === 'TEAM' ? [f, 'TEAM_PLEDGE' as const] : [f])).map((f) => {
            const teamPledge = f === 'TEAM_PLEDGE'
            const fmt: ChallengeFormat = teamPledge ? 'TEAM' : f
            const Icon = teamPledge ? Scale : FORMAT_ICON[fmt]
            // "Đồng đội" (đặt tên đội, tự chọn đội) và "Đua đội theo mục tiêu" (đăng ký km → máy tự chia đội) là 2 lựa chọn riêng
            const on = d.format === fmt && (fmt !== 'TEAM' || isTeamPledge(d) === teamPledge)
            return (
              <button key={f} role="radio" aria-checked={on}
                onClick={() => set({ format: fmt, objective: fmt === 'TEAM' || fmt === 'COLLECTIVE' ? (teamPledge || d.objective === 'STREAK_DAYS' ? 'DISTANCE' : d.objective) : d.objective,
                  audience: fmt === 'DUEL' && d.audience === 'PUBLIC' ? 'INVITE_ONLY' : d.audience,
                  pledge: { ...d.pledge, enabled: teamPledge || (fmt === 'SOLO_GOAL' && d.pledge.enabled),
                    ...(teamPledge ? { options: [], minKm: 1, maxKm: 1000, capPct: d.pledge.capPct ?? 20 } : {}) } })}
                className={cn('flex items-center gap-3 rounded-xl border p-3 text-left transition-colors',
                  on ? 'border-brand/60 bg-brand/10' : 'border-border bg-surface hover:border-fg-subtle')}>
                <span className={cn('grid size-10 shrink-0 place-items-center rounded-xl', teamPledge ? 'bg-xp/15 text-xp' : FORMAT_TONE[fmt])}><Icon className="size-5" aria-hidden /></span>
                <span className="flex-1">
                  <span className="block font-semibold">{teamPledge ? 'Đua đội theo mục tiêu' : FORMAT_META[fmt].label}</span>
                  <span className="block text-sm text-fg-muted">{teamPledge
                    ? 'Mỗi người đăng ký km theo sức mình, hệ thống chia đội sao cho tổng mục tiêu các đội bằng nhau'
                    : FORMAT_META[fmt].description}</span>
                </span>
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

      {(d.format !== 'SOLO_GOAL' || d.pledge.enabled) && (
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
                      {a === 'PUBLIC' ? 'Hiện ở mục Khám phá, ai cũng vào được' : a === 'INVITE_ONLY' ? 'Ẩn khỏi Khám phá, chỉ vào được bằng link có mã' : 'Chỉ thành viên CLB; phí tạo và thưởng trích quỹ CLB'}
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
  const pledge = d.pledge.enabled && pledgeSupported(d)
  return (
    <div className="space-y-5">
      {!isTeamPledge(d) && <section>
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
      </section>}

      {pledgeSupported(d) && (d.format === 'SOLO_GOAL' || pledge) && <PledgeSection d={d} set={set} error={errors.pledge} />}

      {!pledge && <NumberField id="c-target" label={needTarget ? 'Mục tiêu' : 'Mục tiêu (không bắt buộc)'} unit={unit} value={d.targetValue}
        step={d.objective === 'DISTANCE' ? 5 : 1} onChange={(v) => set({ targetValue: v })} error={errors.targetValue}
        hint={needTarget ? (d.format === 'COLLECTIVE' ? 'Tổng của cả cộng đồng' : 'Mục tiêu của riêng bạn') : 'Để 0 nếu chỉ xếp hạng ai nhiều hơn'} />}

      {d.format === 'TEAM' && pledge && (
        <section className="space-y-2">
          <NumberField id="c-pteamsize" label="Số người mỗi đội" min={2} max={50} value={d.pledge.teamSize}
            onChange={(v) => set({ pledge: { ...d.pledge, teamSize: v } })} error={errors.teamSize}
            hint="Số đội = số người đăng ký ÷ số người mỗi đội (làm tròn). VD: 20 người, 5 người/đội → 4 đội" />
          <p className="rounded-xl bg-surface-2 p-3 text-xs text-fg-muted">
            Trước giờ xuất phát, bạn bấm <b className="text-fg">Chia đội</b>: hệ thống tạo đủ số đội và xếp người sao cho tổng km đăng ký
            của các đội bằng nhau. Điểm đội = tổng km được tính của thành viên (mỗi người tối đa mục tiêu + % vượt).
          </p>
        </section>
      )}

      {d.format === 'TEAM' && !pledge && (
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

      <label className="flex items-start gap-3 rounded-xl border border-border bg-surface p-3">
        <input type="checkbox" checked={d.requireHr} onChange={(e) => set({ requireHr: e.target.checked })} className="mt-0.5 size-5 accent-[var(--color-brand)]" />
        <span>
          <span className="block text-sm font-semibold">Bắt buộc có nhịp tim</span>
          <span className="block text-xs text-fg-muted">
            Chỉ tính bài có dữ liệu nhịp tim (đồng hồ / dây đo tim đồng bộ qua Strava). Chống nhờ người chạy hộ, đi xe.
            Bài ghi bằng GPS trong app (không có nhịp tim) sẽ không được tính.
          </span>
        </span>
      </label>

      <details className="rounded-[var(--radius-card)] border border-border bg-surface p-4" open={!!(errors.minKm || errors.minPace)}>
        <summary className="cursor-pointer text-sm font-semibold">Luật hợp lệ (chống gian lận)</summary>
        <div className="mt-4 space-y-4">
          <NumberField id="c-minkm" label={d.objective === 'STREAK_DAYS' ? 'Tối thiểu mỗi ngày' : 'Tối thiểu mỗi bài'} unit="km" step={0.5}
            value={d.minKm} onChange={(v) => set({ minKm: v })} error={errors.minKm} />
          <div className="space-y-3">
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

/** Mục tiêu tự đăng ký: các mốc cho chọn hoặc khoảng tự do, % được tính vượt */
function PledgeSection({ d, set, error }: { d: ChallengeDraft; set: (p: Partial<ChallengeDraft>) => void; error?: string }) {
  const p = d.pledge
  const setP = (patch: Partial<ChallengeDraft['pledge']>) => set({ pledge: { ...p, ...patch } })
  const [newOpt, setNewOpt] = useState('')
  const addOpt = () => {
    const v = Number(newOpt.replace(',', '.'))
    if (v > 0 && v <= 5000 && !p.options.includes(v) && p.options.length < 8) setP({ options: [...p.options, v].sort((a, b) => a - b) })
    setNewOpt('')
  }
  return (
    <section className={cn('space-y-4 rounded-[var(--radius-card)] border p-4', p.enabled ? 'border-brand/50 bg-brand/5' : 'border-border bg-surface')}>
      <label className="flex items-start gap-3">
        {d.format !== 'TEAM' && <input type="checkbox" checked={p.enabled} onChange={(e) => setP({ enabled: e.target.checked })} className="mt-1 size-5 accent-[var(--color-brand)]" />}
        <span>
          <span className="flex items-center gap-1.5 font-semibold"><Flag className="size-4 text-brand" aria-hidden />Mỗi người tự đăng ký mục tiêu</span>
          <span className="block text-xs text-fg-muted">
            {d.format === 'TEAM' ? 'Thành viên tự nhập km cam kết trước giờ xuất phát'
              : 'Hoàn thành = đạt mốc của chính mình; bảng xếp hạng theo % mục tiêu'}
          </span>
        </span>
      </label>
      {p.enabled && (
        <>
          {/* Đua đội: mỗi người tự nhập số km theo năng lực — người tạo không đặt mốc */}
          {d.format === 'TEAM' ? (
            <p className="rounded-xl bg-surface-2 p-3 text-xs text-fg-muted">
              Mỗi thành viên tự nhập số km cam kết theo năng lực của mình (VD: 30, 60, 120 km) khi tham gia.
            </p>
          ) : (<>
          <div className="grid grid-cols-2 gap-2">
            {(['OPTIONS', 'RANGE'] as const).map((m) => {
              const on = m === 'OPTIONS' ? p.options.length > 0 : p.options.length === 0
              return (
                <button key={m} type="button" aria-pressed={on}
                  onClick={() => setP({ options: m === 'OPTIONS' ? (p.options.length ? p.options : [21, 42, 60, 100]) : [] })}
                  className={cn('rounded-xl border p-2.5 text-left text-sm', on ? 'border-brand/60 bg-brand/10 font-semibold' : 'border-border')}>
                  {m === 'OPTIONS' ? 'Chọn theo mốc' : 'Tự nhập số km'}
                </button>
              )
            })}
          </div>
          {p.options.length > 0 ? (
            <div className="space-y-2">
              <div className="flex flex-wrap gap-2">
                {p.options.map((o) => (
                  <span key={o} className="inline-flex items-center gap-1 rounded-full bg-surface-2 py-1 pl-3 pr-1 font-mono text-sm font-semibold">
                    {o} km
                    <button type="button" aria-label={`Bỏ mốc ${o} km`} disabled={p.options.length <= 1}
                      onClick={() => setP({ options: p.options.filter((x) => x !== o) })}
                      className="grid size-7 place-items-center rounded-full text-fg-subtle hover:bg-surface disabled:opacity-30"><X className="size-3.5" aria-hidden /></button>
                  </span>
                ))}
              </div>
              {p.options.length < 8 && (
                <div className="flex gap-2">
                  <Input inputMode="decimal" value={newOpt} onChange={(e) => setNewOpt(e.target.value)} placeholder="Thêm mốc, vd 150" aria-label="Thêm mốc km"
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addOpt() } }} />
                  <Button type="button" variant="secondary" className="shrink-0" onClick={addOpt}><Plus className="size-4" aria-hidden />Thêm</Button>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <NumberField id="p-min" label="Tối thiểu" unit="km" step={5} min={1} value={p.minKm} onChange={(v) => setP({ minKm: v })} />
              <NumberField id="p-max" label="Tối đa" unit="km" step={10} min={1} max={5000} value={p.maxKm} onChange={(v) => setP({ maxKm: v })} />
            </div>
          )}
          </>)}
          <div className="space-y-2">
            <label className="flex items-center justify-between gap-3 text-sm font-medium">
              Giới hạn phần chạy vượt mục tiêu
              <input type="checkbox" checked={p.capPct !== null} onChange={(e) => setP({ capPct: e.target.checked ? 20 : null })} className="size-5 accent-[var(--color-brand)]" />
            </label>
            {p.capPct !== null && (
              <NumberField id="p-cap" label="Được tính vượt tối đa" unit="%" step={5} min={0} max={500} value={p.capPct} onChange={(v) => setP({ capPct: v })}
                hint={`Đăng ký 50 km thì chỉ được tính tối đa ${Math.round(50 * (1 + p.capPct / 100) * 10) / 10} km — chống "đăng ký ít, chạy nhiều" để kéo điểm đội`} />
            )}
          </div>
          {error && <p role="alert" className="text-xs text-danger">{error}</p>}
        </>
      )}
    </section>
  )
}

function StepTime({ d, set, errors, balance, quote }: StepProps & { balance: number; quote?: ChallengeQuote }) {
  const quick = [{ label: '1 tuần', days: 7 }, { label: '2 tuần', days: 14 }, { label: '1 tháng', days: 30 }]
  const clubPays = d.rewardSource === 'CLUB' && d.audience === 'CLUB_ONLY'
  const fund = clubPays ? (quote?.payer === 'CLUB' ? quote.payerBalance : 0) : (quote?.walletBalance ?? balance)
  const policy = quote?.policy ?? DEFAULT_POLICY
  const f = policy.challengeFee
  const slotChoices = Array.from(new Set([f.freeMaxSlots, f.midMaxSlots, 20, 50, 100].filter((v) => v >= 2))).sort((a, b) => a - b)
  const slots = effectiveSlots(d)
  const fee = creationFee(slots, f)
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

      {d.format !== 'DUEL' && (d.format !== 'SOLO_GOAL' || d.pledge.enabled) && (
        <section className="space-y-2">
          <NumberField id="c-slots" label="Số người tối đa" value={d.maxSlots} step={1} min={2} max={10000} onChange={(v) => set({ maxSlots: v })}
            error={errors.maxSlots} unit="người" />
          <div className="flex flex-wrap gap-2" aria-label="Chọn nhanh số người">
            {slotChoices.map((v) => {
              const c = creationFee(v, f)
              return (
                <button key={v} type="button" onClick={() => set({ maxSlots: v })} aria-pressed={d.maxSlots === v}
                  className={cn('rounded-full border px-3 py-1.5 text-xs font-semibold', d.maxSlots === v ? 'border-brand bg-brand/10 text-fg' : 'border-border text-fg-muted')}>
                  {v} người · <span className={c ? 'text-coin' : 'text-brand'}>{c ? `${formatCoin(c)} Xu` : 'miễn phí'}</span>
                </button>
              )
            })}
          </div>
          <p className="flex items-center gap-1.5 text-sm">
            <Coins className="size-4 text-coin" aria-hidden />
            <span className="text-fg-muted">Phí tạo:</span>
            {quote?.pass && fee > 0
              ? <span className="font-semibold text-brand">dùng 1 vé miễn phí <span className="font-normal text-fg-subtle line-through">{formatCoin(fee)} Xu</span></span>
              : <span className={cn('font-semibold', fee ? 'text-coin' : 'text-brand')}>{fee ? `${formatCoin(fee)} Xu (${xuToVnd(fee, policy)})` : 'Miễn phí'}</span>}
            {d.audience === 'CLUB_ONLY' && fee > 0 && !quote?.pass && <span className="text-fg-subtle">· trừ quỹ CLB</span>}
          </p>
        </section>
      )}

      <section className="space-y-3">
        <p className="text-sm font-medium text-fg-muted">Giải thưởng (không bắt buộc)</p>
        <NumberField id="c-reward" label="Treo thưởng" unit="Xu" step={50} max={100000} value={d.rewardXu} onChange={(v) => set({ rewardXu: v })}
          error={errors.rewardXu ?? (quote && d.rewardXu > fund ? `${clubPays ? 'Quỹ CLB' : 'Ví của bạn'} chỉ có ${formatCoin(fund)} Xu` : undefined)}
          hint={`Trừ từ ${clubPays ? 'quỹ CLB' : 'ví của bạn'} ngay khi tạo, hoàn lại nếu không ai đạt hoặc thử thách bị hủy`} />
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

function StepReview({ d, quote, bill, loading, failed, onRetry, clubName, onEdit }: {
  d: ChallengeDraft; quote?: ChallengeQuote; bill: Bill | null; loading: boolean; failed: boolean; onRetry: () => void; clubName?: string
  onEdit: (step: number, patch?: Partial<ChallengeDraft>) => void
}) {
  const router = useRouter()
  const Icon = FORMAT_ICON[d.format]
  const days = Math.max(1, Math.round((Date.parse(d.end) - Date.parse(d.start)) / DAY))
  const perDay = d.targetValue > 0 ? d.targetValue / days : 0
  const summary = useMemo(() => rewardSummary({ reward_xu: d.rewardXu, reward_split: d.format === 'RANKED' ? d.rewardSplit : d.format === 'TEAM' ? 'TEAM' : d.format === 'DUEL' ? 'WINNER' : 'FINISHERS', format: d.format }), [d])
  return (
    <div className="space-y-4">
      <Card className="space-y-3">
        <div className="flex items-center gap-3">
          <span className={cn('grid size-11 place-items-center rounded-xl', FORMAT_TONE[d.format])}><Icon className="size-5" aria-hidden /></span>
          <div className="min-w-0"><p className="text-xs font-semibold text-fg-muted">{isTeamPledge(d) ? 'Đua đội theo mục tiêu' : `${FORMAT_META[d.format].label}${d.format === 'TEAM' ? ` · ${TEAM_MODE_META[d.gameMode].label}` : ''}`}</p>
            <p className="truncate text-lg font-bold">{d.title}</p></div>
        </div>
        <ul className="space-y-1.5 text-sm">
          {d.pledge.enabled && pledgeSupported(d) ? (
            <li><span className="text-fg-subtle">Mục tiêu tự đăng ký: </span>
              {d.pledge.options.length ? d.pledge.options.map((o) => `${o}`).join(' · ') + ' km' : `${d.pledge.minKm}–${d.pledge.maxKm} km`}
              {d.pledge.capPct !== null ? ` · tính vượt tối đa ${d.pledge.capPct}%` : ''}</li>
          ) : (
            <li><span className="text-fg-subtle">Tính theo: </span>{OBJECTIVE_META[d.objective].label}{d.targetValue > 0 ? ` · mục tiêu ${formatScore(d.objective, d.targetValue)}` : ''}</li>
          )}
          <li><span className="text-fg-subtle">Thời gian: </span>{fmtWhen(d.start)} → {fmtWhen(d.end)} ({days} ngày)</li>
          {perDay > 0 && <li><span className="text-fg-subtle">Trung bình cần: </span>{formatScore(d.objective, perDay)}/ngày</li>}
          <li><span className="text-fg-subtle">Phạm vi: </span>{d.audience === 'CLUB_ONLY' ? `Nội bộ ${clubName ?? 'CLB'}` : AUDIENCE_LABEL[d.format === 'DUEL' && d.audience === 'PUBLIC' ? 'INVITE_ONLY' : d.audience]}</li>
          {d.requireHr && <li><span className="text-fg-subtle">Nhịp tim: </span>Bắt buộc — bài không có nhịp tim không được tính</li>}
          {d.format === 'TEAM' && <li><span className="text-fg-subtle">Đội: </span>{isTeamPledge(d) ? `Tự chia theo số người đăng ký · ${d.pledge.teamSize} người/đội` : d.teamNames.filter((n) => n.trim()).join(' · ')}</li>}
          <li><span className="text-fg-subtle">Luật: </span>≥ {formatNumber(d.minKm)} km/{d.objective === 'STREAK_DAYS' ? 'ngày' : 'bài'} · pace {d.minPace}–{d.maxPace} ph/km{d.dailyCapKm > 0 ? ` · tối đa ${d.dailyCapKm} km/ngày` : ''}</li>
          {summary && <li><span className="text-fg-subtle">Thưởng: </span>{summary}</li>}
        </ul>
      </Card>

      {failed && !quote ? (
        <Card className="flex items-center justify-between gap-3 border-danger/30 bg-danger/5">
          <p className="text-sm text-fg-muted">Không tính được phí. Kiểm tra mạng rồi thử lại.</p>
          <Button size="sm" variant="secondary" onClick={onRetry}>Thử lại</Button>
        </Card>
      ) : loading || !quote || !bill ? (
        <Card className="h-40 animate-pulse bg-surface-2" aria-label="Đang tính phí" />
      ) : (
        <CostCard d={d} q={quote} bill={bill} clubName={clubName} />
      )}

      {quote && bill && (bill.walletShort > 0 || bill.clubShort > 0) && (
        <Card className="space-y-3 border-warning/40 bg-warning/5">
          <p className="font-semibold">
            {bill.clubShort > 0 ? `Quỹ CLB còn thiếu ${formatCoin(bill.clubShort)} Xu` : `Ví còn thiếu ${formatCoin(bill.walletShort)} Xu`}. Bạn có thể:
          </p>
          <div className="space-y-2">
            {(() => {
              const f = quote.policy.challengeFee
              const slots = effectiveSlots(d)
              const out: ReactNode[] = []
              if (bill.feeDue > 0 && d.format !== 'DUEL' && slots > f.freeMaxSlots && f.freeMaxSlots >= 2) {
                out.push(<Suggestion key="free" title={`Giảm còn ${f.freeMaxSlots} người`} text="Thử thách nhóm nhỏ được tạo miễn phí"
                  action="Sửa" onClick={() => onEdit(2, { maxSlots: f.freeMaxSlots })} />)
              }
              if (bill.feeDue > 0 && d.format !== 'DUEL' && slots > f.midMaxSlots && f.midMaxSlots > f.freeMaxSlots) {
                out.push(<Suggestion key="mid" title={`Giảm còn ${f.midMaxSlots} người`} text={`Phí chỉ còn ${formatCoin(creationFee(f.midMaxSlots, f))} Xu`}
                  action="Sửa" onClick={() => onEdit(2, { maxSlots: f.midMaxSlots })} />)
              }
              if (d.rewardXu > 0) {
                out.push(<Suggestion key="reward" title="Bỏ hoặc giảm tiền treo thưởng" text={`Đang treo ${formatCoin(d.rewardXu)} Xu`} action="Sửa" onClick={() => onEdit(2)} />)
              }
              if (bill.clubShort > 0 && d.clubId) {
                out.push(<Suggestion key="fund" title="Góp thêm vào quỹ CLB" text="Thành viên có thể góp Xu vào quỹ ở tab Quỹ"
                  action="Mở quỹ" onClick={() => router.push(routes.clubTab(d.clubId!, 'treasury'))} />)
              }
              if (d.format !== 'SOLO_GOAL' && bill.walletShort > 0) {
                out.push(<Suggestion key="solo" title="Mục tiêu cá nhân luôn miễn phí" text="Tự đặt mục tiêu cho riêng mình, không mất phí"
                  action="Đổi" onClick={() => onEdit(0, { format: 'SOLO_GOAL', audience: 'PUBLIC', targetValue: d.targetValue || 50 })} />)
              }
              return out
            })()}
            <p className="text-sm text-fg-muted">
              Hoặc chạy thêm để kiếm Xu: km đầu {formatNumber(quote.policy.firstKmXu)} Xu, mỗi km tiếp {formatNumber(quote.policy.extraKmXu)} Xu
              (tối đa {formatNumber(quote.policy.maxDailyReward)} Xu/ngày).
            </p>
          </div>
        </Card>
      )}
    </div>
  )
}

/** Bảng chi phí: phí theo số người, vé miễn phí, phần trừ ví cá nhân và quỹ CLB */
function CostCard({ d, q, bill, clubName }: { d: ChallengeDraft; q: ChallengeQuote; bill: Bill; clubName?: string }) {
  const slots = effectiveSlots(d)
  const creatorReward = d.rewardXu > 0 && d.rewardSource === 'CREATOR' ? d.rewardXu : 0
  const clubReward = d.rewardXu > 0 && d.rewardSource === 'CLUB' && d.audience === 'CLUB_ONLY' ? d.rewardXu : 0
  return (
    <Card className="space-y-2">
      <Row label={`Phí tạo (${formatNumber(slots)} người)`} value={q.fee ? `${formatCoin(q.fee)} Xu` : 'Miễn phí'} />
      {q.fee > 0 && !q.pass && <p className="-mt-1 text-right text-xs text-fg-subtle">{xuToVnd(q.fee, q.policy)}</p>}
      {q.pass && q.fee > 0 && (
        <div className="flex items-start gap-2 rounded-xl border border-brand/40 bg-brand/10 p-2.5 text-sm">
          <Ticket className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden />
          <span className="min-w-0 flex-1">
            <span className="block font-semibold">Dùng 1 vé tạo miễn phí</span>
            <span className="block text-xs text-fg-muted">
              {q.payer === 'CLUB' ? 'Vé của CLB' : 'Vé của bạn'} · còn {q.pass.remaining} vé · cho thử thách tối đa {formatNumber(q.pass.max_slots)} người
              {q.pass.expires_at ? ` · hạn ${new Date(q.pass.expires_at).toLocaleDateString('vi-VN')}` : ''}
            </span>
          </span>
          <span className="font-mono font-semibold text-brand">−{formatCoin(q.fee)}</span>
        </div>
      )}
      {creatorReward > 0 && <Row label="Treo thưởng từ ví" value={`${formatCoin(creatorReward)} Xu`} />}
      {clubReward > 0 && <Row label="Treo thưởng từ quỹ CLB" value={`${formatCoin(clubReward)} Xu`} />}
      {q.payer === 'CLUB' && (
        <div className="border-t border-border pt-2">
          <Row label={`Trừ từ quỹ ${clubName ?? 'CLB'}`} value={`${formatCoin(bill.fromClub)} Xu`} strong />
          <p className={cn('mt-1 flex items-center gap-1 text-xs', bill.clubShort ? 'text-danger' : 'text-fg-subtle')}>
            <Shield className="size-3.5" aria-hidden />Quỹ hiện có {formatCoin(q.payerBalance)} Xu{bill.clubShort ? ' — không đủ' : ''}
          </p>
        </div>
      )}
      <div className="border-t border-border pt-2">
        <Row label="Trừ từ ví của bạn" value={`${formatCoin(bill.fromWallet)} Xu`} strong />
        <p className={cn('mt-1 flex items-center gap-1 text-xs', bill.walletShort ? 'text-danger' : 'text-fg-subtle')}>
          <Coins className="size-3.5" aria-hidden />Ví hiện có {formatCoin(q.walletBalance)} Xu{bill.walletShort ? ' — không đủ' : ''}
        </p>
      </div>
    </Card>
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
