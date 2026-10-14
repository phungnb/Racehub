'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { ArrowLeft, Info } from 'lucide-react'
import { toast } from 'sonner'
import { Button, Card, Field, Input, Skeleton, Textarea } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { createCup, cupErrorMessage, type LeagueInput, type MatchTerms } from '../api/cupApi'
import { validateCup } from '../model/cup'
import { defaultTerms, rulesSummary, validateTerms } from '../model/match'
import { useCupOrganizer } from '../hooks/useCupOrganizer'
import { RulesForm } from './RulesForm'

/** Mặc định: bắt đầu sau 3 ngày (đủ thời gian các CLB đăng ký), 2 tuần, trung bình km */
function defaults(now: number): MatchTerms {
  const t = defaultTerms(now)
  const start = new Date(now); start.setDate(start.getDate() + 3); start.setHours(0, 0, 0, 0)
  const end = new Date(start); end.setDate(end.getDate() + 14); end.setMinutes(-1)
  return { ...t, start_at: start.toISOString(), end_at: end.toISOString() }
}

/** Luật giải online ở dạng chuỗi nhập tay ('' = không áp) */
type LeagueForm = { on: boolean; min_run_km: string; min_pace: string; max_pace: string; member_min_km: string; min_valid_pct: string
  max_runners: string; require_club_approval: boolean; reward_form_url: string; prize_top_clubs: string; prize_top_runners: string }
const NO_LEAGUE: LeagueForm = { on: false, min_run_km: '', min_pace: '', max_pace: '', member_min_km: '', min_valid_pct: '', max_runners: '',
  require_club_approval: false, reward_form_url: '', prize_top_clubs: '', prize_top_runners: '' }
/** Mẫu giải "Giao lưu các CLB": bài ≥ 1 km, pace 3–15, thành viên ≥ 80 km, CLB cần 80% hợp lệ, 500 runner sớm nhất, BTC duyệt CLB */
const ONLINE_LEAGUE: LeagueForm = { on: true, min_run_km: '1', min_pace: '3', max_pace: '15', member_min_km: '80', min_valid_pct: '80', max_runners: '500',
  require_club_approval: true, reward_form_url: '', prize_top_clubs: '6', prize_top_runners: '25' }
const numOrNull = (v: string) => (v.trim() ? Number(v.replace(',', '.')) : null)
const toLeagueInput = (f: LeagueForm): LeagueInput => !f.on ? {} : {
  min_run_km: numOrNull(f.min_run_km), min_pace: numOrNull(f.min_pace), max_pace: numOrNull(f.max_pace), member_min_km: numOrNull(f.member_min_km),
  min_valid_pct: numOrNull(f.min_valid_pct), max_runners: numOrNull(f.max_runners), require_club_approval: f.require_club_approval,
  reward_form_url: f.reward_form_url.trim() || null, prize_top_clubs: numOrNull(f.prize_top_clubs), prize_top_runners: numOrNull(f.prize_top_runners),
}

/** Tạo Thách đấu CLB: dưới tên CLB mình quản trị (mở ngay), RaceHub (admin) hoặc cá nhân (chờ admin duyệt) */
export function CreateCupScreen() {
  const router = useRouter()
  const org = useCupOrganizer()
  const [now] = useState(() => Date.now())
  const [terms, setTerms] = useState<MatchTerms>(() => defaults(now))
  const [host, setHost] = useState<string | 'NONE' | null>(null)
  const [title, setTitle] = useState('')
  const [desc, setDesc] = useState('')
  const [prize, setPrize] = useState('')
  const [max, setMax] = useState('20')
  const [league, setLeague] = useState<LeagueForm>(NO_LEAGUE)
  const hostId = host ?? org.staffClubs[0]?.club_id ?? 'NONE'
  const needsReview = hostId === 'NONE' && !org.isAdmin
  // Hạn CLB đăng ký = giờ chốt danh sách thi đấu (sau đó thành viên không đăng ký thêm được)
  const close = new Date(Date.parse(terms.start_at) - terms.lock_hours * 3600_000).toISOString()
  const error = validateCup({ title, start: terms.start_at, end: terms.end_at, close, maxClubs: Number(max) }, now) ?? validateTerms(terms, now, 'CUP')

  const create = useMutation({
    mutationFn: () => createCup({
      ...terms, title: title.trim(), description: desc.trim(), prize: prize.trim(), max_clubs: Number(max),
      reg_close_at: close, host_club_id: hostId === 'NONE' ? null : hostId, ...toLeagueInput(league),
    }),
    onSuccess: (c) => {
      toast.success(c.status === 'PENDING_REVIEW' ? 'Đã gửi — chờ admin duyệt, bạn sẽ nhận thông báo' : 'Đã mở thách đấu, mời các CLB đăng ký!')
      router.replace(`/cups/${c.id}`)
    },
    onError: (e) => toast.error(cupErrorMessage(e)),
  })

  if (org.isLoading) return <Skeleton className="h-96" />
  const option = (id: string, label: string, hint: string) => (
    <button key={id} type="button" aria-pressed={hostId === id} onClick={() => setHost(id)}
      className={cn('rounded-xl border p-3 text-left', hostId === id ? 'border-brand bg-brand/10' : 'border-border')}>
      <span className="block text-sm font-semibold">{label}</span>
      <span className="block text-[11px] text-fg-muted">{hint}</span>
    </button>
  )

  return (
    <div className="space-y-5 pb-6">
      <Link href="/cups" className="inline-flex items-center gap-1.5 text-sm text-fg-muted hover:text-fg"><ArrowLeft className="size-4" aria-hidden />Thách đấu CLB</Link>
      <h1 className="text-2xl font-bold">Tạo thách đấu CLB</h1>

      <Field label="Đơn vị tổ chức">
        <div className="grid gap-2">
          {org.staffClubs.map((c) => option(c.club_id, c.name, 'Mở đăng ký ngay · CLB tự vào thách đấu'))}
          {option('NONE', org.isAdmin ? 'RaceHub' : 'Cá nhân tôi', org.isAdmin ? 'Admin tạo: mở ngay' : 'Cần admin RaceHub duyệt trước khi mở')}
        </div>
      </Field>
      {needsReview && (
        <p className="flex gap-2 rounded-xl bg-warning/10 p-3 text-xs text-warning">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden />Bạn không phải ban quản trị CLB nào nên thách đấu sẽ chờ admin duyệt. Khi được duyệt, Chủ nhiệm / Quản trị viên các CLB mới đăng ký được.
        </p>
      )}

      <Field label="Tên thách đấu" htmlFor="cup-title" hint={`${title.trim().length}/120`}>
        <Input id="cup-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder="VD: Cúp Hồ Gươm tháng 11" />
      </Field>
      <Field label="Giới thiệu (không bắt buộc)" htmlFor="cup-desc">
        <Textarea id="cup-desc" value={desc} onChange={(e) => setDesc(e.target.value)} maxLength={1000} placeholder="Luật chơi, mục đích, liên hệ ban tổ chức…" />
      </Field>
      <Field label="Giải thưởng (không bắt buộc)" htmlFor="cup-prize">
        <Input id="cup-prize" value={prize} onChange={(e) => setPrize(e.target.value)} maxLength={200} placeholder="VD: Cúp + 5 triệu quỹ CLB cho đội vô địch" />
      </Field>

      <Card className="space-y-4">
        <RulesForm value={terms} onChange={setTerms} kind="CUP" />
        <Field label="Số CLB tối đa" htmlFor="cup-max">
          <Input id="cup-max" inputMode="numeric" value={max} onChange={(e) => setMax(e.target.value.replace(/\D/g, '').slice(0, 3))} />
        </Field>
      </Card>

      {org.isAdmin && <LeagueFields value={league} onChange={setLeague} onPreset={() => { setLeague(ONLINE_LEAGUE); setTerms((t) => ({ ...t, format: 'AVG', measure: 'KM', min_roster: 20, lock_hours: Math.max(t.lock_hours, 24) })) }} />}

      <ul className="space-y-1 text-xs text-fg-muted">
        <li>• Chủ nhiệm / Quản trị viên đăng ký CLB; thành viên tự bấm &quot;Đăng ký thi đấu&quot; trước giờ chốt danh sách. Mỗi người thi đấu cho một CLB.</li>
        {rulesSummary({ ...terms, kind: 'CUP', rules_version: 2, final_delay_hours: 48 }).map((r) => <li key={r}>• {r}</li>)}
      </ul>
      {error && title && <p className="text-xs text-danger">{error}</p>}
      <Button block size="lg" onClick={() => create.mutate()} loading={create.isPending} disabled={!!error}>
        {needsReview ? 'Gửi admin duyệt' : 'Mở thách đấu'}
      </Button>
    </div>
  )
}

/** Luật riêng của giải online (chỉ admin RaceHub): bài tối thiểu, pace, ngưỡng hợp lệ, giới hạn runner, duyệt CLB, link form nhận giải */
function LeagueFields({ value: f, onChange, onPreset }: { value: LeagueForm; onChange: (f: LeagueForm) => void; onPreset: () => void }) {
  const set = (k: keyof LeagueForm, v: string | boolean) => onChange({ ...f, [k]: v })
  const field = (k: keyof LeagueForm, label: string, hint?: string) => (
    <Field label={label} htmlFor={`lg-${k}`} hint={hint}>
      <Input id={`lg-${k}`} inputMode="decimal" value={String(f[k])} onChange={(e) => set(k, e.target.value.replace(/[^0-9.,]/g, ''))} />
    </Field>
  )
  return (
    <Card className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-bold">Luật giải online (ban tổ chức)</p>
        {f.on ? <Button size="sm" variant="ghost" onClick={() => onChange(NO_LEAGUE)}>Tắt</Button> : <Button size="sm" variant="secondary" onClick={() => onChange({ ...NO_LEAGUE, on: true })}>Bật</Button>}
      </div>
      {f.on && (
        <>
          <Button size="sm" variant="secondary" onClick={onPreset}>Dùng mẫu &quot;Giao lưu các CLB&quot;</Button>
          <div className="grid grid-cols-2 gap-3">
            {field('min_run_km', 'Bài tối thiểu (km)')}
            {field('member_min_km', 'Thành viên hợp lệ từ (km)')}
            {field('min_pace', 'Pace nhanh nhất (phút/km)')}
            {field('max_pace', 'Pace chậm nhất (phút/km)')}
            {field('min_valid_pct', 'CLB cần % thành viên hợp lệ', 'Trống = không xét')}
            {field('max_runners', 'Giới hạn runner đăng ký', 'Đủ là đóng đăng ký')}
            {field('prize_top_clubs', 'Số CLB đạt giải')}
            {field('prize_top_runners', 'Số cá nhân đạt giải')}
          </div>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1" checked={f.require_club_approval} onChange={(e) => set('require_club_approval', e.target.checked)} />
            <span>CLB phải đủ số thành viên tối thiểu và được ban tổ chức duyệt mới vào giải</span>
          </label>
          <Field label="Link form nhận giải (có thể dán sau)" htmlFor="lg-reward">
            <Input id="lg-reward" value={f.reward_form_url} onChange={(e) => set('reward_form_url', e.target.value)} placeholder="https://forms.gle/…" inputMode="url" autoCapitalize="off" />
          </Field>
        </>
      )}
    </Card>
  )
}
