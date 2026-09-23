'use client'

import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarDays, Flag, Plus, Route, Trophy, Users } from 'lucide-react'
import { Button, Card, EmptyState, ErrorState, SegmentedControl, Skeleton } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { useSession } from '@/features/auth/model/session'
import { getChallengesFromSupabase } from '../api/challengeApi'
import { GAME_MODE_LABEL, challengePhase, timeLabel, timeProgress, type ChallengeRow } from '../model/challenge'
import CreateChallengeWizard from './CreateChallengeWizard'
import type { Profile } from '@/shared/types/profile'

type Tab = 'LIVE' | 'UPCOMING' | 'ENDED' | 'MINE'

const fmtDate = (iso: string) => { const d = new Date(iso); return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}` }
const num = (v: unknown) => Number(v ?? 0)

function ChallengeCard({ c }: { c: ChallengeRow }) {
  const phase = challengePhase(c)
  const team = c.challenge_type === 'TEAM'
  const Icon = team ? Users : Trophy
  return (
    <Card className="overflow-hidden p-0">
      <div className={cn('relative flex items-center gap-3 px-4 py-3',
        team ? 'bg-gradient-to-r from-xp/25 to-transparent' : 'bg-gradient-to-r from-brand/20 to-transparent')}>
        <span className={cn('grid size-10 place-items-center rounded-xl', team ? 'bg-xp/20 text-xp' : 'bg-brand/15 text-brand')}>
          <Icon className="size-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className="truncate text-xs font-semibold uppercase tracking-wider text-fg-muted">
              {team ? 'Đồng đội' : 'Cá nhân'} · {GAME_MODE_LABEL[c.game_mode ?? ''] ?? c.game_mode ?? 'Tích lũy km'}
            </p>
            <span className={cn('shrink-0 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-bold',
              phase === 'LIVE' ? 'bg-brand text-brand-fg' : phase === 'UPCOMING' ? 'bg-warning/15 text-warning' : 'bg-surface-2 text-fg-subtle')}>
              {timeLabel(c)}
            </span>
          </div>
          <h3 className="mt-0.5 line-clamp-2 text-base font-bold leading-snug">{c.title}</h3>
        </div>
      </div>
      <div className="grid grid-cols-3 divide-x divide-border border-t border-border text-center">
        <div className="px-2 py-2.5">
          <p className="flex items-center justify-center gap-1 text-[11px] uppercase tracking-wide text-fg-subtle"><Flag className="size-3" />Mục tiêu</p>
          <p className="font-mono tabular font-bold">{num(c.target_km) > 0 ? `${num(c.target_km)} km` : '—'}</p>
        </div>
        <div className="px-2 py-2.5">
          <p className="flex items-center justify-center gap-1 text-[11px] uppercase tracking-wide text-fg-subtle"><Route className="size-3" />Tối thiểu</p>
          <p className="font-mono tabular font-bold">{num(c.min_km)} km/bài</p>
        </div>
        <div className="px-2 py-2.5">
          <p className="flex items-center justify-center gap-1 text-[11px] uppercase tracking-wide text-fg-subtle"><Users className="size-3" />Quy mô</p>
          <p className="font-mono tabular font-bold">{c.max_slots ?? 50} VĐV</p>
        </div>
      </div>
      <div className="flex items-center gap-2 border-t border-border px-4 py-2.5 text-xs text-fg-muted">
        <CalendarDays className="size-3.5" aria-hidden />
        {fmtDate(c.start_date)} – {fmtDate(c.end_date)}
        {phase === 'LIVE' && (
          <span className="ml-auto h-1.5 w-24 overflow-hidden rounded-full bg-surface-2" aria-label="Thời gian đã trôi qua">
            <span className="block h-full rounded-full bg-brand" style={{ width: `${timeProgress(c) * 100}%` }} />
          </span>
        )}
      </div>
    </Card>
  )
}

export function ChallengesScreen({ profile }: { profile: Profile | null }) {
  const uid = useSession().session?.user.id
  const qc = useQueryClient()
  const [tab, setTab] = useState<Tab>('LIVE')
  const [wizard, setWizard] = useState(false)
  const q = useQuery({ queryKey: ['challenges'], queryFn: getChallengesFromSupabase })

  const groups = useMemo(() => {
    const all = q.data ?? []
    return {
      LIVE: all.filter((c) => challengePhase(c) === 'LIVE'),
      UPCOMING: all.filter((c) => challengePhase(c) === 'UPCOMING'),
      ENDED: all.filter((c) => challengePhase(c) === 'ENDED'),
      MINE: all.filter((c) => c.created_by === uid),
    }
  }, [q.data, uid])
  const list = groups[tab]

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Thử thách</h1>
          <p className="text-sm text-fg-muted">Chinh phục mục tiêu cùng cộng đồng</p>
        </div>
        <Button size="sm" onClick={() => setWizard(true)}><Plus className="size-4" /> Tạo</Button>
      </div>

      <SegmentedControl value={tab} onChange={setTab} options={[
        { value: 'LIVE', label: 'Diễn ra', count: groups.LIVE.length || undefined },
        { value: 'UPCOMING', label: 'Sắp tới', count: groups.UPCOMING.length || undefined },
        { value: 'ENDED', label: 'Đã xong' },
        { value: 'MINE', label: 'Của tôi' },
      ]} />

      {q.isPending ? (
        <div className="space-y-3"><Skeleton className="h-36" /><Skeleton className="h-36" /></div>
      ) : q.isError ? (
        <ErrorState onRetry={() => q.refetch()} />
      ) : list.length === 0 ? (
        <EmptyState icon={Trophy}
          title={tab === 'MINE' ? 'Bạn chưa tạo thử thách nào' : 'Chưa có thử thách ở mục này'}
          description="Tạo thử thách để rủ bạn bè cùng chạy, hoặc xem mục khác."
          action={<Button size="sm" onClick={() => setWizard(true)}><Plus className="size-4" /> Tạo thử thách</Button>} />
      ) : (
        <ul className="space-y-3">{list.map((c) => <li key={c.id}><ChallengeCard c={c} /></li>)}</ul>
      )}

      <CreateChallengeWizard isOpen={wizard} profile={profile} onClose={() => setWizard(false)}
        onCreated={() => { setWizard(false); qc.invalidateQueries({ queryKey: ['challenges'] }); qc.invalidateQueries({ queryKey: ['profile'] }) }} />
    </div>
  )
}
