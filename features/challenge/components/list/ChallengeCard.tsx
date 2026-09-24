'use client'

import Link from 'next/link'
import { Coins, Flame, Lock, Shield, Swords, Target, Trophy, Users, UsersRound, type LucideIcon } from 'lucide-react'
import { cn } from '@/shared/lib/cn'
import { formatNumber } from '@/shared/lib/format'
import { ProgressBar } from '@/shared/ui'
import type { ChallengeListItem } from '../../api/challengeApi'
import { challengePhase, FORMAT_META, formatScore, OBJECTIVE_META, TEAM_MODE_META, timeLabel, type ChallengeFormat, type TeamMode } from '../../model/challenge'

export const FORMAT_ICON: Record<ChallengeFormat, LucideIcon> = {
  SOLO_GOAL: Target, RANKED: Trophy, DUEL: Swords, TEAM: UsersRound, COLLECTIVE: Users,
}
export const FORMAT_TONE: Record<ChallengeFormat, string> = {
  SOLO_GOAL: 'text-brand bg-brand/15', RANKED: 'text-coin bg-coin/15', DUEL: 'text-live bg-live/15',
  TEAM: 'text-xp bg-xp/15', COLLECTIVE: 'text-success bg-success/15',
}

export function ChallengeCard({ c }: { c: ChallengeListItem }) {
  const phase = challengePhase(c)
  const Icon = FORMAT_ICON[c.format] ?? Trophy
  const joined = c.my_status && c.my_status !== 'LEFT'
  const target = Number(c.target_value)
  const collective = c.format === 'COLLECTIVE'
  const progress = collective ? c.total_score : c.my_score ?? 0
  const mode = c.format === 'TEAM' && c.game_mode ? TEAM_MODE_META[c.game_mode as TeamMode]?.label : null

  return (
    <Link href={`/challenges/${c.id}`}
      className="block overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface transition-colors hover:border-fg-subtle">
      <div className="flex gap-3 p-4">
        <span className={cn('grid size-11 shrink-0 place-items-center rounded-xl', FORMAT_TONE[c.format])}>
          <Icon className="size-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-xs font-semibold text-fg-muted">
            <span>{FORMAT_META[c.format]?.short}{mode ? ` · ${mode}` : ''}</span>
            {c.target_audience === 'INVITE_ONLY' && <Lock className="size-3.5" aria-label="Riêng tư" />}
            {c.club_name && (
              <span className="flex min-w-0 items-center gap-1 truncate" style={{ color: c.club_accent ?? undefined }}>
                <Shield className="size-3.5 shrink-0" aria-hidden />{c.club_name}
              </span>
            )}
            <span className={cn('ml-auto shrink-0 rounded-full px-2 py-0.5 text-xs font-bold',
              phase === 'LIVE' ? 'bg-brand text-brand-fg' : phase === 'UPCOMING' ? 'bg-warning/15 text-warning' : 'bg-surface-2 text-fg-subtle')}>
              {timeLabel(c)}
            </span>
          </div>
          <h3 className="mt-1 line-clamp-2 text-base font-bold leading-snug">{c.title}</h3>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-muted">
            <span className="flex items-center gap-1"><Users className="size-3.5" aria-hidden />
              {formatNumber(c.participant_count)}{c.max_slots && c.format !== 'COLLECTIVE' ? `/${formatNumber(c.max_slots)}` : ''} người</span>
            {target > 0 && <span className="flex items-center gap-1"><Target className="size-3.5" aria-hidden />{formatScore(c.objective, target)}</span>}
            {!target && <span>{OBJECTIVE_META[c.objective]?.label}</span>}
            {Number(c.reward_xu) > 0 && <span className="flex items-center gap-1 font-semibold text-coin"><Coins className="size-3.5" aria-hidden />{formatNumber(c.reward_xu)} Xu</span>}
          </div>
        </div>
      </div>
      {(joined || collective) && (
        <div className="space-y-1.5 border-t border-border bg-bg/40 px-4 py-2.5">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium text-fg-muted">{collective ? 'Cả cộng đồng' : 'Của bạn'}</span>
            <span className="flex items-center gap-2">
              {joined && c.my_rank && !collective && <span className="flex items-center gap-1 font-mono font-bold text-coin"><Flame className="size-3.5" aria-hidden />#{c.my_rank}</span>}
              <span className="font-mono tabular font-bold">{formatScore(c.objective, progress)}{target > 0 ? ` / ${formatScore(c.objective, target, false)}` : ''}</span>
            </span>
          </div>
          {target > 0 && <ProgressBar value={progress} max={target} />}
        </div>
      )}
    </Link>
  )
}
