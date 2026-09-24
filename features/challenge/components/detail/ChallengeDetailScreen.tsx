'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import {
  ArrowLeft, CalendarDays, Check, CircleSlash, Clock, Coins, Copy, Crown, Gauge, Hourglass, Info, Lock, LogOut, MoreHorizontal,
  Route, Share2, Shield, Timer, Trophy, Users, UsersRound,
} from 'lucide-react'
import { toast } from 'sonner'
import { Avatar, Button, Card, ConfirmSheet, EmptyState, ErrorState, LevelBadge, ProgressRing, SegmentedControl, Sheet, Skeleton } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { formatNumber, formatPace } from '@/shared/lib/format'
import { challengeErrorMessage, type ChallengeDetail, type LeaderboardEntry, type TeamStanding } from '../../api/challengeApi'
import {
  AUDIENCE_LABEL, challengePhase, FORMAT_META, formatScore, OBJECTIVE_META, planStatus, rewardSummary, TEAM_MODE_META, timeLabel,
  type TeamMode,
} from '../../model/challenge'
import { useChallenge, useChallengeActions } from '../../hooks/useChallenge'
import { FORMAT_ICON, FORMAT_TONE } from '../list/ChallengeCard'
import { PledgePanel } from './PledgePanel'

const fmtDateTime = (iso: string) => new Date(iso).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })

export function ChallengeDetailScreen({ id, code }: { id: string; code?: string | null }) {
  const { detail, leaderboard, teams } = useChallenge(id, code)
  const [tab, setTab] = useState<'RANK' | 'RULES'>('RANK')

  if (detail.isLoading) return <DetailSkeleton />
  if (detail.isError || !detail.data) {
    const msg = challengeErrorMessage(detail.error)
    return (
      <div className="space-y-4">
        <BackLink />
        {msg.includes('mã mời')
          ? <EmptyState icon={Lock} title="Thử thách riêng tư" description="Bạn cần link mời (có mã) từ người tạo để xem và tham gia." />
          : <ErrorState message={msg} onRetry={() => detail.refetch()} />}
      </div>
    )
  }

  const d = detail.data
  const c = d.challenge
  const phase = challengePhase(c)
  const Icon = FORMAT_ICON[c.format] ?? Trophy
  const standings = teams.data ?? d.teams ?? []

  return (
    <div className="space-y-4 pb-28 animate-fade-in">
      <BackLink />

      {/* Đầu trang */}
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2 text-xs font-semibold">
          <span className={cn('flex items-center gap-1.5 rounded-full px-2.5 py-1', FORMAT_TONE[c.format])}>
            <Icon className="size-3.5" aria-hidden />{c.format === 'TEAM' && c.pledge_enabled ? 'Đua đội theo mục tiêu' : FORMAT_META[c.format]?.label}
          </span>
          <span className="flex items-center gap-1 rounded-full bg-surface-2 px-2.5 py-1 text-fg-muted">
            {c.target_audience === 'INVITE_ONLY' ? <Lock className="size-3.5" aria-hidden /> : c.target_audience === 'CLUB_ONLY' ? <Shield className="size-3.5" aria-hidden /> : <Users className="size-3.5" aria-hidden />}
            {c.target_audience === 'CLUB_ONLY' && d.club ? d.club.name : AUDIENCE_LABEL[c.target_audience]}
          </span>
          <span className={cn('ml-auto rounded-full px-2.5 py-1 font-bold',
            phase === 'LIVE' ? 'bg-brand text-brand-fg' : phase === 'UPCOMING' ? 'bg-warning/15 text-warning' : 'bg-surface-2 text-fg-subtle')}>
            {timeLabel(c)}
          </span>
        </div>
        <h1 className="text-2xl font-bold leading-tight">{c.title}</h1>
        {d.creator && (
          <p className="flex items-center gap-2 text-sm text-fg-muted">
            <Avatar src={d.creator.avatar_url} name={d.creator.display_name} size="xs" />
            Tạo bởi <span className="font-medium text-fg">{d.creator.display_name ?? 'Runner'}</span>
          </p>
        )}
        {c.description && <p className="whitespace-pre-line text-[15px] leading-relaxed text-fg-muted">{c.description}</p>}
      </header>

      <StatusBanner d={d} phase={phase} />
      <ProgressHero d={d} phase={phase} standings={standings} />

      <div className="grid grid-cols-3 gap-2">
        <MiniStat icon={Users} label="Tham gia" value={`${formatNumber(d.stats.participants)}${c.format !== 'COLLECTIVE' && c.format !== 'SOLO_GOAL' ? `/${formatNumber(c.max_slots)}` : ''}`} />
        <MiniStat icon={Check} label="Hoàn thành" value={formatNumber(d.stats.completed)} />
        <MiniStat icon={Coins} label="Thưởng" value={c.reward_xu > 0 ? `${formatNumber(c.reward_xu)} Xu` : '—'} tone={c.reward_xu > 0 ? 'text-coin' : undefined} />
      </div>

      <SegmentedControl value={tab} onChange={setTab} options={[{ value: 'RANK', label: 'Bảng xếp hạng' }, { value: 'RULES', label: 'Luật chơi' }]} />
      {tab === 'RANK'
        ? c.pledge_enabled
          ? <PledgePanel d={d} />
          : <Leaderboard d={d} rows={leaderboard.data} loading={leaderboard.isLoading} error={leaderboard.isError} standings={standings} />
        : <Rules d={d} />}

      <ActionBar d={d} phase={phase} code={code ?? null} />
    </div>
  )
}

function BackLink() {
  return (
    <Link href="/challenges" className="-ml-2 inline-flex min-h-11 items-center gap-1 rounded-xl px-2 text-sm font-medium text-fg-muted hover:text-fg">
      <ArrowLeft className="size-4" aria-hidden />Thử thách
    </Link>
  )
}

function StatusBanner({ d, phase }: { d: ChallengeDetail; phase: ReturnType<typeof challengePhase> }) {
  const c = d.challenge
  if (phase === 'CANCELLED') {
    return <Banner icon={CircleSlash} tone="danger" title="Thử thách đã bị hủy" text={c.cancelled_reason ?? 'Tiền treo thưởng (nếu có) đã được hoàn lại.'} />
  }
  if (phase === 'SETTLING') {
    return <Banner icon={Hourglass} tone="warning" title="Đang tổng kết"
      text="Hệ thống chờ tối đa 2 giờ để nhận các bài chạy đồng bộ muộn, sau đó tự xếp hạng và trao thưởng." />
  }
  if (phase === 'ENDED' && d.me) {
    const win = d.me.final_rank === 1
    return <Banner icon={win ? Crown : Trophy} tone={win ? 'coin' : 'brand'}
      title={win ? 'Bạn về nhất!' : d.me.completed_at ? 'Bạn đã hoàn thành' : `Bạn xếp hạng ${d.me.final_rank ?? '—'}`}
      text={d.me.reward_xu > 0 ? `Đã nhận ${formatNumber(d.me.reward_xu)} Xu vào ví.` : 'Cảm ơn bạn đã tham gia!'} />
  }
  if (phase === 'UPCOMING') {
    return <Banner icon={Clock} tone="warning" title={`Bắt đầu lúc ${fmtDateTime(c.start_date)}`}
      text={c.format === 'TEAM' && c.pledge_enabled ? 'Đăng ký mục tiêu km trước giờ bắt đầu. Ban quản trị sẽ chia đội sao cho tổng mục tiêu các đội bằng nhau.'
        : c.format === 'TEAM' ? 'Chọn đội trước giờ bắt đầu — sau đó danh sách đội sẽ được khóa.' : 'Bài chạy chỉ được tính từ giờ bắt đầu.'} />
  }
  return null
}

function Banner({ icon: Icon, tone, title, text }: { icon: typeof Clock; tone: 'danger' | 'warning' | 'coin' | 'brand'; title: string; text: string }) {
  const cls = { danger: 'border-danger/30 bg-danger/5 text-danger', warning: 'border-warning/30 bg-warning/5 text-warning',
    coin: 'border-coin/40 bg-coin/10 text-coin', brand: 'border-brand/30 bg-brand/5 text-brand' }[tone]
  return (
    <div role="status" className={cn('flex gap-3 rounded-[var(--radius-card)] border p-3', cls)}>
      <Icon className="mt-0.5 size-5 shrink-0" aria-hidden />
      <div><p className="font-semibold">{title}</p><p className="text-sm text-fg-muted">{text}</p></div>
    </div>
  )
}

function ProgressHero({ d, phase, standings }: { d: ChallengeDetail; phase: ReturnType<typeof challengePhase>; standings: TeamStanding[] }) {
  const c = d.challenge
  // Mục tiêu tự đăng ký: mục tiêu là mốc của chính người xem
  const target = c.pledge_enabled ? Number(d.me?.pledge_km ?? 0) : c.target_value
  const unit = OBJECTIVE_META[c.objective]?.unit

  // Đua đội theo mục tiêu: trước khi chia đội chỉ có đội tạm → chưa hiện bảng đối đầu
  if (c.format === 'TEAM') return c.pledge_enabled && !c.teams_assigned_at ? null : <TeamVersus d={d} standings={standings} />

  if (c.format === 'COLLECTIVE') {
    const total = d.stats.total_score
    return (
      <Card className="flex items-center gap-4">
        <ProgressRing value={target > 0 ? total / target : 0} size={112} label="Tiến độ cả cộng đồng" color="var(--color-success)">
          <span><span className="block font-mono text-xl font-bold">{Math.round(target > 0 ? (total / target) * 100 : 0)}%</span>
            <span className="text-xs text-fg-subtle">cộng đồng</span></span>
        </ProgressRing>
        <div className="min-w-0 space-y-1">
          <p className="text-sm text-fg-muted">Cả cộng đồng đã góp</p>
          <p className="font-mono text-2xl font-bold tabular">{formatScore(c.objective, total, false)}<span className="ml-1 text-sm text-fg-muted">/ {formatScore(c.objective, target)}</span></p>
          {d.me && <p className="text-sm">Bạn góp <span className="font-mono font-bold text-brand">{formatScore(c.objective, d.me.current_progress)}</span></p>}
        </div>
      </Card>
    )
  }

  if (!d.me) return null
  const score = d.me.current_progress
  if (c.pledge_enabled && !target) return null        // chưa chọn mục tiêu → thẻ chọn mục tiêu ở dưới
  const plan = phase === 'LIVE' ? planStatus({ ...c, target_value: target }, score) : null
  return (
    <Card className="flex items-center gap-4">
      <ProgressRing value={target > 0 ? score / target : 0} size={112} label="Tiến độ của bạn" color={d.me.completed_at ? 'var(--color-coin)' : undefined}>
        <span>
          <span className="block font-mono text-2xl font-bold leading-none">{formatScore(c.objective, score, false)}</span>
          <span className="text-xs text-fg-subtle">{target > 0 ? `/ ${formatScore(c.objective, target, false)} ${unit}` : unit}</span>
        </span>
      </ProgressRing>
      <div className="min-w-0 space-y-1.5">
        <p className="text-sm text-fg-muted">Tiến độ của bạn</p>
        {d.me.completed_at ? (
          <p className="flex items-center gap-1.5 font-semibold text-coin"><Crown className="size-4" aria-hidden />Đã đạt mục tiêu!</p>
        ) : plan ? (
          <p className={cn('text-sm font-semibold', plan.diff >= 0 ? 'text-brand' : 'text-warning')}>
            {plan.diff >= 0 ? `Vượt kế hoạch ${formatScore(c.objective, plan.diff)}` : `Chậm hơn kế hoạch ${formatScore(c.objective, -plan.diff)} — tăng tốc nào!`}
          </p>
        ) : target > 0 ? (
          <p className="text-sm">Còn <span className="font-mono font-bold">{formatScore(c.objective, Math.max(target - score, 0))}</span></p>
        ) : null}
        {c.format !== 'SOLO_GOAL' && d.me.final_rank && <p className="text-sm text-fg-muted">Hạng cuối: <span className="font-mono font-bold text-fg">#{d.me.final_rank}</span></p>}
      </div>
    </Card>
  )
}

function TeamVersus({ d, standings }: { d: ChallengeDetail; standings: TeamStanding[] }) {
  const c = d.challenge
  const max = Math.max(...standings.map((t) => t.score), 0.0001)
  const mode = TEAM_MODE_META[(c.game_mode ?? 'TEAM_SUM') as TeamMode]
  return (
    <Card className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="flex items-center gap-2 font-semibold"><UsersRound className="size-4 text-xp" aria-hidden />Đối đầu đồng đội</p>
        <span className="rounded-full bg-xp/15 px-2 py-0.5 text-xs font-semibold text-xp">{mode?.label}</span>
      </div>
      <ul className="space-y-2.5">
        {standings.map((t, i) => {
          const mine = d.me?.team_id === t.team_id
          return (
            <li key={t.team_id} className={cn('rounded-xl border p-3', mine ? 'border-brand/50 bg-brand/5' : 'border-border bg-bg/40')}>
              <div className="flex items-center gap-2">
                <span className="font-mono text-sm font-bold text-fg-muted">{i + 1}</span>
                <span className="size-3 rounded-full" style={{ background: t.color }} aria-hidden />
                <span className="flex-1 truncate font-semibold">{t.name}{mine && <span className="ml-1.5 text-xs font-medium text-brand">(đội bạn)</span>}</span>
                <span className="font-mono tabular font-bold">{formatScore(c.objective, t.score)}</span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-2">
                <div className="h-full rounded-full transition-[width] duration-700" style={{ width: `${(t.score / max) * 100}%`, background: t.color }} />
              </div>
              <p className="mt-1.5 text-xs text-fg-subtle">{t.members} thành viên{c.fixed_team_size > 0 ? `/${c.fixed_team_size}` : ''} · {t.active_members} người đã chạy</p>
            </li>
          )
        })}
      </ul>
      <p className="text-xs text-fg-subtle">{mode?.description}</p>
    </Card>
  )
}

function MiniStat({ icon: Icon, label, value, tone }: { icon: typeof Users; label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface px-3 py-2.5">
      <p className="flex items-center gap-1 text-xs text-fg-subtle"><Icon className="size-3.5" aria-hidden />{label}</p>
      <p className={cn('truncate font-mono tabular text-lg font-bold', tone)}>{value}</p>
    </div>
  )
}

function Leaderboard({ d, rows, loading, error, standings }: {
  d: ChallengeDetail; rows?: LeaderboardEntry[]; loading: boolean; error: boolean; standings: TeamStanding[]
}) {
  const [team, setTeam] = useState<string | 'ALL'>('ALL')
  const c = d.challenge
  if (loading) return <div className="space-y-2">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-14" />)}</div>
  if (error) return <ErrorState message="Không tải được bảng xếp hạng." />
  const list = (rows ?? []).filter((r) => team === 'ALL' || r.team_id === team)
  const teamOf = new Map(standings.map((t) => [t.team_id, t]))
  return (
    <div className="space-y-2">
      {c.format === 'TEAM' && standings.length > 0 && (!c.pledge_enabled || !!c.teams_assigned_at) && (
        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
          {[{ team_id: 'ALL', name: 'Tất cả', color: 'var(--color-fg-muted)' }, ...standings].map((t) => (
            <button key={t.team_id} onClick={() => setTeam(t.team_id)} aria-pressed={team === t.team_id}
              className={cn('flex min-h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 text-sm font-medium',
                team === t.team_id ? 'border-fg bg-surface-2' : 'border-border text-fg-muted')}>
              <span className="size-2.5 rounded-full" style={{ background: t.color }} aria-hidden />{t.name}
            </button>
          ))}
        </div>
      )}
      {list.length === 0 ? (
        <EmptyState icon={Trophy} title="Chưa có ai trên bảng" description="Hãy tham gia và chạy bài đầu tiên để lên bảng xếp hạng." />
      ) : (
        <ol className="space-y-1.5">
          {list.map((r) => {
            const me = r.participant_id === d.me?.id
            const t = r.team_id ? teamOf.get(r.team_id) : undefined
            return (
              <li key={r.participant_id} className={cn('flex items-center gap-3 rounded-xl border px-3 py-2.5',
                me ? 'border-brand/50 bg-brand/10' : 'border-border bg-surface')}>
                <span className={cn('w-7 text-center font-mono text-sm font-bold',
                  r.rank === 1 ? 'text-medal-gold' : r.rank === 2 ? 'text-medal-silver' : r.rank === 3 ? 'text-medal-bronze' : 'text-fg-muted')}>{r.rank}</span>
                <Avatar src={r.avatar_url} name={r.display_name} size="sm" ring={t?.color} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-semibold">{me ? 'Bạn' : r.display_name}</span>
                    <LevelBadge level={r.level} />
                    {r.completed_at && <Check className="size-4 shrink-0 text-coin" aria-label="Đã hoàn thành" />}
                  </span>
                  <span className="text-xs text-fg-subtle">{r.run_count} buổi{t ? ` · ${t.name}` : ''}{r.reward_xu > 0 ? ` · +${formatNumber(r.reward_xu)} Xu` : ''}</span>
                </span>
                <span className="font-mono tabular font-bold">{formatScore(c.objective, r.score)}</span>
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}

function Rules({ d }: { d: ChallengeDetail }) {
  const c = d.challenge
  const reward = rewardSummary(c)
  const rows: { icon: typeof Route; label: string; value: string }[] = [
    { icon: Trophy, label: 'Tính điểm theo', value: `${OBJECTIVE_META[c.objective]?.label} — ${OBJECTIVE_META[c.objective]?.hint.toLowerCase()}` },
    ...(c.target_value > 0 ? [{ icon: Crown, label: 'Mục tiêu', value: formatScore(c.objective, c.target_value) }] : []),
    { icon: Route, label: c.objective === 'STREAK_DAYS' ? 'Tối thiểu mỗi ngày' : 'Tối thiểu mỗi bài', value: `${formatNumber(c.min_km)} km` },
    { icon: Gauge, label: 'Pace hợp lệ', value: `${formatPace(c.min_pace * 60)} – ${formatPace(c.max_pace * 60)} /km` },
    ...(c.daily_cap_km ? [{ icon: Timer, label: 'Trần mỗi người mỗi ngày', value: `${formatNumber(c.daily_cap_km)} km` }] : []),
    { icon: CalendarDays, label: 'Thời gian', value: `${fmtDateTime(c.start_date)} → ${fmtDateTime(c.end_date)}` },
    ...(c.format === 'TEAM' ? [{ icon: UsersRound, label: 'Cách tính đội', value: TEAM_MODE_META[(c.game_mode ?? 'TEAM_SUM') as TeamMode]?.description ?? '' }] : []),
    ...(reward ? [{ icon: Coins, label: 'Phần thưởng', value: reward }] : []),
  ]
  return (
    <Card className="space-y-3">
      <ul className="space-y-3">
        {rows.map((r) => (
          <li key={r.label} className="flex gap-3">
            <r.icon className="mt-0.5 size-4 shrink-0 text-fg-subtle" aria-hidden />
            <span className="text-sm"><span className="block text-fg-subtle">{r.label}</span><span className="font-medium">{r.value}</span></span>
          </li>
        ))}
      </ul>
      <p className="flex gap-2 border-t border-border pt-3 text-xs text-fg-muted">
        <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        Chỉ tính bài chạy hợp lệ (GPS trong app hoặc đồng bộ Strava) có giờ bắt đầu nằm trong thời gian thử thách. Bài bị xóa hoặc bị gắn cờ gian lận sẽ bị trừ lại. Kết quả chốt 2 giờ sau khi kết thúc.
      </p>
    </Card>
  )
}

function ActionBar({ d, phase, code }: { d: ChallengeDetail; phase: ReturnType<typeof challengePhase>; code: string | null }) {
  const router = useRouter()
  const c = d.challenge
  const a = useChallengeActions(c.id)
  const [sheet, setSheet] = useState<'team' | 'invite' | 'menu' | 'leave' | 'cancel' | null>(null)
  const joined = !!d.me && d.me.status !== 'LEFT'
  const open = phase === 'UPCOMING' || phase === 'LIVE'
  const teamLocked = c.format === 'TEAM' && phase !== 'UPCOMING'
  const pickTeam = c.format === 'TEAM' && !c.pledge_enabled       // đua đội theo mục tiêu: ban quản trị chia đội, không tự chọn
  const canJoin = open && !joined && !teamLocked
  const canLeave = joined && open && (phase === 'UPCOMING' || (c.format !== 'TEAM' && c.format !== 'DUEL'))
  const canCancel = d.can_manage && open && (phase === 'UPCOMING' || d.stats.participants <= 1)
  const inviteCode = d.invite_code ?? code

  const run = (p: Promise<unknown>, ok: string, after?: () => void) =>
    p.then(() => { toast.success(ok); setSheet(null); after?.() }).catch((e) => toast.error(challengeErrorMessage(e)))

  if (!open && !d.can_manage) return null
  return (
    <>
      <div className="fixed inset-x-0 bottom-[calc(3.5rem+1px+env(safe-area-inset-bottom))] z-30 mx-auto flex max-w-md gap-2 border-t border-border bg-bg/95 px-4 py-3 backdrop-blur-md">
        {canJoin ? (
          <Button block size="lg" loading={a.join.isPending}
            onClick={() => pickTeam ? setSheet('team') : run(a.join.mutateAsync({ code }), c.format === 'DUEL' ? 'Đã nhận lời thách đấu!' : c.pledge_enabled ? 'Đã tham gia. Hãy đăng ký mục tiêu của bạn!' : 'Đã tham gia. Chạy thôi!')}>
            {pickTeam ? 'Chọn đội và tham gia' : c.format === 'TEAM' ? 'Tham gia và đăng ký mục tiêu' : c.format === 'DUEL' ? 'Nhận lời thách đấu' : 'Tham gia'}
          </Button>
        ) : joined && open ? (
          <Button block size="lg" variant="secondary" onClick={() => setSheet('invite')}><Share2 className="size-4" aria-hidden />Mời bạn cùng tham gia</Button>
        ) : (
          <p className="flex flex-1 items-center text-sm text-fg-muted">{teamLocked && !joined ? 'Danh sách đội đã khóa.' : ''}</p>
        )}
        {(canLeave || canCancel || (joined && pickTeam && phase === 'UPCOMING') || (!joined && inviteCode)) && (
          <Button variant="secondary" size="lg" aria-label="Tùy chọn khác" className="w-13 shrink-0 px-0" onClick={() => setSheet('menu')}>
            <MoreHorizontal className="size-5" aria-hidden />
          </Button>
        )}
      </div>

      <Sheet open={sheet === 'menu'} onClose={() => setSheet(null)} title="Tùy chọn">
        <div className="space-y-1">
          {inviteCode && <MenuButton icon={Share2} label="Mời bạn (link có mã)" onClick={() => setSheet('invite')} />}
          {joined && pickTeam && phase === 'UPCOMING' && <MenuButton icon={UsersRound} label="Đổi đội" onClick={() => setSheet('team')} />}
          {canLeave && <MenuButton icon={LogOut} label="Rời thử thách" danger onClick={() => setSheet('leave')} />}
          {canCancel && <MenuButton icon={CircleSlash} label="Hủy thử thách" danger onClick={() => setSheet('cancel')} />}
        </div>
      </Sheet>

      <Sheet open={sheet === 'team'} onClose={() => setSheet(null)} title={joined ? 'Đổi đội' : 'Chọn đội'}
        description="Danh sách đội sẽ khóa khi thử thách bắt đầu.">
        <ul className="space-y-2">
          {(d.teams ?? []).map((t) => {
            const full = c.fixed_team_size > 0 && t.members >= c.fixed_team_size && d.me?.team_id !== t.team_id
            const current = d.me?.team_id === t.team_id
            return (
              <li key={t.team_id}>
                <button disabled={full || current || a.join.isPending || a.changeTeam.isPending}
                  onClick={() => joined
                    ? run(a.changeTeam.mutateAsync(t.team_id), `Đã chuyển sang ${t.name}`)
                    : run(a.join.mutateAsync({ code, teamId: t.team_id }), `Đã vào ${t.name}. Cùng đồng đội chạy nào!`)}
                  className={cn('flex min-h-14 w-full items-center gap-3 rounded-xl border px-4 text-left disabled:opacity-60',
                    current ? 'border-brand/60 bg-brand/10' : 'border-border hover:border-fg-subtle')}>
                  <span className="size-4 rounded-full" style={{ background: t.color }} aria-hidden />
                  <span className="flex-1 font-semibold">{t.name}</span>
                  <span className="text-sm text-fg-muted">{current ? 'Đội của bạn' : full ? 'Đã đủ' : `${t.members}${c.fixed_team_size > 0 ? `/${c.fixed_team_size}` : ''} người`}</span>
                </button>
              </li>
            )
          })}
        </ul>
      </Sheet>

      {inviteCode !== undefined && <InviteSheet open={sheet === 'invite'} onClose={() => setSheet(null)} id={c.id} code={inviteCode} title={c.title} />}

      <ConfirmSheet open={sheet === 'leave'} onClose={() => setSheet(null)} loading={a.leave.isPending} confirmLabel="Rời thử thách"
        title="Rời thử thách này?"
        description={phase === 'UPCOMING' ? 'Bạn có thể tham gia lại trước khi thử thách bắt đầu.' : 'Kết quả của bạn sẽ không được xếp hạng nữa.'}
        onConfirm={() => run(a.leave.mutateAsync(), 'Đã rời thử thách')} />
      <ConfirmSheet open={sheet === 'cancel'} onClose={() => setSheet(null)} loading={a.cancel.isPending} confirmLabel="Hủy thử thách"
        title="Hủy thử thách?" description="Mọi người tham gia sẽ nhận thông báo. Tiền treo thưởng được hoàn lại cho nguồn đã treo."
        onConfirm={() => run(a.cancel.mutateAsync(undefined), 'Đã hủy thử thách', () => router.refresh())} />
    </>
  )
}

function MenuButton({ icon: Icon, label, onClick, danger }: { icon: typeof Share2; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button onClick={onClick} className={cn('flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left text-[15px] font-medium hover:bg-surface-2', danger && 'text-danger')}>
      <Icon className="size-5" aria-hidden />{label}
    </button>
  )
}

function InviteSheet({ open, onClose, id, code, title }: { open: boolean; onClose: () => void; id: string; code: string | null; title: string }) {
  const link = typeof window === 'undefined' ? '' : `${window.location.origin}/challenges/${id}${code ? `?code=${code}` : ''}`
  const copy = async () => {
    try { await navigator.clipboard.writeText(link); toast.success('Đã sao chép link mời') } catch { toast.error('Không sao chép được, hãy chọn và sao chép thủ công.') }
  }
  const share = async () => {
    if (navigator.share) {
      try { await navigator.share({ title: `Thử thách: ${title}`, text: `Tham gia thử thách "${title}" cùng mình trên RaceHub!`, url: link }) } catch { /* người dùng hủy */ }
    } else void copy()
  }
  return (
    <Sheet open={open} onClose={onClose} title="Mời bạn cùng tham gia" description="Gửi link vào nhóm Zalo, Messenger hoặc CLB.">
      <div className="space-y-3">
        <p className="break-all rounded-xl border border-border bg-bg p-3 font-mono text-sm">{link}</p>
        <div className="grid grid-cols-2 gap-2">
          <Button variant="secondary" onClick={copy}><Copy className="size-4" aria-hidden />Sao chép</Button>
          <Button onClick={share}><Share2 className="size-4" aria-hidden />Chia sẻ</Button>
        </div>
        {code && <p className="text-center text-sm text-fg-muted">Mã mời: <span className="font-mono font-bold tracking-widest text-fg">{code}</span></p>}
      </div>
    </Sheet>
  )
}

function DetailSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-6 w-24" /><Skeleton className="h-8 w-3/4" /><Skeleton className="h-36" />
      <div className="grid grid-cols-3 gap-2"><Skeleton className="h-16" /><Skeleton className="h-16" /><Skeleton className="h-16" /></div>
      <Skeleton className="h-48" />
    </div>
  )
}
