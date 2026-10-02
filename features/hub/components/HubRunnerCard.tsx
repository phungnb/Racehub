'use client'

import Link from 'next/link'
import { useState } from 'react'
import { Check, MessageCircle, UserCheck, UserPlus } from 'lucide-react'
import { toast } from 'sonner'
import { Avatar, Button, Card, LevelBadge } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { routes } from '@/shared/config/routes'
import { daysAgo, formatPace, GOALS, SLOTS, sendConnection } from '@/features/nearby'
import { followRunner, unfollowRunner } from '@/features/social'
import { hubErrorMessage, type HubRunner, type PrKey, type RunnerStats } from '../api/hubApi'
import { formatDuration, HUB_REASONS, PR_LABEL } from '../model/hub'
import { useHubMutation } from './hubHooks'

/** Thành tích ước tính 12 tháng (từ bài chạy đã chia sẻ) */
export function PrRow({ prs }: { prs: Partial<Record<PrKey, number>> }) {
  return (
    <div className="grid grid-cols-4 gap-1.5 text-center">
      {(Object.keys(PR_LABEL) as PrKey[]).map((k) => (
        <div key={k} className={cn('rounded-xl px-1 py-1.5', prs[k] ? 'bg-brand/10' : 'bg-surface-2')}>
          <p className="text-[10px] font-semibold uppercase text-fg-subtle">{PR_LABEL[k]}</p>
          <p className={cn('text-sm font-black tabular-nums', !prs[k] && 'text-fg-subtle')}>{formatDuration(prs[k]) ?? '—'}</p>
        </div>
      ))}
    </div>
  )
}

export function StatsLine({ s, pace }: { s: RunnerStats; pace: number | null }) {
  return (
    <p className="text-xs text-fg-muted">
      <b className="text-fg">{String(s.km_30d).replace('.', ',')} km</b> · {s.runs_30d} buổi / 30 ngày · {s.km_year} km / năm
      {pace ? <> · pace {formatPace(pace)}</> : null}
    </p>
  )
}

/** Thẻ runner trong danh bạ Hội quán: hợp nhau vì sao, thành tích, số liệu; theo dõi / kết nối / nhắn tin */
export function HubRunnerCard({ r }: { r: HubRunner }) {
  const [following, setFollowing] = useState(r.following)
  const [conn, setConn] = useState(r.connection)
  const follow = useHubMutation(() => (following ? unfollowRunner(r.id) : followRunner(r.id)))
  const connect = useHubMutation(() => sendConnection(r.id, null))
  const ran = daysAgo(r.last_run_days)

  return (
    <Card className="space-y-3">
      <div className="flex items-start gap-3">
        <Link href={routes.athlete(r.id)} aria-label={`Hồ sơ ${r.name}`}><Avatar src={r.avatar_url} name={r.name} size="lg" /></Link>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5">
            <Link href={routes.athlete(r.id)} className="truncate font-semibold hover:underline">{r.name}</Link>
            {r.level != null && <LevelBadge level={r.level} />}
          </p>
          <p className="truncate text-sm text-fg-muted">{[r.province, ran && `chạy ${ran}`].filter(Boolean).join(' · ') || 'Runner RaceHub'}</p>
          {r.headline && <p className="mt-0.5 line-clamp-2 text-sm">{r.headline}</p>}
        </div>
        <span className="shrink-0 rounded-full bg-brand/15 px-2 py-0.5 text-[11px] font-bold text-brand" title="Mức hợp nhau">{r.score}%</span>
      </div>
      {r.reasons.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {r.reasons.map((x) => <span key={x} className="rounded-full bg-brand/10 px-2 py-0.5 text-[11px] font-semibold text-brand">{HUB_REASONS[x]}</span>)}
        </div>
      )}
      <PrRow prs={r.prs} />
      <StatsLine s={r.stats} pace={r.pace_s} />
      {(r.goals.length > 0 || r.time_slots.length > 0) && (
        <p className="text-xs text-fg-subtle">
          {r.goals.length > 0 && <>Mục tiêu: {r.goals.map((g) => GOALS[g]).join(', ')}</>}
          {r.goals.length > 0 && r.time_slots.length > 0 && ' · '}
          {r.time_slots.length > 0 && <>Hay chạy: {r.time_slots.map((s) => SLOTS[s]).join(', ')}</>}
        </p>
      )}
      <div className="grid grid-cols-2 gap-2">
        <Button size="sm" variant={following ? 'secondary' : 'primary'} loading={follow.isPending}
          onClick={() => follow.mutate(undefined, { onSuccess: () => setFollowing(!following), onError: (e) => toast.error(hubErrorMessage(e)) })}>
          {following ? <><UserCheck className="size-4" aria-hidden />Đang theo dõi</> : <><UserPlus className="size-4" aria-hidden />Theo dõi</>}
        </Button>
        {conn === 'CONNECTED' ? (
          <Link href={routes.message(r.id)} className="inline-flex h-9 items-center justify-center gap-1.5 rounded-xl border border-border text-sm font-semibold text-brand">
            <MessageCircle className="size-4" aria-hidden />Nhắn tin
          </Link>
        ) : (
          <Button size="sm" variant="secondary" disabled={conn === 'PENDING_OUT'} loading={connect.isPending}
            onClick={() => connect.mutate(undefined, {
              onSuccess: (x) => { setConn(x.status === 'ACCEPTED' ? 'CONNECTED' : 'PENDING_OUT'); toast.success(x.status === 'ACCEPTED' ? 'Đã kết nối' : 'Đã gửi lời mời kết nối') },
              onError: (e) => toast.error(hubErrorMessage(e)),
            })}>
            {conn === 'PENDING_OUT' ? <><Check className="size-4" aria-hidden />Đã mời</> : conn === 'PENDING_IN' ? 'Chấp nhận kết nối' : 'Kết nối'}
          </Button>
        )}
      </div>
    </Card>
  )
}
