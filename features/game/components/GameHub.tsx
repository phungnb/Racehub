'use client'

import { useState } from 'react'
import { CalendarCheck, Check, ChevronRight, ChevronUp, Flame, Gift, ShieldCheck, Trophy } from 'lucide-react'
import { Avatar, Card, ErrorState, LevelBadge, ProgressBar, ProgressRing, Skeleton } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { formatCoin, formatNumber } from '@/shared/lib/format'
import { levelProgress } from '@/features/progression'
import { shineTier } from '@/shared/lib/shine'
import type { Profile } from '@/shared/types/profile'
import { gameErrorMessage } from '../api/gameApi'
import { FormChip } from './FormChip'
import { useGameState, useMarkSeen, useMyQuests } from '../hooks/useGame'
import { leagueTier, timeLeft, type GameState } from '../model/game'
import { LeagueSheet } from './LeagueSheet'
import { QuestList } from './QuestList'
import { RewardCascade } from './RewardCascade'
import { StreakSheet } from './StreakSheet'

/** Trang chủ = trung tâm game: mở app thấy ngay "hôm nay cần làm gì" */
export function GameHub({ profile }: { profile: Profile }) {
  const q = useGameState(profile.id)
  if (q.isPending) return <div className="space-y-3"><Skeleton className="h-56" /><Skeleton className="h-48" /><Skeleton className="h-24" /></div>
  if (q.isError) return <ErrorState message={gameErrorMessage(q.error)} error={q.error} onRetry={() => void q.refetch()} />
  return <Hub profile={profile} s={q.data} />
}

function Hub({ profile, s }: { profile: Profile; s: GameState }) {
  // ?goal=1 (từ bài Knowledge "Đặt mục tiêu tuần") → mở ngay sheet chuỗi ngày & mục tiêu
  const [streakOpen, setStreakOpen] = useState(() => typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('goal'))
  const [leagueOpen, setLeagueOpen] = useState(false)
  const [showWeekly, setShowWeekly] = useState(false)
  const mq = useMyQuests()
  const quests = mq.data ?? s.quests
  // Sự kiện + cột mốc một lần (người mới) hiện nổi bật ở đầu
  const events = quests.filter((x) => x.period === 'EVENT' || x.period === 'ONCE')
  const daily = quests.filter((x) => x.period === 'DAILY')
  const weekly = quests.filter((x) => x.period === 'WEEKLY' || x.period === 'MONTHLY')
  const dailyDone = daily.filter((x) => x.completed).length
  const weeklyDone = weekly.filter((x) => x.completed).length

  return (
    <div className="space-y-3">
      <UnseenRewards key={s.unseen.filter((e) => e.kind === 'RUN').map((e) => e.id).join()} events={s.unseen} />
      <TodayCard profile={profile} s={s} onStreak={() => setStreakOpen(true)} />

      {events.length > 0 && (
        <Card className="space-y-1 border-coin/40 bg-gradient-to-br from-coin/10 to-surface">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">{events.every((x) => x.period === 'ONCE') ? 'Cột mốc của bạn' : 'Sự kiện & cột mốc'}</h2>
            <span className="font-mono text-xs text-fg-muted">{events.filter((x) => x.completed).length}/{events.length}</span>
          </div>
          <QuestList quests={events} />
        </Card>
      )}

      <Card className="space-y-1">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Nhiệm vụ hôm nay</h2>
          <span className="font-mono text-xs text-fg-muted">{dailyDone}/{daily.length}</span>
        </div>
        <QuestList quests={daily} />
        <button onClick={() => setShowWeekly((v) => !v)} aria-expanded={showWeekly}
          className="-mx-1 mt-1 flex min-h-11 w-[calc(100%+0.5rem)] items-center justify-between rounded-xl px-1 text-sm font-semibold text-fg-muted hover:text-fg">
          <span>Nhiệm vụ tuần & tháng <span className="font-mono text-xs">· {weeklyDone}/{weekly.length}</span></span>
          <ChevronRight className={cn('size-4 transition-transform', showWeekly && 'rotate-90')} aria-hidden />
        </button>
        {showWeekly && <QuestList quests={weekly} />}
      </Card>

      <LeagueCard s={s} onOpen={() => setLeagueOpen(true)} />

      <StreakSheet open={streakOpen} onClose={() => setStreakOpen(false)} streak={s.streak} balance={Number(profile.xu ?? 0)} />
      {s.league.group_id && <LeagueSheet open={leagueOpen} onClose={() => setLeagueOpen(false)} league={s.league} />}
    </div>
  )
}

function TodayCard({ profile, s, onStreak }: { profile: Profile; s: GameState; onStreak: () => void }) {
  const lv = levelProgress(profile.xp, profile.level)
  const st = s.streak
  const left = Math.max(0, st.goal - st.week_days)
  const status = st.done_this_week ? 'Tuần này đã đạt mục tiêu'
    : st.alive || st.current === 0 ? `Chạy thêm ${left} ngày để ${st.current > 0 ? 'giữ' : 'bắt đầu'} chuỗi`
    : 'Chuỗi đã đứt — bắt đầu lại tuần này'

  return (
    <Card className="space-y-4 overflow-hidden bg-gradient-to-br from-brand/10 via-surface to-surface">
      <div className="flex items-center gap-3">
        <Avatar src={profile.avatar_url} name={profile.display_name} size="md" shine={shineTier(Number(profile.shine_total ?? 0))} />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2"><span className="truncate font-bold">{profile.display_name || 'Runner'}</span><LevelBadge level={lv.current.level} /></p>
          <FormChip showHint className="mt-1" />
          <div className="mt-1 flex items-center gap-2">
            <ProgressBar value={lv.value} max={lv.span} tone="xp" className="h-1.5" />
            <span className="shrink-0 font-mono text-xs text-fg-subtle">{lv.next ? `${formatNumber(lv.remaining)} XP` : 'Tối đa'}</span>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-4">
        <ProgressRing value={st.goal ? st.week_days / st.goal : 0} size={112} stroke={10} label="Số ngày chạy tuần này so với mục tiêu"
          color={st.done_this_week ? 'var(--color-brand)' : 'var(--color-live)'}>
          <span>
            <span className="block font-mono text-2xl font-bold leading-none">{st.week_days}<span className="text-base text-fg-muted">/{st.goal}</span></span>
            <span className="text-xs text-fg-muted">ngày tuần này</span>
          </span>
        </ProgressRing>
        <div className="min-w-0 flex-1 space-y-2">
          <button onClick={onStreak} className="flex w-full items-center gap-2 rounded-xl text-left" aria-label="Chuỗi tuần và khiên">
            <Flame className={cn('size-7 shrink-0', st.current > 0 ? 'text-live' : 'text-fg-subtle')} aria-hidden />
            <span className="min-w-0">
              <span className="block font-mono text-xl font-bold leading-tight">{st.current} tuần</span>
              <span className="block text-xs text-fg-muted">chuỗi · {st.daily} ngày liên tiếp</span>
            </span>
            <span className="ml-auto flex gap-0.5" aria-label={`${st.shields} khiên`}>
              {Array.from({ length: st.max_shields }, (_, i) => (
                <ShieldCheck key={i} className={cn('size-4', i < st.shields ? 'text-xp' : 'text-border')} aria-hidden />
              ))}
            </span>
          </button>
          <p className={cn('text-xs', st.done_this_week ? 'text-brand' : 'text-fg-muted')}>{status}</p>
          <p className="font-mono text-xs text-fg-subtle">{s.week.km.toLocaleString('vi-VN', { maximumFractionDigits: 1 })} km · {s.week.runs} bài tuần này</p>
        </div>
      </div>

      {s.checked_in ? (
        <p className="flex h-11 items-center justify-center gap-2 rounded-xl bg-surface-2 text-sm font-semibold text-fg-muted">
          <Check className="size-4 text-brand" aria-hidden />Đã điểm danh hôm nay bằng bài chạy
        </p>
      ) : (
        <p className="flex min-h-11 items-center justify-center gap-2 rounded-xl border border-dashed border-border px-3 text-center text-sm text-fg-muted">
          <CalendarCheck className="size-4 shrink-0 text-brand" aria-hidden />Chạy từ 1 km hôm nay để tự điểm danh, nhận thêm Xu
        </p>
      )}
    </Card>
  )
}

function LeagueCard({ s, onOpen }: { s: GameState; onOpen: () => void }) {
  const l = s.league
  const t = leagueTier(l.tier)
  if (!l.group_id) {
    return (
      <Card className="flex items-center gap-3">
        <span className={cn('grid size-11 shrink-0 place-items-center rounded-xl', t.bg, t.text)}><Trophy className="size-5" aria-hidden /></span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold">League {t.name}</p>
          <p className="text-sm text-fg-muted">Chạy bài đầu tiên của tuần để vào nhóm 30 người và tranh suất lên hạng.</p>
        </div>
      </Card>
    )
  }
  const zone = l.rank && l.promote && l.rank <= l.promote && (l.points ?? 0) > 0 ? 'UP'
    : l.rank && l.size && l.demote && l.rank > l.size - l.demote ? 'DOWN' : 'STAY'
  return (
    <button onClick={onOpen} className="w-full text-left">
      <Card className="flex items-center gap-3 transition-colors hover:border-fg-subtle">
        <span className={cn('grid size-11 shrink-0 place-items-center rounded-xl', t.bg, t.text)}><Trophy className="size-5" aria-hidden /></span>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 font-semibold">League {t.name}
            {zone === 'UP' && <span className="flex items-center rounded-full bg-success/15 px-2 py-0.5 text-xs text-success"><ChevronUp className="size-3" aria-hidden />Lên hạng</span>}
            {zone === 'DOWN' && <span className="rounded-full bg-danger/15 px-2 py-0.5 text-xs text-danger">Nguy hiểm</span>}
          </p>
          <p className="text-sm text-fg-muted">
            Hạng <b className="font-mono text-fg">{l.rank}</b>/{l.size} · {(l.points ?? 0).toLocaleString('vi-VN', { maximumFractionDigits: 1 })} km
            {l.ends_at && <> · còn {timeLeft(l.ends_at)}</>}
          </p>
        </div>
        <ChevronRight className="size-5 text-fg-subtle" aria-hidden />
      </Card>
    </button>
  )
}

/** Phần thưởng chưa xem (vd. bài chạy Strava vừa về, kết quả league tuần): mở chuỗi phần thưởng */
function UnseenRewards({ events }: { events: GameState['unseen'] }) {
  // Bài chạy mới về (mở từ thông báo "Bài chạy đã về", hoặc mở app lần đầu sau khi bài về) → tự bật màn nhận thưởng
  const [open, setOpen] = useState(() => shouldAutoOpenRewards(events))
  const markSeen = useMarkSeen()
  if (!events.length) return null
  const close = () => {
    setOpen(false)
    markSeen.mutate(events.map((e) => e.id))
    if (location.search.includes('rewards=')) history.replaceState(null, '', location.pathname)
  }
  const xu = events.reduce((sum, e) => sum + (e.kind === 'CHEER_IN' ? 0 : e.xu), 0)
  return (
    <>
      <button onClick={() => setOpen(true)} className="w-full text-left">
        <Card className="flex items-center gap-3 border-coin/40 bg-coin/10">
          <Gift className="size-6 shrink-0 text-coin" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="font-semibold">Bạn có {events.length} phần thưởng mới</p>
            <p className="truncate text-sm text-fg-muted">{events.map((e) => e.title.replace(/^(Nhiệm vụ|Huy hiệu): /, '')).slice(0, 3).join(' · ')}</p>
          </div>
          {xu > 0 && <span className="font-mono text-sm font-bold text-coin">+{formatCoin(xu)}</span>}
        </Card>
      </button>
      <RewardCascade key={events.map((e) => e.id).join()} events={events} open={open} onClose={close} />
    </>
  )
}

const AUTO_KEY = 'rh-auto-rewards'

/** Tự mở một lần cho mỗi bài chạy mới; mở từ link thông báo (?rewards=1) thì luôn mở */
function shouldAutoOpenRewards(events: GameState['unseen']) {
  if (!events.length || typeof window === 'undefined') return false
  const runs = events.filter((e) => e.kind === 'RUN').map((e) => e.id)
  const fromLink = new URLSearchParams(location.search).has('rewards')
  let shown: string[] = []
  try { shown = JSON.parse(localStorage.getItem(AUTO_KEY) ?? '[]') } catch { /* trình duyệt chặn lưu */ }
  const fresh = runs.filter((id) => !shown.includes(id))
  if (!fromLink && !fresh.length) return false
  try { localStorage.setItem(AUTO_KEY, JSON.stringify([...shown, ...fresh].slice(-50))) } catch { /* bỏ qua */ }
  return true
}
