'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { ArrowLeft, CalendarRange, Check, CheckCircle2, ChevronRight, Coins, FileClock, Flag, Info, Lock, Minus, Plus, Scale, Shield, Swords, Ticket, Trophy, User, Users, UsersRound, X } from 'lucide-react'
import { toast } from 'sonner'
import { useMyProfile, useSession } from '@/features/auth'
import { isStaff, useClubInbox } from '@/features/club'
import { Button, Card, ClockPicker, Field, Input, Textarea } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { formatCoin, formatNumber } from '@/shared/lib/format'
import { capacityTier, creationFee, DEFAULT_POLICY, runPolicyText, xuToVnd } from '@/shared/lib/economy'
import { routes } from '@/shared/config/routes'
import { challengeErrorMessage, createChallenge, hasRulesInfo, quoteChallenge, setChallengeConquest, setChallengeOptions, setChallengePledge, setChallengeRecurrence, setChallengeRules, setRegDeadline, type ChallengeQuote, type ClubChallengeQuota } from '../../api/challengeApi'
import { RulesInfoForm } from '../detail/RulesInfo'
import {
  AUDIENCE_LABEL, COMMUNITY_KINDS, CONQUEST_PRESETS, conquestPayload, defaultDraft, draftFromTemplate, effectiveSlots, FORMAT_META, formatClock, formatScore, isCommunity,
  isConquest, kmLabel, objectiveChoices, objectiveMeta, OBJECTIVE_META, parseClock, pledgePayload, pledgeSupported, rewardSummary, scoringLines,
  isTeamPledge, RECURRENCE_LABEL, recurrenceAllowed, TEAM_MODE_META, validateDraft, weeklyPreset,
  type Audience, type ChallengeDraft, type ChallengeFormat, type DraftErrors, type Objective, type Recurrence, type TeamMode,
} from '../../model/challenge'
import { FORMAT_ICON, FORMAT_TONE } from '../list/ChallengeCard'
import { TemplatePicker } from './TemplatePicker'
import { clearDraft, draftWorthSaving, loadDraft, saveDraft } from '../../model/draftStore'
import { PurchaseOnly } from '@/features/system'

const STEPS = ['Loại', 'Luật chơi', 'Thời gian & thưởng', 'Xem lại'] as const
const DAY = 86_400_000

const toLocalInput = (iso: string) => {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : '')
const noopSubscribe = () => () => {}

/** Ai trả bao nhiêu: phí (sau khi dùng vé) + treo thưởng, tách ví cá nhân / quỹ CLB — khớp create_challenge_v2 */
function billFor(d: ChallengeDraft, q: ChallengeQuote) {
  const feeDue = q.pass ? 0 : q.fee
  const reward = d.rewardXu > 0 && d.audience === 'CLUB_ONLY' && !(d.format === 'SOLO_GOAL' && d.personal) ? d.rewardXu : 0
  const fromWallet = q.payer === 'USER' ? feeDue : 0
  const fromClub = (q.payer === 'CLUB' ? feeDue : 0) + reward
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
  // Nháp trên máy (theo người dùng + CLB): tự lưu khi đang soạn, hỏi tiếp tục khi quay lại, xoá khi tạo xong
  const uid = useSession().session?.user.id ?? null
  const draftClub = clubId ?? null
  const [dirty, setDirty] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  // Chỉ đọc nháp sau khi hydrate (máy chủ không có localStorage) để HTML hai bên khớp nhau
  const hydrated = useSyncExternalStore(noopSubscribe, () => true, () => false)
  const saved = useMemo(() => (hydrated && uid && !dirty && !dismissed ? loadDraft(uid, draftClub) : null), [hydrated, uid, dirty, dismissed, draftClub])
  useEffect(() => {
    if (uid && dirty && draftWorthSaving(d, step)) saveDraft(uid, draftClub, d, step)
  }, [uid, dirty, d, step, draftClub])
  const discardDraft = () => {
    if (uid) clearDraft(uid, draftClub)
    setDismissed(true); setDirty(false); setD(defaultDraft(new Date(), draftClub)); setStep(0); setErrors({})
  }
  const set = (patch: Partial<ChallengeDraft>) => { setDirty(true); setD((prev) => ({ ...prev, ...patch })) }
  const balance = Number(profile?.xu ?? 0)
  const quote = useQuery({
    queryKey: ['challenge-quote', d.format, effectiveSlots(d), d.audience, d.clubId, d.personal],
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
      if (isConquest(d.objective)) {
        // Hạng mục chinh phục bật ngay sau khi tạo (trước khi ai tham gia)
        await setChallengeConquest(r.challenge_id, conquestPayload(d))
          .catch((e) => toast.error(`Đã tạo thử thách nhưng chưa lưu được hạng mục: ${challengeErrorMessage(e)}`))
      }
      if (d.regDeadline) {
        await setRegDeadline(r.challenge_id, d.regDeadline)
          .catch((e) => toast.error(`Đã tạo thử thách nhưng chưa đặt được hạn đăng ký: ${challengeErrorMessage(e)}`))
      }
      if (d.requireHr) await setChallengeOptions(r.challenge_id, { require_hr: true })
      if (d.pledge.enabled && pledgeSupported(d)) {
        // Bật mục tiêu tự đăng ký ngay sau khi tạo (cùng người tạo, trước khi ai tham gia)
        await setChallengePledge(r.challenge_id, pledgePayload(d.pledge, d.format === 'TEAM'))
          .catch((e) => toast.error(`Đã tạo thử thách nhưng chưa bật được mục tiêu tự đăng ký: ${challengeErrorMessage(e)}`))
      }
      if (hasRulesInfo(d.rules)) {
        await setChallengeRules(r.challenge_id, d.rules)
          .catch((e) => toast.error(`Đã tạo thử thách nhưng chưa lưu được thể lệ (sửa lại ở tab Luật chơi): ${challengeErrorMessage(e)}`))
      }
      if (d.recurrence !== 'NONE' && recurrenceAllowed(d, d.recurrence)) {
        await setChallengeRecurrence(r.challenge_id, d.recurrence)
          .catch((e) => toast.error(`Đã tạo thử thách nhưng chưa bật được tự lặp lại: ${challengeErrorMessage(e)}`))
      }
      if (uid) clearDraft(uid, draftClub)
      toast.success(d.audience === 'CLUB_ONLY' && !(d.format === 'SOLO_GOAL' && d.personal) ? 'Đã tạo và báo cho cả CLB!' : 'Đã tạo thử thách!')
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
        {dirty && draftWorthSaving(d, step) && (
          <button type="button" onClick={discardDraft} className="ml-auto min-h-11 rounded-lg px-2 text-xs font-medium text-fg-muted hover:text-danger">
            Đã lưu nháp · Bỏ nháp
          </button>
        )}
        <span className={cn('font-mono text-sm text-fg-muted', !(dirty && draftWorthSaving(d, step)) && 'ml-auto')}>{step + 1}/4</span>
      </div>
      {saved && (
        <Card className="flex items-start gap-3 border-brand/40 bg-brand/5">
          <FileClock className="mt-0.5 size-5 shrink-0 text-brand" aria-hidden />
          <div className="min-w-0 flex-1 space-y-2">
            <div>
              <p className="font-semibold">Bạn có thử thách đang tạo dở</p>
              <p className="truncate text-xs text-fg-muted">
                {saved.draft.title.trim() || 'Chưa đặt tên'} · bước {saved.step + 1}/4 · lưu lúc {fmtWhen(new Date(saved.savedAt).toISOString())}
              </p>
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => { setD(saved.draft); setStep(saved.step); setErrors({}); setDirty(true) }}>Làm tiếp</Button>
              <Button size="sm" variant="ghost" onClick={discardDraft}>Bỏ nháp</Button>
            </div>
          </div>
        </Card>
      )}
      <ol className="grid grid-cols-4 gap-1.5" aria-label="Các bước">
        {STEPS.map((s, i) => (
          <li key={s} aria-current={i === step ? 'step' : undefined}>
            <span className={cn('block h-1 rounded-full', i <= step ? 'bg-brand' : 'bg-surface-2')} />
            <span className={cn('mt-1.5 block truncate text-xs', i === step ? 'font-semibold text-fg' : 'text-fg-subtle')}>{s}</span>
          </li>
        ))}
      </ol>

      {step === 0 && (
        <TemplatePicker onPick={(t) => {
          setD(draftFromTemplate(t, staffClubs.map((c) => c.club_id)))
          setDirty(true)
          setErrors({})
          toast.success(`Đã chép luật từ "${t.title}" — kiểm tra lại rồi tạo`)
        }} />
      )}
      {step === 0 && <StepType d={d} set={set} errors={errors} staffClubs={staffClubs} />}
      {step === 1 && <StepRules d={d} set={set} errors={errors} />}
      {step === 2 && <StepTime d={d} set={set} errors={errors} balance={balance} quote={quote.data} />}
      {step === 3 && <StepReview d={d} quote={quote.data} bill={bill} loading={quote.isPending} failed={quote.isError} quoteError={quote.error}
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

/** Các hình thức: Chinh phục cá nhân · Cộng đồng · Đồng đội (2 kiểu) · Thách đấu 1-1 · Thách đấu CLB */
const FORMAT_CHOICES: { format: ChallengeFormat; label: string; description: string }[] = [
  { format: 'SOLO_GOAL', label: FORMAT_META.SOLO_GOAL.label, description: FORMAT_META.SOLO_GOAL.description },
  { format: 'COLLECTIVE', label: 'Cộng đồng', description: COMMUNITY_KINDS.map((k) => k.label).join(' · ') + ' — BXH theo km, số ngày chạy, pace' },
  { format: 'TEAM', label: 'Đồng đội', description: 'Chia đội thi đấu, mỗi thử thách có cách tính điểm đội riêng' },
  { format: 'DUEL', label: FORMAT_META.DUEL.label, description: FORMAT_META.DUEL.description },
]
/** Tính điểm theo — mỗi hình thức có lựa chọn riêng */
export const objectivesFor = (d: Pick<ChallengeDraft, 'format'>): Objective[] =>
  d.format === 'SOLO_GOAL' ? ['DISTANCE', 'BEST_TIME', 'BEST_PACE', 'STREAK_DAYS']
    : isCommunity(d.format) ? ['DISTANCE']
    : d.format === 'TEAM' ? ['DISTANCE', 'RUNS', 'DURATION']
    : ['DISTANCE', 'RUNS', 'DURATION', 'STREAK_DAYS']

function StepType({ d, set, errors, staffClubs }: StepProps & { staffClubs: { club_id: string; name: string; accent_color: string | null }[] }) {
  const audiences: Audience[] = staffClubs.length ? ['PUBLIC', 'INVITE_ONLY', 'CLUB_ONLY'] : ['PUBLIC', 'INVITE_ONLY']
  const templateClub = d.clubId ?? staffClubs[0]?.club_id ?? null
  const solo = d.format === 'SOLO_GOAL'
  const pick = (fmt: ChallengeFormat, teamPledge = false) => {
    const allowed = objectivesFor({ format: fmt })
    set({ format: fmt, objective: teamPledge || !allowed.includes(d.objective) ? 'DISTANCE' : d.objective,
      audience: fmt === 'DUEL' && d.audience === 'PUBLIC' ? 'INVITE_ONLY' : d.audience,
      personal: fmt === 'SOLO_GOAL' ? d.personal : false,
      pledge: { ...d.pledge, enabled: teamPledge || (fmt === 'SOLO_GOAL' && d.pledge.enabled),
        ...(teamPledge ? { options: [], minKm: 1, maxKm: 1000, capPct: d.pledge.capPct ?? 20 } : {}) } })
  }
  return (
    <div className="space-y-5">
      {templateClub && (
        <section>
          <p className="mb-2 text-sm font-medium text-fg-muted">Mẫu nhanh cho CLB</p>
          <div className="grid gap-2">
            <button type="button" onClick={() => set({ ...weeklyPreset(new Date(), templateClub), personal: false })}
              className={cn('rounded-xl border p-3 text-left', d.pledge.enabled && d.format === 'SOLO_GOAL' ? 'border-brand/60 bg-brand/10' : 'border-border bg-surface hover:border-fg-subtle')}>
              <CalendarRange className="mb-1.5 size-5 text-brand" aria-hidden />
              <span className="block text-sm font-semibold">Thử thách tuần</span>
              <span className="block text-xs text-fg-muted">Mỗi người tự chọn mục tiêu 21 · 42 · 60 · 100 km</span>
            </button>
          </div>
        </section>
      )}
      <section>
        <p className="mb-2 text-sm font-medium text-fg-muted">Hình thức</p>
        <div role="radiogroup" aria-label="Hình thức" className="grid grid-cols-1 gap-2">
          {FORMAT_CHOICES.map((f) => {
            const on = f.format === 'COLLECTIVE' ? isCommunity(d.format) : d.format === f.format
            const Icon = f.format === 'TEAM' ? UsersRound : FORMAT_ICON[f.format]
            return (
              <div key={f.format} className={cn('rounded-xl border transition-colors', on ? 'border-brand/60 bg-brand/10' : 'border-border bg-surface hover:border-fg-subtle')}>
                <button role="radio" aria-checked={on} onClick={() => (f.format === 'COLLECTIVE' && on ? undefined : pick(f.format, f.format === 'TEAM' && on ? isTeamPledge(d) : false))}
                  className="flex w-full items-center gap-3 p-3 text-left">
                  <span className={cn('grid size-10 shrink-0 place-items-center rounded-xl', FORMAT_TONE[f.format])}><Icon className="size-5" aria-hidden /></span>
                  <span className="flex-1">
                    <span className="block font-semibold">{f.label}</span>
                    <span className="block text-sm text-fg-muted">{f.description}</span>
                  </span>
                  {on && <Check className="size-5 text-brand" aria-hidden />}
                </button>
                {/* Cộng đồng: các kiểu con (Cùng nhau chinh phục, Đua xếp hạng, …) */}
                {on && f.format === 'COLLECTIVE' && (
                  <div role="radiogroup" aria-label="Kiểu cộng đồng" className="grid gap-2 px-3 pb-3">
                    {COMMUNITY_KINDS.map((k) => {
                      const sub = d.format === k.format
                      return (
                        <button key={k.id} role="radio" aria-checked={sub} onClick={() => set({ format: k.format, objective: 'DISTANCE', targetValue: k.format === 'RANKED' ? 0 : d.targetValue, pledge: { ...d.pledge, enabled: false } })}
                          className={cn('flex items-start gap-2.5 rounded-lg border p-2.5 text-left', sub ? 'border-success/60 bg-success/10' : 'border-border bg-bg/40')}>
                          {k.format === 'RANKED' ? <Trophy className="mt-0.5 size-4 shrink-0 text-success" aria-hidden /> : <Users className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />}
                          <span><span className="block text-sm font-semibold">{k.label}</span><span className="block text-xs text-fg-muted">{k.description}</span></span>
                        </button>
                      )
                    })}
                  </div>
                )}
                {/* Đồng đội: 2 kiểu — tự chọn đội / đua đội theo mục tiêu (máy chia đội cân bằng) */}
                {on && f.format === 'TEAM' && (
                  <div role="radiogroup" aria-label="Kiểu đồng đội" className="grid gap-2 px-3 pb-3">
                    {([false, true] as const).map((tp) => {
                      const sub = isTeamPledge(d) === tp
                      return (
                        <button key={String(tp)} role="radio" aria-checked={sub} onClick={() => pick('TEAM', tp)}
                          className={cn('flex items-start gap-2.5 rounded-lg border p-2.5 text-left', sub ? 'border-xp/60 bg-xp/10' : 'border-border bg-bg/40')}>
                          {tp ? <Scale className="mt-0.5 size-4 shrink-0 text-xp" aria-hidden /> : <Users className="mt-0.5 size-4 shrink-0 text-xp" aria-hidden />}
                          <span><span className="block text-sm font-semibold">{tp ? 'Đua đội theo mục tiêu' : 'Chia đội, tự chọn đội'}</span>
                            <span className="block text-xs text-fg-muted">{tp ? 'Mỗi người đăng ký km theo sức mình, hệ thống chia đội sao cho tổng mục tiêu các đội bằng nhau'
                              : 'Đặt tên đội, mỗi người tự chọn đội; chọn cách tính điểm đội (tổng, trung bình, gap, chốt đoàn)'}</span></span>
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
          {/* Nhiều CLB tranh tài: màn riêng (BQT CLB đăng ký cho cả CLB, người thường tạo thì chờ admin duyệt) */}
          <Link href="/cups/new" className="flex items-center gap-3 rounded-xl border border-border bg-surface p-3 text-left transition-colors hover:border-fg-subtle">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-live/15 text-live"><Swords className="size-5" aria-hidden /></span>
            <span className="flex-1">
              <span className="block font-semibold">Thách đấu CLB</span>
              <span className="block text-sm text-fg-muted">Nhiều CLB cùng tranh tài theo tổng km hoặc km trung bình. Chỉ ban quản trị CLB đăng ký cho CLB mình</span>
            </span>
            <ChevronRight className="size-5 text-fg-subtle" aria-hidden />
          </Link>
        </div>
      </section>

      <Field label="Tên thử thách" htmlFor="c-title" error={errors.title} hint={`${d.title.trim().length}/120`}>
        <Input id="c-title" value={d.title} onChange={(e) => set({ title: e.target.value })} maxLength={120}
          placeholder={solo ? 'VD: Sub 55 phút 10K' : d.format === 'DUEL' ? 'VD: Solo 30 km trong tuần' : d.format === 'COLLECTIVE' ? 'VD: Cùng nhau 1.000 km tháng 10' : 'VD: Đại chiến Chim Ưng vs Cá Mập'} />
      </Field>
      <Field label="Mô tả (không bắt buộc)" htmlFor="c-desc">
        <Textarea id="c-desc" value={d.description} onChange={(e) => set({ description: e.target.value })} maxLength={2000}
          placeholder="Lời nhắn, quà tặng thêm, điểm tập trung…" />
      </Field>

      <section>
        <p className="mb-2 text-sm font-medium text-fg-muted">Ai được tham gia</p>
        <div role="radiogroup" aria-label="Phạm vi" className="grid gap-2">
          {solo && (
            <AudienceOption on={d.personal} icon={User} label="Cá nhân tôi" text="Mục tiêu của riêng bạn, không ai khác tham gia, không hiện ở Khám phá · luôn miễn phí"
              onClick={() => set({ personal: true, pledge: { ...d.pledge, enabled: false }, rewardXu: 0, rewardSource: 'NONE' })} />
          )}
          {audiences.filter((a) => !(d.format === 'DUEL' && a === 'PUBLIC')).map((a) => (
            <AudienceOption key={a} on={(!solo || !d.personal) && d.audience === a} icon={a === 'PUBLIC' ? Users : a === 'INVITE_ONLY' ? Lock : Shield}
              label={AUDIENCE_LABEL[a]}
              text={a === 'PUBLIC' ? 'Hiện ở mục Khám phá, ai cũng vào được' : a === 'INVITE_ONLY' ? 'Ẩn khỏi Khám phá, chỉ vào được bằng link có mã' : 'Chỉ thành viên CLB; ban quản trị tạo, phí và thưởng trích quỹ CLB'}
              onClick={() => set({ audience: a, personal: false, clubId: a === 'CLUB_ONLY' ? d.clubId ?? staffClubs[0]?.club_id ?? null : null,
                pledge: solo && d.personal && d.objective === 'DISTANCE' ? { ...d.pledge, enabled: true } : d.pledge,
                rewardSource: a === 'CLUB_ONLY' ? 'CLUB' : 'NONE', rewardXu: a === 'CLUB_ONLY' ? d.rewardXu : 0 })} />
          ))}
        </div>
        {d.audience === 'CLUB_ONLY' && !(solo && d.personal) && (
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
    </div>
  )
}

function AudienceOption({ on, icon: Icon, label, text, onClick }: { on: boolean; icon: typeof Users; label: string; text: string; onClick: () => void }) {
  return (
    <button role="radio" aria-checked={on} onClick={onClick}
      className={cn('flex items-center gap-3 rounded-xl border p-3 text-left', on ? 'border-brand/60 bg-brand/10' : 'border-border bg-surface hover:border-fg-subtle')}>
      <Icon className={cn('size-5', on ? 'text-brand' : 'text-fg-subtle')} aria-hidden />
      <span className="flex-1"><span className="block text-sm font-semibold">{label}</span><span className="block text-xs text-fg-muted">{text}</span></span>
      {on && <Check className="size-5 text-brand" aria-hidden />}
    </button>
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
  const objectives = objectivesFor(d)
  const unit = objectiveMeta(d.objective, d.conquest.mode).unit
  const conquest = isConquest(d.objective)
  const community = isCommunity(d.format)
  const needTarget = d.format === 'SOLO_GOAL'
  const pledge = d.pledge.enabled && pledgeSupported(d)
  return (
    <div className="space-y-5">
      {!isTeamPledge(d) && objectives.length > 1 && <section>
        <p className="mb-2 text-sm font-medium text-fg-muted">Tính điểm theo</p>
        <div role="radiogroup" aria-label="Tính điểm theo" className="grid grid-cols-2 gap-2">
          {objectiveChoices(objectives, { objective: d.objective, mode: d.conquest.mode }).map((x) => (
            <button key={x.id} role="radio" aria-checked={x.active}
              onClick={() => set({ objective: x.objective, minKm: x.objective === 'STREAK_DAYS' ? Math.max(d.minKm, 2) : d.minKm,
                ...(x.mode ? { conquest: { ...d.conquest, mode: x.mode } } : {}),
                pledge: isConquest(x.objective) ? { ...d.pledge, enabled: false } : d.pledge })}
              className={cn('rounded-xl border p-3 text-left', x.active ? 'border-brand/60 bg-brand/10' : 'border-border bg-surface')}>
              <span className="block text-sm font-semibold">{x.meta.label}</span>
              <span className="block text-xs text-fg-muted">{x.meta.hint}</span>
            </button>
          ))}
        </div>
      </section>}

      {conquest && <ConquestSection d={d} set={set} error={errors.conquest} />}

      {!conquest && pledgeSupported(d) && (d.format === 'SOLO_GOAL' || pledge) && <PledgeSection d={d} set={set} error={errors.pledge} />}

      {!pledge && !conquest && d.format !== 'RANKED' && <NumberField id="c-target" label={needTarget ? 'Mục tiêu' : community ? 'Mục tiêu chung của cộng đồng' : 'Mục tiêu (không bắt buộc)'} unit={unit} value={d.targetValue}
        step={d.objective === 'DISTANCE' ? 5 : 1} onChange={(v) => set({ targetValue: v })} error={errors.targetValue}
        hint={needTarget ? (d.personal ? 'Mục tiêu của riêng bạn' : 'Mục tiêu chung cho mọi người tham gia') : community ? 'Tổng km cả cộng đồng cùng chạm tới' : 'Để 0 nếu chỉ xếp hạng ai nhiều hơn'} />}

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

      <ScoringCard d={d} />

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
          {!conquest && <NumberField id="c-minkm" label={d.objective === 'STREAK_DAYS' ? 'Tối thiểu mỗi ngày' : 'Tối thiểu mỗi bài'} unit="km" step={0.5}
            value={d.minKm} onChange={(v) => set({ minKm: v })} error={errors.minKm} />}
          <div className="space-y-3">
            <NumberField id="c-pmin" label="Pace nhanh nhất" unit="ph/km" step={0.5} min={1} value={d.minPace} onChange={(v) => set({ minPace: v })} error={errors.minPace} />
            <NumberField id="c-pmax" label="Pace chậm nhất" unit="ph/km" step={0.5} min={1} value={d.maxPace} onChange={(v) => set({ maxPace: v })} />
          </div>
          <NumberField id="c-cap" label="Trần mỗi người mỗi ngày" unit="km" step={5} value={d.dailyCapKm} onChange={(v) => set({ dailyCapKm: v })}
            hint="0 = không giới hạn. Nên đặt cho thử thách đội để một người không gánh cả đội" error={errors.dailyCapKm} />
        </div>
      </details>
      <details className="rounded-xl border border-border bg-surface p-4" open={hasRulesInfo(d.rules)}>
        <summary className="cursor-pointer text-sm font-semibold">Thể lệ thưởng, phạt & thông tin khác (không bắt buộc)</summary>
        <p className="mt-2 text-xs text-fg-muted">Hiện ở tab Luật chơi. Sửa được sau khi tạo; nếu thử thách đã bắt đầu, người tham gia được báo khi bạn sửa.</p>
        <div className="mt-4"><RulesInfoForm value={d.rules} onChange={(rules) => set({ rules })} /></div>
      </details>
    </div>
  )
}

/** Cách tính điểm của loại thử thách đang chọn — nói rõ trước khi tạo */
function ScoringCard({ d }: { d: ChallengeDraft }) {
  const lines = scoringLines({
    format: d.format === 'COLLECTIVE' && !(d.targetValue > 0) ? 'RANKED' : d.format, objective: d.objective,
    game_mode: isTeamPledge(d) ? 'TEAM_SUM' : d.gameMode, pledge_enabled: d.pledge.enabled && pledgeSupported(d),
    target_value: d.targetValue, conquest_mode: d.conquest.mode, pledge_cap_pct: d.pledge.capPct, min_km: d.minKm,
  })
  return (
    <section className="rounded-xl border border-border bg-surface-2/50 p-3">
      <p className="mb-1 flex items-center gap-1.5 text-sm font-semibold"><Info className="size-4 text-brand" aria-hidden />Cách tính điểm</p>
      <ul className="list-disc space-y-0.5 pl-5 text-xs text-fg-muted">{lines.map((l) => <li key={l}>{l}</li>)}</ul>
    </section>
  )
}

/**
 * Chinh phục thời gian / pace: nhiều hạng mục (5K, 10K, Half, Full, tự đặt).
 * Lựa chọn 1: người tạo đặt mục tiêu từng hạng mục, người chơi đăng ký hạng mục.
 * Lựa chọn 2: người chơi tự đăng ký mục tiêu của mình.
 */
export function ConquestSection({ d, set, error }: { d: ChallengeDraft; set: (p: Partial<ChallengeDraft>) => void; error?: string }) {
  const c = d.conquest
  const pace = d.objective === 'BEST_PACE'
  const setC = (patch: Partial<ChallengeDraft['conquest']>) => set({ conquest: { ...c, ...patch } })
  const setCat = (i: number, patch: Partial<ChallengeDraft['conquest']['categories'][number]>) =>
    setC({ categories: c.categories.map((x, j) => (j === i ? { ...x, ...patch } : x)) })
  const add = (label: string, km: number, target: string) => {
    if (c.categories.length >= 8) return
    const name = c.categories.some((x) => x.label === label) ? `${label} (${c.categories.length + 1})` : label
    setC({ categories: [...c.categories, { label: name, km, target }] })
  }
  return (
    <section className="space-y-4 rounded-[var(--radius-card)] border border-brand/50 bg-brand/5 p-4">
      <div>
        <p className="flex items-center gap-1.5 font-semibold"><Flag className="size-4 text-brand" aria-hidden />{c.mode === 'ANY' ? 'Chinh phục cự ly' : pace ? 'Chinh phục pace' : 'Chinh phục thời gian'} — các hạng mục</p>
        <p className="text-xs text-fg-muted">Tạo một lần nhiều hạng mục. Người chơi chọn hạng mục muốn chinh phục (một hay nhiều).</p>
      </div>
      {c.mode !== 'ANY' && <div role="radiogroup" aria-label="Ai đặt mục tiêu" className="grid grid-cols-2 gap-2">
        {(['FIXED', 'SELF'] as const).map((m) => (
          <button key={m} type="button" role="radio" aria-checked={c.mode === m} onClick={() => setC({ mode: m })}
            className={cn('rounded-xl border p-2.5 text-left', c.mode === m ? 'border-brand/60 bg-brand/10' : 'border-border bg-surface')}>
            <span className="block text-sm font-semibold">{m === 'FIXED' ? 'Người tạo đặt mục tiêu' : 'Người chơi tự đăng ký'}</span>
            <span className="block text-xs text-fg-muted">{m === 'FIXED' ? `Bạn đặt ${pace ? 'pace' : 'thời gian'} cho từng hạng mục; người tham gia đăng ký hạng mục`
              : `Mỗi người tự nhập ${pace ? 'pace' : 'thời gian'} mục tiêu của mình`}</span>
          </button>
        ))}
      </div>}
      <ul className="space-y-2">
        {c.categories.map((x, i) => (
          <li key={i} className="space-y-2 rounded-xl border border-border bg-surface p-2.5">
            <div className="flex items-center gap-2">
              <Input aria-label={`Tên hạng mục ${i + 1}`} value={x.label} maxLength={40} className="font-semibold" onChange={(e) => setCat(i, { label: e.target.value })} />
              <div className="relative w-28 shrink-0">
                <Input aria-label={`Cự ly hạng mục ${i + 1}`} inputMode="decimal" className="pr-9 font-mono" value={String(x.km).replace('.', ',')}
                  onChange={(e) => { const v = Number(e.target.value.replace(',', '.')); if (!Number.isNaN(v)) setCat(i, { km: v }) }} />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-fg-subtle">km</span>
              </div>
              {c.categories.length > 1 && (
                <button type="button" aria-label={`Bỏ hạng mục ${x.label}`} onClick={() => setC({ categories: c.categories.filter((_, j) => j !== i) })}
                  className="grid size-11 shrink-0 place-items-center rounded-xl text-fg-subtle hover:bg-surface-2"><X className="size-4" aria-hidden /></button>
              )}
            </div>
            {c.mode === 'FIXED' && (
              <div className="space-y-1 text-sm">
                <span className="text-fg-muted">{pace ? 'Pace ≤' : 'Thời gian ≤'}</span>
                <ClockPicker label={`Mục tiêu hạng mục ${x.label}`} mode={pace ? 'pace' : 'time'}
                  maxHours={Math.max(3, Math.ceil((x.km * 12) / 60))}
                  value={parseClock(x.target) ?? (pace ? 360 : Math.max(60, Math.round(x.km * 6) * 60))}
                  onChange={(sec) => setCat(i, { target: formatClock(sec) })} />
                {!pace && parseClock(x.target) && x.km > 0 ? <span className="block text-xs text-fg-subtle">≈ {formatClock((parseClock(x.target) ?? 0) / x.km)}/km</span> : null}
              </div>
            )}
          </li>
        ))}
      </ul>
      {c.categories.length < 8 && (
        <div className="flex flex-wrap gap-2">
          {CONQUEST_PRESETS.map((p) => (
            <Button key={p.label} type="button" size="sm" variant="secondary" onClick={() => add(p.label, p.km, pace ? p.pace : p.time)}>
              <Plus className="size-4" aria-hidden />{p.label}
            </Button>
          ))}
          <Button type="button" size="sm" variant="secondary" onClick={() => add('Tự đặt', 15, pace ? '6:00' : '1:30:00')}><Plus className="size-4" aria-hidden />Tự đặt</Button>
        </div>
      )}
      <p className="text-xs text-fg-muted">
        {c.mode === 'ANY' ? 'Một bài chạy có cự ly ≥ hạng mục (sai số tối đa 1%) là đạt hạng mục đó, không giới hạn thời gian.' : <>Kết quả = bài chạy tốt nhất có cự ly ≥ hạng mục ({pace ? 'pace trung bình của bài' : 'thời gian quy đổi theo pace trung bình'}). VD bài {kmLabel(10.2)} trong 54:24 tính cho 10K là 53:20.</>}
      </p>
      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
    </section>
  )
}

/** Mục tiêu tự đăng ký: các mốc cho chọn hoặc khoảng tự do, % được tính vượt */
export function PledgeSection({ d, set, error }: { d: ChallengeDraft; set: (p: Partial<ChallengeDraft>) => void; error?: string }) {
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
              : 'Hoàn thành = đạt mục tiêu của chính mình; bảng xếp hạng theo % mục tiêu'}
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
                  {m === 'OPTIONS' ? 'Chọn mục tiêu có sẵn' : 'Tự nhập số km'}
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
                    <button type="button" aria-label={`Bỏ mục tiêu ${o} km`} disabled={p.options.length <= 1}
                      onClick={() => setP({ options: p.options.filter((x) => x !== o) })}
                      className="grid size-7 place-items-center rounded-full text-fg-subtle hover:bg-surface disabled:opacity-30"><X className="size-3.5" aria-hidden /></button>
                  </span>
                ))}
              </div>
              {p.options.length < 8 && (
                <div className="flex gap-2">
                  <Input inputMode="decimal" value={newOpt} onChange={(e) => setNewOpt(e.target.value)} placeholder="Thêm mục tiêu, vd 150" aria-label="Thêm mục tiêu km"
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
  const clubPays = d.audience === 'CLUB_ONLY' && !(d.format === 'SOLO_GOAL' && d.personal)
  const fund = clubPays ? (quote?.payer === 'CLUB' ? quote.payerBalance : 0) : (quote?.walletBalance ?? balance)
  const policy = quote?.policy ?? DEFAULT_POLICY
  const tiers = policy.capacityTiers
  const maxTier = tiers.at(-1)?.max ?? 1000
  const slots = effectiveSlots(d)
  const fee = creationFee(slots, tiers)
  // Gói VIP / CLB Pro còn lượt: mức quy mô nằm trong lượt thì không nhắc tới giá
  const covered = (max: number) => !!quote && quote.bestPassSlots >= max
  const planName = quote?.plan?.name
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
        {!(d.format === 'SOLO_GOAL' && d.personal) && (
          <Field label="Hạn đăng ký (không bắt buộc)" htmlFor="c-reg" error={errors.regDeadline}
            hint={d.format === 'TEAM' ? 'Mặc định: đến giờ xuất phát (đội khóa khi bắt đầu)'
              : 'Mặc định: đến khi kết thúc. Sửa được sau khi tạo. Ai tham gia trễ vẫn được tính mọi bài chạy từ ngày bắt đầu.'}>
            <div className="flex gap-2">
              <Input id="c-reg" type="datetime-local" value={d.regDeadline ? toLocalInput(d.regDeadline) : ''}
                onChange={(e) => set({ regDeadline: e.target.value ? fromLocalInput(e.target.value) : null })} />
              {d.regDeadline && <Button type="button" variant="ghost" className="shrink-0" onClick={() => set({ regDeadline: null })}>Bỏ</Button>}
            </div>
          </Field>
        )}
        {d.format !== 'DUEL' && (
          <Field label="Tự lặp lại" htmlFor="c-recur"
            hint={d.recurrence === 'NONE' ? 'Hết kỳ, hệ thống tự mở kỳ mới cùng luật — không phải tạo lại mỗi tuần'
              : `Mỗi kỳ tự tạo trước khi kỳ cũ kết thúc 1 ngày; phí / lượt tính như tạo mới${d.audience === 'CLUB_ONLY' ? ' (trừ quỹ CLB)' : ''}. Tắt được bất cứ lúc nào.`}
            error={!recurrenceAllowed(d, d.recurrence) ? 'Mỗi kỳ dài hơn chu kỳ lặp — rút ngắn thời gian hoặc chọn chu kỳ dài hơn' : undefined}>
            <select id="c-recur" value={d.recurrence} onChange={(e) => set({ recurrence: e.target.value as Recurrence })}
              className="h-11 w-full rounded-xl border border-border bg-surface px-3 text-sm">
              {(Object.keys(RECURRENCE_LABEL) as Recurrence[]).map((r) => <option key={r} value={r}>{RECURRENCE_LABEL[r]}</option>)}
            </select>
          </Field>
        )}
      </section>

      {d.format !== 'DUEL' && (d.format !== 'SOLO_GOAL' || !d.personal) && (
        <section className="space-y-2">
          <p className="text-sm font-medium text-fg-muted">{quote?.bestPassSlots ? `Quy mô · ${planName ?? 'gói của bạn'} miễn phí tới ${formatNumber(quote.bestPassSlots)} người` : 'Quy mô (phí thu một lần, không phụ thuộc thời gian)'}</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="radiogroup" aria-label="Chọn quy mô">
            {tiers.filter((t) => t.max >= 2).map((t) => {
              const on = slots <= t.max && (capacityTier(slots, tiers)?.max === t.max)
              return (
                <button key={t.max} type="button" role="radio" aria-checked={on} onClick={() => set({ maxSlots: t.max })}
                  className={cn('rounded-xl border px-3 py-2 text-left', on ? 'border-brand bg-brand/10' : 'border-border bg-surface')}>
                  <span className="block text-sm font-semibold">≤ {formatNumber(t.max)} người</span>
                  {covered(t.max) ? <span className="block text-xs font-semibold text-brand">Trong gói</span>
                    : <span className={cn('block text-xs font-semibold', t.xu ? 'text-coin' : 'text-brand')}>{t.xu ? `${formatCoin(t.xu)} Xu` : 'Miễn phí'}</span>}
                </button>
              )
            })}
          </div>
          <NumberField id="c-slots" label="Số người tối đa" value={d.maxSlots} step={1} min={2} max={maxTier} onChange={(v) => set({ maxSlots: v })}
            error={errors.maxSlots ?? (slots > maxTier ? `Trên ${formatNumber(maxTier)} người: liên hệ admin để được cấp riêng` : undefined)} unit="người" />
          {quote?.pass && fee !== null && fee > 0 ? (
            <p className="flex items-center gap-1.5 text-sm font-semibold text-brand">
              <Ticket className="size-4" aria-hidden />Miễn phí với {planName ?? 'gói của bạn'} · còn {quote.pass.remaining} lượt tháng này
            </p>
          ) : (
            <p className="flex flex-wrap items-center gap-1.5 text-sm">
              <Coins className="size-4 text-coin" aria-hidden />
              <span className="text-fg-muted">Phí tạo:</span>
              {fee === null ? <span className="font-semibold text-danger">Liên hệ admin</span>
                : <span className={cn('font-semibold', fee ? 'text-coin' : 'text-brand')}>{fee ? `${formatCoin(fee)} Xu (${xuToVnd(fee, policy)})` : 'Miễn phí'}</span>}
              {fee !== null && fee > 0 && <span className="text-fg-subtle">· {clubPays ? 'trừ quỹ CLB' : 'trừ ví của bạn'}</span>}
            </p>
          )}
          {!quote?.pass && !quote?.plan && fee !== null && fee > 0 && (
            <p className="text-xs text-fg-subtle">
              Gói VIP / CLB Pro có lượt tạo miễn phí mỗi tháng.<PurchaseOnly> <Link href={routes.plan} className="font-semibold text-brand">Xem gói</Link></PurchaseOnly>
            </p>
          )}
          {!quote?.pass && quote?.plan && fee !== null && fee > 0 && (
            <p className="text-xs text-fg-subtle">
              {quote.bestPassSlots ? `Lượt ${quote.plan.name} chỉ bao tới ${formatNumber(quote.bestPassSlots)} người — giảm quy mô để miễn phí.` : `Đã dùng hết lượt ${quote.plan.name} tháng này.`}
            </p>
          )}
        </section>
      )}

      {clubPays ? (
      <section className="space-y-3">
        <p className="text-sm font-medium text-fg-muted">Giải thưởng từ quỹ CLB (không bắt buộc)</p>
        <NumberField id="c-reward" label="Treo thưởng" unit="Xu" step={50} max={100000} value={d.rewardXu} onChange={(v) => set({ rewardXu: v })}
          error={errors.rewardXu ?? (quote && d.rewardXu > fund ? `${clubPays ? 'Quỹ CLB' : 'Ví của bạn'} chỉ có ${formatCoin(fund)} Xu` : undefined)}
          hint="Trừ quỹ CLB ngay khi tạo, hoàn lại nếu không ai đạt hoặc thử thách bị hủy" />
        {isCommunity(d.format) && !(d.targetValue > 0) && d.rewardXu > 0 && (
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
        <p className="text-xs text-fg-subtle">RaceHub không có cược giữa người chơi: chỉ quỹ CLB được treo thưởng.</p>
      </section>
      ) : (
        <p className="text-xs text-fg-subtle">Chỉ thử thách nội bộ CLB mới treo thưởng Xu (trích quỹ CLB). Người hoàn thành vẫn nhận Xu & XP từ km chạy như thường.</p>
      )}
    </div>
  )
}

function StepReview({ d, quote, bill, loading, failed, quoteError, onRetry, clubName, onEdit }: {
  d: ChallengeDraft; quote?: ChallengeQuote; bill: Bill | null; loading: boolean; failed: boolean; quoteError?: unknown; onRetry: () => void; clubName?: string
  onEdit: (step: number, patch?: Partial<ChallengeDraft>) => void
}) {
  const router = useRouter()
  const Icon = FORMAT_ICON[d.format]
  const days = Math.max(1, Math.round((Date.parse(d.end) - Date.parse(d.start)) / DAY))
  const perDay = d.targetValue > 0 ? d.targetValue / days : 0
  const ranked = isCommunity(d.format) && !(d.targetValue > 0)
  const summary = useMemo(() => rewardSummary({ reward_xu: d.rewardXu, reward_split: ranked ? d.rewardSplit : d.format === 'TEAM' ? 'TEAM' : d.format === 'DUEL' ? 'WINNER' : 'FINISHERS', format: ranked ? 'RANKED' : d.format }), [d, ranked])
  const conquest = isConquest(d.objective)
  return (
    <div className="space-y-4">
      <Card className="space-y-3">
        <div className="flex items-center gap-3">
          <span className={cn('grid size-11 place-items-center rounded-xl', FORMAT_TONE[d.format])}><Icon className="size-5" aria-hidden /></span>
          <div className="min-w-0"><p className="text-xs font-semibold text-fg-muted">{isTeamPledge(d) ? 'Đồng đội · Đua đội theo mục tiêu' : `${FORMAT_META[d.format].label}${d.format === 'TEAM' ? ` · ${TEAM_MODE_META[d.gameMode].label}` : ''}${d.format === 'SOLO_GOAL' && d.personal ? ' · Cá nhân tôi' : ''}`}</p>
            <p className="truncate text-lg font-bold">{d.title}</p></div>
        </div>
        <ul className="space-y-1.5 text-sm">
          {conquest ? (
            <li><span className="text-fg-subtle">{objectiveMeta(d.objective, d.conquest.mode).label}: </span>
              {d.conquest.categories.map((x) => `${x.label} (${kmLabel(x.km)})${d.conquest.mode === 'FIXED' ? ` ≤ ${x.target}${d.objective === 'BEST_PACE' ? '/km' : ''}` : ''}`).join(' · ')}
              {d.conquest.mode === 'SELF' ? ' · người chơi tự đặt mục tiêu' : ''}</li>
          ) : d.pledge.enabled && pledgeSupported(d) ? (
            <li><span className="text-fg-subtle">Mục tiêu tự đăng ký: </span>
              {d.pledge.options.length ? d.pledge.options.map((o) => `${o}`).join(' · ') + ' km' : `${d.pledge.minKm}–${d.pledge.maxKm} km`}
              {d.pledge.capPct !== null ? ` · tính vượt tối đa ${d.pledge.capPct}%` : ''}</li>
          ) : (
            <li><span className="text-fg-subtle">Tính theo: </span>{OBJECTIVE_META[d.objective].label}{d.targetValue > 0 ? ` · mục tiêu ${formatScore(d.objective, d.targetValue)}` : ''}</li>
          )}
          <li><span className="text-fg-subtle">Thời gian: </span>{fmtWhen(d.start)} → {fmtWhen(d.end)} ({days} ngày)</li>
          {d.regDeadline && <li><span className="text-fg-subtle">Hạn đăng ký: </span>{fmtWhen(d.regDeadline)}</li>}
          {d.recurrence !== 'NONE' && <li><span className="text-fg-subtle">Lặp lại: </span>{RECURRENCE_LABEL[d.recurrence].toLowerCase()} · kỳ mới tự mở cùng luật</li>}
          {perDay > 0 && !conquest && <li><span className="text-fg-subtle">Trung bình cần: </span>{formatScore(d.objective, perDay)}/ngày</li>}
          <li><span className="text-fg-subtle">Phạm vi: </span>{d.format === 'SOLO_GOAL' && d.personal ? 'Cá nhân tôi' : d.audience === 'CLUB_ONLY' ? `Nội bộ ${clubName ?? 'CLB'}` : AUDIENCE_LABEL[d.format === 'DUEL' && d.audience === 'PUBLIC' ? 'INVITE_ONLY' : d.audience]}</li>
          {d.requireHr && <li><span className="text-fg-subtle">Nhịp tim: </span>Bắt buộc — bài không có nhịp tim không được tính</li>}
          {d.format === 'TEAM' && <li><span className="text-fg-subtle">Đội: </span>{isTeamPledge(d) ? `Tự chia theo số người đăng ký · ${d.pledge.teamSize} người/đội` : d.teamNames.filter((n) => n.trim()).join(' · ')}</li>}
          <li><span className="text-fg-subtle">Luật: </span>{conquest ? '' : `≥ ${formatNumber(d.minKm)} km/${d.objective === 'STREAK_DAYS' ? 'ngày' : 'bài'} · `}pace {d.minPace}–{d.maxPace} ph/km{d.dailyCapKm > 0 ? ` · tối đa ${d.dailyCapKm} km/ngày` : ''}</li>
          {summary && <li><span className="text-fg-subtle">Thưởng: </span>{summary}</li>}
          {hasRulesInfo(d.rules) && <li><span className="text-fg-subtle">Thể lệ BTC: </span>
            {[d.rules.prizes && 'thưởng', d.rules.penalties && 'phạt', d.rules.fees && 'lệ phí', d.rules.conduct && 'quy định', d.rules.contact && 'liên hệ',
              d.rules.custom?.length && `${d.rules.custom.length} mục khác`].filter(Boolean).join(' · ')}
            <button type="button" className="ml-1 text-brand underline-offset-2 hover:underline" onClick={() => onEdit(1)}>Sửa</button></li>}
        </ul>
      </Card>

      {failed && !quote ? (
        <Card className="flex items-center justify-between gap-3 border-danger/30 bg-danger/5">
          <p className="text-sm text-fg-muted">Không tính được phí: {challengeErrorMessage(quoteError)}</p>
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
              const tiers = quote.policy.capacityTiers
              const slots = effectiveSlots(d)
              const out: ReactNode[] = []
              const cheaper = d.format === 'DUEL' || bill.feeDue <= 0 ? [] : tiers.filter((t) => t.max >= 2 && t.max < slots && t.xu < quote.fee).slice(-2).reverse()
              for (const t of cheaper) {
                out.push(<Suggestion key={`tier-${t.max}`} title={`Giảm còn ${formatNumber(t.max)} người`}
                  text={t.xu ? `Phí chỉ còn ${formatCoin(t.xu)} Xu` : 'Nhóm nhỏ được tạo miễn phí'} action="Sửa" onClick={() => onEdit(2, { maxSlots: t.max })} />)
              }
              if (d.rewardXu > 0) {
                out.push(<Suggestion key="reward" title="Bỏ hoặc giảm tiền treo thưởng" text={`Đang treo ${formatCoin(d.rewardXu)} Xu`} action="Sửa" onClick={() => onEdit(2)} />)
              }
              if (bill.clubShort > 0 && d.clubId) {
                out.push(<Suggestion key="fund" title="Góp thêm vào quỹ CLB" text="Thành viên có thể góp Xu vào quỹ ở tab Quỹ"
                  action="Mở quỹ" onClick={() => router.push(routes.clubTab(d.clubId!, 'treasury'))} />)
              }
              if (!(d.format === 'SOLO_GOAL' && d.personal) && bill.walletShort > 0) {
                out.push(<Suggestion key="solo" title="Chinh phục cá nhân (chỉ mình bạn) luôn miễn phí" text="Tự đặt mục tiêu cho riêng mình, không mất phí"
                  action="Đổi" onClick={() => onEdit(0, { format: 'SOLO_GOAL', personal: true, audience: 'PUBLIC', pledge: { ...d.pledge, enabled: false }, targetValue: d.targetValue || 50 })} />)
              }
              return out
            })()}
            <p className="text-sm text-fg-muted">
              <PurchaseOnly fallback="Chạy thêm để kiếm Xu">Hoặc <Link href={routes.plan} className="font-semibold text-brand">{quote.plan ? 'nạp Xu' : 'nạp Xu / mua gói'}</Link>, hay chạy thêm để kiếm Xu</PurchaseOnly> ({runPolicyText(quote.policy.run)}).
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
  const clubReward = d.rewardXu > 0 && d.audience === 'CLUB_ONLY' ? d.rewardXu : 0
  const cq = q.clubQuota
  // Được gói bao / nhóm nhỏ / mục tiêu cá nhân, không treo thưởng: không bày bảng phí, ví, quỹ
  if (bill.fromWallet === 0 && bill.fromClub === 0) {
    return (
      <Card className="flex items-start gap-3 border-brand/30 bg-brand/5">
        <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-brand" aria-hidden />
        <div className="min-w-0 text-sm">
          <p className="font-semibold">Tạo miễn phí</p>
          <p className="text-fg-muted">
            {cq?.eligible && q.listFee > 0
              ? `Trong hạn mức ${cq.plan === 'PRO' ? 'CLB Pro' : 'CLB miễn phí'}${clubName ? ` của ${clubName}` : ''} · thử thách đang diễn ra ${cq.open}/${cq.max_open}`
              : q.pass && q.fee > 0
              ? `Dùng 1 lượt ${q.plan?.name ?? 'miễn phí'}${q.payer === 'CLUB' ? ` của ${clubName ?? 'CLB'}` : ''} · còn ${q.pass.remaining} lượt tháng này`
              : d.format === 'SOLO_GOAL' && d.personal ? 'Chinh phục cá nhân (chỉ mình bạn) luôn miễn phí.' : `Quy mô ≤ ${formatNumber(q.tier?.max ?? slots)} người không mất phí.`}
          </p>
        </div>
      </Card>
    )
  }
  return (
    <Card className="space-y-2">
      {cq && !cq.eligible && q.listFee > 0 && <QuotaHint q={cq} clubId={d.clubId} />}
      {!(q.pass && q.fee > 0) && <Row label={`Phí tạo (quy mô ≤ ${formatNumber(q.tier?.max ?? slots)} người)`} value={q.fee ? `${formatCoin(q.fee)} Xu` : 'Miễn phí'} />}
      {q.fee > 0 && !q.pass && <p className="-mt-1 text-right text-xs text-fg-subtle">{xuToVnd(q.fee, q.policy)}</p>}
      {q.pass && q.fee > 0 && (
        <div className="flex items-start gap-2 rounded-xl border border-brand/40 bg-brand/10 p-2.5 text-sm">
          <Ticket className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden />
          <span className="min-w-0 flex-1">
            <span className="block font-semibold">Tạo miễn phí · dùng 1 lượt {q.plan?.name ?? 'tạo miễn phí'}</span>
            <span className="block text-xs text-fg-muted">
              {q.payer === 'CLUB' ? 'Lượt của CLB' : 'Lượt của bạn'} · còn {q.pass.remaining} lượt · cho thử thách tối đa {formatNumber(q.pass.max_slots)} người
              {q.pass.expires_at ? ` · hạn ${new Date(q.pass.expires_at).toLocaleDateString('vi-VN')}` : ''}
            </span>
          </span>
        </div>
      )}
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

const QUOTA_WHY = {
  NEED_ACTIVE_MEMBERS: (q: ClubChallengeQuota) =>
    `CLB mới có ${q.active_members}/${q.min_active_members} thành viên có bài chạy trong ${q.active_window_days} ngày qua — chưa đủ để tạo miễn phí.`,
  OPEN_LIMIT: (q: ClubChallengeQuota) => `CLB đang có ${q.open}/${q.max_open} thử thách diễn ra cùng lúc — đã hết lượt miễn phí.`,
  SLOTS_LIMIT: (q: ClubChallengeQuota) => `Thử thách miễn phí tối đa ${formatNumber(q.max_slots)} người.`,
} as const

/** Vì sao thử thách CLB này mất phí + gợi ý nâng CLB Pro (migration 008200) */
function QuotaHint({ q, clubId }: { q: ClubChallengeQuota; clubId?: string | null }) {
  return (
    <div className="rounded-xl border border-coin/40 bg-coin/10 p-2.5 text-sm">
      <p className="font-semibold">Ngoài hạn mức miễn phí của CLB</p>
      <p className="text-xs text-fg-muted">
        {q.reason ? QUOTA_WHY[q.reason](q) : ''}
        {q.plan === 'FREE' && ` CLB Pro: tới ${q.pro.max_open} thử thách cùng lúc, mỗi thử thách tới ${formatNumber(q.pro.max_slots)} người, không mất phí.`}
      </p>
      {q.plan === 'FREE' && clubId && (
        <Link href={routes.clubTab(clubId, 'settings')} className="mt-1 inline-block text-xs font-semibold text-brand">Xem gói CLB Pro →</Link>
      )}
    </div>
  )
}
