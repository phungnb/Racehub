'use client'

import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Crown, Trophy } from 'lucide-react'
import { Avatar, EmptyState, ErrorState, LevelBadge, SegmentedControl, Skeleton } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { formatDuration, formatKm } from '@/shared/lib/format'
import type { LeaderboardPeriod, LeaderboardRow } from '../../api/hubApi'
import { useClub } from '../../hooks/useClub'
import { useClubLeaderboard } from '../../hooks/useLeaderboard'
import { ClubBattles } from './ClubBattles'
import { ClubRankings } from './ClubRankings'

const PERIODS: { value: LeaderboardPeriod; label: string }[] = [
  { value: 'WEEK', label: 'Tuần này' },
  { value: 'MONTH', label: 'Tháng này' },
  { value: 'ALL', label: 'Tất cả' },
]

type View = 'members' | 'battles' | 'clubs'
const VIEWS: { value: View; label: string }[] = [
  { value: 'members', label: 'Thành viên' },
  { value: 'battles', label: 'Đấu CLB' },
  { value: 'clubs', label: 'Xếp hạng CLB' },
]

/** Tab BXH: thành viên trong CLB · CLB đấu CLB · xếp hạng CLB toàn hệ thống (?tab=battles|clubs từ thông báo) */
export function ClubLeaderboardScreen({ clubId }: { clubId: string }) {
  const sp = useSearchParams()
  const initial = sp.get('tab') === 'battles' ? 'battles' : sp.get('tab') === 'clubs' ? 'clubs' : 'members'
  const [view, setView] = useState<View>(initial)
  const { isStaff } = useClub(clubId)
  return (
    <div className="space-y-4">
      <div className="flex gap-1.5 overflow-x-auto [scrollbar-width:none]" role="tablist" aria-label="Bảng xếp hạng">
        {VIEWS.map((v) => (
          <button key={v.value} role="tab" aria-selected={view === v.value} onClick={() => setView(v.value)}
            className={cn('shrink-0 rounded-full border px-3.5 py-1.5 text-sm font-semibold',
              view === v.value ? 'border-brand bg-brand text-brand-fg' : 'border-border text-fg-muted hover:text-fg')}>
            {v.label}
          </button>
        ))}
      </div>
      {view === 'battles' ? <ClubBattles clubId={clubId} isStaff={isStaff} />
        : view === 'clubs' ? <ClubRankings clubId={clubId} />
        : <MemberLeaderboard clubId={clubId} />}
    </div>
  )
}

function MemberLeaderboard({ clubId }: { clubId: string }) {
  const { uid } = useClub(clubId)
  const [period, setPeriod] = useState<LeaderboardPeriod>('WEEK')
  const lb = useClubLeaderboard(clubId, period)
  const rows = lb.data ?? []
  const ran = rows.filter((r) => r.run_count > 0)
  const idle = rows.filter((r) => r.run_count === 0)
  const me = rows.find((r) => r.user_id === uid)
  const myRow = useRef<HTMLLIElement>(null)
  const [myRowVisible, setMyRowVisible] = useState(true)
  useEffect(() => {
    const el = myRow.current
    if (!el) return
    const io = new IntersectionObserver(([e]) => setMyRowVisible(e.isIntersecting), { rootMargin: '0px 0px -120px 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [lb.data])

  return (
    <div className="space-y-4 pb-20">
      <SegmentedControl value={period} onChange={setPeriod} options={PERIODS} />

      {lb.isLoading ? (
        <div className="space-y-2"><Skeleton className="h-40" />{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-14" />)}</div>
      ) : lb.isError ? (
        <ErrorState onRetry={() => lb.refetch()} />
      ) : ran.length === 0 ? (
        <EmptyState icon={Trophy} title={period === 'WEEK' ? 'Tuần này chưa ai chạy' : 'Chưa có bài chạy nào'}
          description="Bài chạy hợp lệ (GPS trong app hoặc đồng bộ Strava) sẽ tự cộng vào BXH." />
      ) : (
        <>
          <Podium rows={ran.slice(0, 3)} meId={uid} />
          <ol className="space-y-1.5">
            {ran.slice(3).map((r) => <RankRow key={r.user_id} r={r} me={r.user_id === uid} ref={r.user_id === uid ? myRow : undefined} />)}
          </ol>
          {idle.length > 0 && (
            <details className="rounded-[var(--radius-card)] border border-border bg-surface">
              <summary className="cursor-pointer list-none px-4 py-3 text-sm font-semibold text-fg-muted">
                {idle.length} thành viên chưa chạy {period === 'WEEK' ? 'tuần này' : period === 'MONTH' ? 'tháng này' : ''}
              </summary>
              <ul className="flex flex-wrap gap-2 px-4 pb-4">
                {idle.map((r) => (
                  <li key={r.user_id} className="flex items-center gap-1.5 rounded-full bg-surface-2 py-1 pl-1 pr-3 text-sm">
                    <Avatar src={r.avatar_url} name={r.display_name} size="xs" />{r.display_name}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}

      {me && me.run_count > 0 && me.rank > 3 && !myRowVisible && (
        <div className="fixed inset-x-0 bottom-[calc(3.5rem+1px+env(safe-area-inset-bottom))] z-30 mx-auto max-w-md px-4 pb-2">
          <RankRow r={me} me floating />
        </div>
      )}
    </div>
  )
}

function Podium({ rows, meId }: { rows: LeaderboardRow[]; meId?: string }) {
  // Thứ tự hiển thị: 2 · 1 · 3
  const order = [rows[1], rows[0], rows[2]]
  const height = ['h-20', 'h-28', 'h-16']
  const tone = ['text-medal-silver', 'text-medal-gold', 'text-medal-bronze']
  return (
    <div className="grid grid-cols-3 items-end gap-2 rounded-[var(--radius-card)] border border-border bg-surface px-3 pt-5">
      {order.map((r, i) => r ? (
        <div key={r.user_id} className="flex flex-col items-center text-center">
          {i === 1 && <Crown className="mb-1 size-5 text-medal-gold" aria-hidden />}
          <Avatar src={r.avatar_url} name={r.display_name} size={i === 1 ? 'lg' : 'md'} className={cn(r.user_id === meId && 'ring-2 ring-brand')} />
          <p className="mt-1.5 w-full truncate text-sm font-semibold">{r.display_name}</p>
          <p className="font-mono tabular text-sm font-bold">{formatKm(r.distance_m)} km</p>
          <div className={cn('mt-2 grid w-full place-items-center rounded-t-xl bg-surface-2', height[i])}>
            <span className={cn('font-mono text-2xl font-black', tone[i])}>{r.rank}</span>
          </div>
        </div>
      ) : <div key={i} />)}
    </div>
  )
}

function RankRow({ r, me, floating, ref }: { r: LeaderboardRow; me?: boolean; floating?: boolean; ref?: React.Ref<HTMLLIElement> }) {
  return (
    <li ref={ref} className={cn('flex list-none items-center gap-3 rounded-xl border px-3 py-2.5',
      floating ? 'border-brand/60 bg-surface shadow-lg shadow-black/50 ring-1 ring-brand/30'   // nổi trên danh sách: nền đặc, không lộ dòng bên dưới
        : me ? 'border-brand/50 bg-brand/10' : 'border-border bg-surface')}>
      <span className="w-7 text-center font-mono text-sm font-bold text-fg-muted">{r.rank}</span>
      <Avatar src={r.avatar_url} name={r.display_name} size="sm" />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-sm font-semibold">{me ? 'Bạn' : r.display_name}</span>
          <LevelBadge level={r.level} />
        </span>
        <span className="text-xs text-fg-subtle">{r.run_count} buổi · {formatDuration(r.moving_s)}</span>
      </span>
      <span className="font-mono tabular font-bold">{formatKm(r.distance_m)}<span className="ml-0.5 text-xs text-fg-muted">km</span></span>
    </li>
  )
}
