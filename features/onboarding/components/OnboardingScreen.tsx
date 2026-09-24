'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, BellRing, Check, CheckCircle2, ChevronRight, KeyRound, Loader2, Search, Users, Watch } from 'lucide-react'
import { toast } from 'sonner'
import { Avatar, Button, Card, Field, Input, Skeleton } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { useDebounced } from '@/shared/lib/search'
import { ICONS } from '@/shared/config/brand'
import { routes } from '@/shared/config/routes'
import { useInvalidateProfile, useMyProfile, useSession } from '@/features/auth'
import { AvatarPicker, getMyProfile, myProfileKey, profileErrorMessage, updateMyProfile, type Gender } from '@/features/profile'
import { clubErrorMessage, joinClub, joinClubByCode, searchClubs, useClubInbox } from '@/features/club'
import { usePush } from '@/features/notification'
import { useInstallAction } from '@/features/pwa'
import { PaperDoll, resolveOutfit, useCharacterState } from '@/features/character'
import { completeOnboarding } from '../api/onboardingApi'
import { STEP_COUNT, nameFromEmail, nextStep, parseInviteCode, parseStep, prevStep, stepNumber, welcomeUrl, type Step } from '../model/steps'

const STRAVA_ERRORS: Record<string, string> = {
  access_denied: 'Bạn chưa cho phép RaceHub đọc dữ liệu Strava.',
  account_conflict: 'Tài khoản Strava này đã gắn với một tài khoản RaceHub khác.',
  invalid_state: 'Phiên kết nối hết hạn. Thử lại nhé.',
  server_error: 'Strava đang lỗi. Bạn có thể kết nối sau trong trang Tôi.',
}

/** Màn chào mừng người mới: hồ sơ → đồng hồ → CLB → thông báo → nhân vật sẵn sàng */
export function OnboardingScreen() {
  const params = useSearchParams()
  const router = useRouter()
  const step = parseStep(params.get('step'))
  const go = (s: Step) => router.replace(welcomeUrl(s), { scroll: true })
  const next = () => go(nextStep(step))
  const back = prevStep(step)

  useEffect(() => {
    const err = params.get('strava_error')
    if (err) toast.error(STRAVA_ERRORS[err] ?? STRAVA_ERRORS.server_error)
    if (params.get('strava_success')) toast.success('Đã kết nối Strava! Bài chạy 30 ngày gần nhất đang được đồng bộ.')
  }, [params])

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))]">
      {step !== 'done' && (
        <header className="flex items-center gap-3 pb-6">
          {back ? (
            <button type="button" onClick={() => go(back)} aria-label="Quay lại"
              className="-ml-2 grid size-11 place-items-center rounded-full text-fg-muted hover:bg-surface-2"><ArrowLeft className="size-5" aria-hidden /></button>
          ) : <span className="size-11 -ml-2" aria-hidden />}
          <div className="flex flex-1 gap-1.5" role="progressbar" aria-valuemin={1} aria-valuemax={STEP_COUNT} aria-valuenow={stepNumber(step)}
            aria-label={`Bước ${stepNumber(step)} trên ${STEP_COUNT}`}>
            {Array.from({ length: STEP_COUNT }, (_, i) => (
              <span key={i} className={cn('h-1.5 flex-1 rounded-full transition-colors', i < stepNumber(step) ? 'bg-brand' : 'bg-surface-2')} />
            ))}
          </div>
          {step !== 'profile' ? (
            <button type="button" onClick={next} className="min-h-11 px-2 text-sm font-semibold text-fg-muted hover:text-fg">Bỏ qua</button>
          ) : <span className="w-14" aria-hidden />}
        </header>
      )}
      <div key={step} className="flex flex-1 flex-col animate-fade-in">
        {step === 'profile' && <ProfileStep onDone={next} />}
        {step === 'device' && <DeviceStep onDone={next} />}
        {step === 'club' && <ClubStep onDone={next} />}
        {step === 'notify' && <NotifyStep onDone={next} />}
        {step === 'done' && <DoneStep />}
      </div>
    </div>
  )
}

function StepTitle({ kicker, title, desc }: { kicker: string; title: string; desc: string }) {
  return (
    <div className="space-y-1.5 pb-6">
      <p className="text-xs font-bold uppercase tracking-wider text-brand">{kicker}</p>
      <h1 className="text-[28px] font-extrabold leading-tight">{title}</h1>
      <p className="text-fg-muted">{desc}</p>
    </div>
  )
}

/* ---------------------------------------------------------------- 1. Hồ sơ */
function ProfileStep({ onDone }: { onDone: () => void }) {
  const q = useQuery({ queryKey: myProfileKey, queryFn: getMyProfile })
  if (q.isPending) return <Skeleton className="h-96" />
  if (q.isError) return <p className="text-danger">{profileErrorMessage(q.error)}</p>
  return <ProfileForm key={q.data.id} initialName={q.data.display_name} initialGender={q.data.gender} avatarUrl={q.data.avatar_url} userId={q.data.id} onDone={onDone} />
}

function ProfileForm({ initialName, initialGender, avatarUrl, userId, onDone }: {
  initialName: string; initialGender: Gender | null; avatarUrl: string | null; userId: string; onDone: () => void
}) {
  const { session } = useSession()
  const qc = useQueryClient()
  const invalidate = useInvalidateProfile()
  const [name, setName] = useState(() => (initialName?.trim() && initialName !== 'Runner' ? initialName : nameFromEmail(session?.user.email)))
  const [gender, setGender] = useState<Gender | null>(initialGender)
  const valid = name.trim().length >= 2 && name.trim().length <= 40 && !!gender
  const save = useMutation({
    mutationFn: () => updateMyProfile({ display_name: name.trim(), gender: gender! }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: myProfileKey })
      void qc.invalidateQueries({ queryKey: ['character'] })
      invalidate()
      onDone()
    },
    onError: (e) => toast.error(profileErrorMessage(e)),
  })

  return (
    <>
      <StepTitle kicker="Chào mừng tới RaceHub" title="Bạn là runner nào?" desc="Tên và giới tính giúp CLB nhận ra bạn và tạo nhân vật đúng dáng." />
      <div className="flex-1 space-y-6">
        <div className="flex items-center gap-4">
          <AvatarPicker userId={userId} avatarUrl={avatarUrl} name={name} size="lg">
            {() => <p className="text-sm text-fg-muted">Ảnh đại diện<br /><span className="text-xs text-fg-subtle">Không bắt buộc — bấm vào ảnh để đổi</span></p>}
          </AvatarPicker>
        </div>
        <Field label="Tên hiển thị" htmlFor="ob-name" hint="Tên thật hoặc biệt danh chạy bộ">
          <Input id="ob-name" value={name} maxLength={40} autoComplete="nickname" onChange={(e) => setName(e.target.value)} placeholder="Nguyễn Lan" />
        </Field>
        <fieldset>
          <legend className="pb-2 text-sm font-semibold">Giới tính</legend>
          <div className="grid grid-cols-2 gap-3">
            {(['male', 'female'] as const).map((g) => (
              <button key={g} type="button" onClick={() => setGender(g)} aria-pressed={gender === g}
                className={cn('relative overflow-hidden rounded-2xl border-2 bg-surface-2 text-left transition-colors',
                  gender === g ? 'border-brand' : 'border-transparent hover:border-border')}>
                {/* eslint-disable-next-line @next/next/no-img-element -- ảnh nhân vật gốc (tĩnh) */}
                <img src={`/character/${g}/base.webp`} alt="" className="h-40 w-full object-cover object-top" />
                <span className="flex items-center justify-between px-3 py-2 font-semibold">
                  {g === 'male' ? 'Nam' : 'Nữ'}
                  {gender === g && <span className="grid size-5 place-items-center rounded-full bg-brand text-brand-fg"><Check className="size-3.5" aria-hidden /></span>}
                </span>
              </button>
            ))}
          </div>
        </fieldset>
      </div>
      <Button block size="lg" className="mt-6" disabled={!valid} loading={save.isPending} onClick={() => save.mutate()}>Tiếp tục</Button>
    </>
  )
}

/* ---------------------------------------------------------------- 2. Đồng hồ */
function DeviceStep({ onDone }: { onDone: () => void }) {
  const { profile } = useMyProfile()
  const connected = !!profile?.strava_connected
  const href = `/api/connect/strava?next=${encodeURIComponent(welcomeUrl('club'))}`
  return (
    <>
      <StepTitle kicker="Bước 2" title="Kết nối đồng hồ" desc="RaceHub đọc bài chạy qua Strava — Garmin, Coros, Apple Watch, Suunto, Huawei… đều tự đồng bộ." />
      <div className="flex-1 space-y-3">
        <Card className={cn('flex items-center gap-3', connected && 'border-brand/40')}>
          <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-[#fc4c02] text-lg font-black text-white" aria-hidden>S</span>
          <div className="min-w-0 flex-1">
            <p className="font-semibold">Strava</p>
            <p className="text-xs text-fg-muted">{connected ? 'Đã kết nối — bài chạy mới tự vào thử thách' : 'Miễn phí · chỉ đọc bài chạy, không đăng gì'}</p>
          </div>
          {connected ? <CheckCircle2 className="size-6 text-brand" aria-label="Đã kết nối" /> : <Watch className="size-6 text-fg-subtle" aria-hidden />}
        </Card>
        <ul className="space-y-2 px-1 text-sm text-fg-muted">
          <li className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden />Tự tính km vào thử thách, bảng xếp hạng CLB</li>
          <li className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden />Tự điểm danh buổi chạy nhóm</li>
          <li className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden />Kiếm Xu, XP để nâng cấp nhân vật</li>
        </ul>
      </div>
      {connected ? (
        <Button block size="lg" className="mt-6" onClick={onDone}>Tiếp tục</Button>
      ) : (
        <div className="mt-6 space-y-2">
          {/* Link thường (không prefetch) vì đây là route API chuyển hướng sang Strava */}
          <a href={href} className="block"><Button block size="lg">Kết nối Strava</Button></a>
          <Button block variant="ghost" onClick={onDone}>Để sau — tôi ghi bài chạy trong app</Button>
        </div>
      )}
    </>
  )
}

/* ---------------------------------------------------------------- 3. CLB */
function ClubStep({ onDone }: { onDone: () => void }) {
  const inbox = useClubInbox()
  const [code, setCode] = useState('')
  const [search, setSearch] = useState('')
  const [joined, setJoined] = useState<Record<string, 'APPROVED' | 'PENDING'>>({})
  const qc = useQueryClient()
  const term = useDebounced(search.trim())
  const clubs = useQuery({ queryKey: ['club-search', term], queryFn: () => searchClubs(term, 8), staleTime: 30_000, placeholderData: keepPreviousData })
  const mine = (inbox.data ?? []).filter((c) => c.member_status === 'APPROVED' || c.member_status === 'PENDING')

  const byCode = useMutation({
    mutationFn: () => joinClubByCode(parseInviteCode(code)),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['clubs'] })
      void inbox.refetch()
      toast.success(r.status === 'APPROVED' ? 'Đã vào CLB!' : 'Đã gửi yêu cầu, chờ ban quản trị duyệt')
      setCode('')
    },
    onError: (e) => toast.error(clubErrorMessage(e)),
  })
  const join = useMutation({
    mutationFn: (id: string) => joinClub(id).then((r) => ({ id, status: r.status })),
    onSuccess: ({ id, status }) => {
      setJoined((j) => ({ ...j, [id]: status === 'APPROVED' ? 'APPROVED' : 'PENDING' }))
      void inbox.refetch()
      toast.success(status === 'APPROVED' ? 'Đã vào CLB!' : 'Đã gửi yêu cầu tham gia')
    },
    onError: (e) => toast.error(clubErrorMessage(e)),
  })

  return (
    <>
      <StepTitle kicker="Bước 3" title="Chạy cùng CLB" desc="Nhận lịch chạy nhóm, thử thách nội bộ, bảng xếp hạng và chat với đồng đội." />
      <div className="flex-1 space-y-5">
        {mine.length > 0 && (
          <Card className="space-y-2">
            <p className="text-xs font-semibold text-fg-subtle">CLB của bạn</p>
            {mine.map((c) => (
              <div key={c.club_id} className="flex items-center gap-3">
                <Avatar src={c.avatar_url} name={c.name} size="sm" />
                <span className="min-w-0 flex-1 truncate font-semibold">{c.name}</span>
                <span className={cn('text-xs font-semibold', c.member_status === 'APPROVED' ? 'text-brand' : 'text-coin')}>
                  {c.member_status === 'APPROVED' ? 'Thành viên' : 'Chờ duyệt'}
                </span>
              </div>
            ))}
          </Card>
        )}

        <Field label="Có mã mời?" htmlFor="ob-code" hint="Dán mã hoặc link mời ban quản trị CLB gửi bạn">
          <div className="flex gap-2">
            <Input id="ob-code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="vd: hotay9" autoCapitalize="none" />
            <Button className="shrink-0" disabled={parseInviteCode(code).length < 4} loading={byCode.isPending} onClick={() => byCode.mutate()}>
              <KeyRound className="size-4" aria-hidden />Vào
            </Button>
          </div>
        </Field>

        <section className="space-y-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-subtle" aria-hidden />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Tìm CLB gần bạn" aria-label="Tìm CLB" className="pl-9" />
          </div>
          {clubs.isPending ? <Skeleton className="h-40" /> : (clubs.data ?? []).length === 0 ? (
            <p className="py-4 text-center text-sm text-fg-muted">Chưa thấy CLB phù hợp. Bạn có thể tạo CLB sau trong tab CLB.</p>
          ) : (
            <ul className="divide-y divide-border rounded-2xl border border-border">
              {(clubs.data ?? []).map((c) => {
                const state = joined[c.id] ?? (mine.find((m) => m.club_id === c.id)?.member_status as 'APPROVED' | 'PENDING' | undefined)
                return (
                  <li key={c.id} className="flex items-center gap-3 px-3 py-2.5">
                    <Avatar src={c.avatar_url} name={c.name} size="sm" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">{c.name}</span>
                      <span className="flex items-center gap-1 text-xs text-fg-subtle"><Users className="size-3" aria-hidden />{c.member_count} thành viên{c.join_policy === 'APPROVAL' ? ' · cần duyệt' : ''}</span>
                    </span>
                    {state ? (
                      <span className={cn('text-xs font-semibold', state === 'APPROVED' ? 'text-brand' : 'text-coin')}>{state === 'APPROVED' ? 'Đã vào' : 'Chờ duyệt'}</span>
                    ) : (
                      <Button size="sm" variant="secondary" loading={join.isPending && join.variables === c.id} onClick={() => join.mutate(c.id)}>Tham gia</Button>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      </div>
      <Button block size="lg" className="mt-6" variant={mine.length ? 'primary' : 'secondary'} onClick={onDone}>
        {mine.length ? 'Tiếp tục' : 'Để sau — tôi chạy một mình trước'}
      </Button>
    </>
  )
}

/* ---------------------------------------------------------------- 4. Thông báo */
function NotifyStep({ onDone }: { onDone: () => void }) {
  const push = usePush()
  const { install, sheet } = useInstallAction()
  const [busy, setBusy] = useState(false)
  const enable = async () => {
    setBusy(true)
    try {
      if (await push.enable()) { toast.success('Đã bật thông báo'); onDone() }
      else toast.error('Bạn chưa cho phép thông báo. Có thể bật lại trong Cài đặt.')
    } catch {
      toast.error('Không bật được thông báo. Thử lại trong Cài đặt.')
    } finally {
      setBusy(false)
    }
  }
  const examples = ['Chạy dài Chủ nhật bắt đầu sau 12 giờ nữa', 'Thủ quỹ đã xác nhận bạn đóng phí tháng 10', 'Bạn vừa bị vượt ở bảng xếp hạng CLB']
  return (
    <>
      <StepTitle kicker="Bước 4" title="Không bỏ lỡ buổi chạy" desc="Nhận nhắc lịch chạy nhóm, thu quỹ, thử thách — kể cả khi không mở app. Ban đêm tự im lặng." />
      <div className="flex-1 space-y-2">
        {examples.map((t, i) => (
          <div key={i} className="flex items-center gap-3 rounded-2xl border border-border bg-surface p-3" style={{ opacity: 1 - i * 0.2 }}>
            {/* eslint-disable-next-line @next/next/no-img-element -- icon tĩnh của app */}
            <img src={ICONS.any192} alt="" className="size-9 rounded-xl" />
            <span className="min-w-0 text-sm"><span className="block text-xs text-fg-subtle">RaceHub · vừa xong</span>{t}</span>
          </div>
        ))}
      </div>
      <div className="mt-6 space-y-2">
        {push.subscribed ? (
          <Button block size="lg" onClick={onDone}><CheckCircle2 className="size-5" aria-hidden />Đã bật — tiếp tục</Button>
        ) : push.support === 'ok' && push.permission !== 'denied' ? (
          <Button block size="lg" loading={busy} onClick={() => void enable()}><BellRing className="size-5" aria-hidden />Bật thông báo</Button>
        ) : push.support === 'ios-install' ? (
          <Button block size="lg" onClick={() => void install()}>Cài app lên màn hình chính</Button>
        ) : (
          <p className="rounded-xl bg-surface-2 p-3 text-center text-sm text-fg-muted">
            {push.permission === 'denied' ? 'Bạn đã chặn thông báo trên trình duyệt này. Có thể mở lại trong cài đặt trình duyệt.'
              : 'Thiết bị này chưa nhận được thông báo đẩy. Bạn vẫn xem đủ thông báo ở biểu tượng chuông.'}
          </p>
        )}
        {!push.subscribed && <Button block variant="ghost" onClick={onDone}>Để sau</Button>}
      </div>
      {sheet}
    </>
  )
}

/* ---------------------------------------------------------------- Xong */
function DoneStep() {
  const router = useRouter()
  const invalidate = useInvalidateProfile()
  const character = useCharacterState()
  const { profile } = useMyProfile()
  const finish = useMutation({
    mutationFn: (to: string) => completeOnboarding().then(() => to),
    onSuccess: (to) => { invalidate(); router.replace(to) },
    onError: () => toast.error('Có lỗi, thử lại nhé.'),
  })
  const c = character.data
  return (
    <div className="flex flex-1 flex-col items-center text-center">
      <div className="flex w-full flex-1 items-center justify-center pt-4">
        <div className="w-full max-w-[240px] overflow-hidden rounded-3xl border border-border shadow-[0_0_60px_-10px] shadow-brand/30">
          {c ? <PaperDoll gender={c.gender} items={resolveOutfit(c.items, c.equipped)} className="aspect-[2/3] w-full" />
            : <div className="grid aspect-[2/3] w-full place-items-center bg-surface-2"><Loader2 className="size-6 animate-spin text-brand" aria-label="Đang tải" /></div>}
        </div>
      </div>
      <h1 className="pt-6 text-[28px] font-extrabold leading-tight">Sẵn sàng rồi, {(profile?.display_name ?? 'runner').split(' ').slice(-1)[0]}!</h1>
      <p className="max-w-xs pt-2 text-fg-muted">Đây là nhân vật của bạn. Chạy để kiếm Xu, mở khóa áo, giày, mũ… trong Tủ đồ.</p>
      <div className="mt-6 w-full space-y-2">
        <Button block size="lg" loading={finish.isPending && finish.variables === routes.home} disabled={finish.isPending}
          onClick={() => finish.mutate(routes.home)}>Vào RaceHub<ChevronRight className="size-5" aria-hidden /></Button>
        <Button block variant="ghost" loading={finish.isPending && finish.variables === routes.me} disabled={finish.isPending}
          onClick={() => finish.mutate(routes.me)}>Xem Tủ đồ</Button>
      </div>
    </div>
  )
}
