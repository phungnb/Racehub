'use client'

import { ChevronDown, ChevronUp, Trophy } from 'lucide-react'
import { Avatar, ErrorState, LevelBadge, Sheet, Skeleton } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { useLeagueStandings } from '../hooks/useGame'
import { leagueTier, timeLeft, type LeagueState } from '../model/game'

const km = (n: number) => n.toLocaleString('vi-VN', { maximumFractionDigits: 1 })

/** Bảng xếp hạng nhóm league tuần này: vùng lên hạng (xanh), xuống hạng (đỏ) */
export function LeagueSheet({ open, onClose, league }: { open: boolean; onClose: () => void; league: LeagueState }) {
  const q = useLeagueStandings(open ? league.group_id : null)
  const t = leagueTier(league.tier)
  return (
    <Sheet open={open} onClose={onClose} title={`League ${t.name}`}
      description={league.ends_at ? `Chốt sau ${timeLeft(league.ends_at)} · điểm = km hợp lệ trong tuần` : undefined}>
      {q.isPending ? (
        <div className="space-y-2">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-12" />)}</div>
      ) : q.isError ? (
        <ErrorState onRetry={() => void q.refetch()} />
      ) : (
        <ol className="space-y-1">
          {q.data.map((r, i) => {
            const prev = q.data[i - 1]
            const divider = prev && prev.zone !== r.zone
            return (
              <li key={r.user_id}>
                {divider && (
                  <p className={cn('flex items-center gap-1 px-2 pb-1 pt-2 text-xs font-semibold',
                    r.zone === 'DOWN' ? 'text-danger' : 'text-fg-subtle')}>
                    {r.zone === 'DOWN' ? <><ChevronDown className="size-3.5" aria-hidden />Vùng xuống hạng</> : <>Vùng giữ hạng</>}
                  </p>
                )}
                <div className={cn('flex items-center gap-3 rounded-xl px-2 py-2', r.is_me && 'bg-brand/10 ring-1 ring-brand/40')}>
                  <span className={cn('w-7 text-center font-mono text-sm font-bold',
                    r.zone === 'UP' ? 'text-success' : r.zone === 'DOWN' ? 'text-danger' : 'text-fg-muted')}>{r.rank}</span>
                  <Avatar src={r.avatar_url} name={r.display_name} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5"><span className="truncate text-sm font-semibold">{r.is_me ? 'Bạn' : r.display_name}</span><LevelBadge level={r.level} /></span>
                  </span>
                  <span className="font-mono text-sm font-semibold">{km(r.points)} km</span>
                  {r.zone === 'UP' && <ChevronUp className="size-4 text-success" aria-label="Lên hạng" />}
                </div>
              </li>
            )
          })}
        </ol>
      )}
      <p className="mt-4 flex items-start gap-2 rounded-xl bg-surface-2 p-3 text-xs text-fg-muted">
        <Trophy className="mt-0.5 size-4 shrink-0 text-coin" aria-hidden />
        Mỗi thứ Hai: nhóm {league.size ?? 30} người, top {league.promote ?? 7} lên hạng, {league.demote ?? 5} người cuối xuống hạng. Top 3 nhận Xu và XP.
      </p>
    </Sheet>
  )
}
