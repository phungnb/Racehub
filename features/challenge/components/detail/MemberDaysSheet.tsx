'use client'

import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { ChevronRight, Lock, Sparkles } from 'lucide-react'
import { Avatar, ErrorState, LevelBadge, Sheet, Skeleton } from '@/shared/ui'
import { formatDuration, formatKm, formatNumber, formatPace, paceFrom } from '@/shared/lib/format'
import { routes } from '@/shared/config/routes'
import { challengeErrorMessage, getMemberDays } from '../../api/challengeApi'
import { challengeKeys } from '../../hooks/useChallenge'

const dayLabel = (d: string) => new Date(`${d}T00:00:00+07:00`).toLocaleDateString('vi-VN', { weekday: 'short', day: '2-digit', month: '2-digit', timeZone: 'Asia/Ho_Chi_Minh' })

/**
 * Chi tiết một người trên BXH (kiểu Strava segment / Garmin challenge): tổng quan + từng ngày, từng bài.
 * Bài chạy cụ thể chỉ hiện khi người đó cho xem hoạt động; km theo ngày luôn hiện như trên BXH.
 */
export function MemberDaysSheet({ challengeId, userId, onClose }: { challengeId: string; userId: string | null; onClose: () => void }) {
  const q = useQuery({
    queryKey: challengeKeys.memberDays(challengeId, userId ?? ''),
    queryFn: () => getMemberDays(challengeId, userId!),
    enabled: !!userId,
  })
  const d = q.data
  const maxKm = Math.max(0.1, ...(d?.days.map((x) => x.counted_km) ?? [0]))
  return (
    <Sheet open={!!userId} onClose={onClose} title={d?.user.display_name ?? 'Chi tiết vận động viên'} description="Từng ngày trong thử thách">
      {q.isPending ? (
        <div className="space-y-2">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-14" />)}</div>
      ) : q.isError || !d ? (
        <ErrorState message={challengeErrorMessage(q.error)} error={q.error} onRetry={() => void q.refetch()} />
      ) : (
        <div className="space-y-4">
          <Link href={routes.athlete(d.user.id)} className="flex items-center gap-3 rounded-xl border border-border p-3 hover:border-fg-subtle">
            <Avatar src={d.user.avatar_url} name={d.user.display_name} size="md" />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5 font-semibold">{d.user.display_name ?? 'Runner'}<LevelBadge level={d.user.level} /></span>
              <span className="block text-xs text-fg-muted">Xem hồ sơ & lịch sử bài chạy</span>
            </span>
            <ChevronRight className="size-4 text-fg-subtle" aria-hidden />
          </Link>
          <dl className="grid grid-cols-4 gap-2 text-center">
            <Stat label="Km" value={formatNumber(d.summary.km)} />
            <Stat label="Ngày chạy" value={String(d.summary.days)} />
            <Stat label="Buổi" value={String(d.summary.runs)} />
            <Stat label="Pace TB" value={formatPace(paceFrom(d.summary.km * 1000, d.summary.moving_s))} />
          </dl>
          {!d.days.length ? (
            <p className="py-6 text-center text-sm text-fg-muted">Chưa có bài chạy nào được tính.</p>
          ) : (
            <ol className="space-y-2">
              {d.days.map((day) => (
                <li key={day.day} className="rounded-xl border border-border bg-surface p-3">
                  <div className="flex items-center gap-2">
                    <span className="w-20 shrink-0 text-sm font-semibold capitalize">{dayLabel(day.day)}</span>
                    <span className="h-2 flex-1 overflow-hidden rounded-full bg-surface-2">
                      <span className="block h-full rounded-full bg-brand" style={{ width: `${Math.min(100, (day.counted_km / maxKm) * 100)}%` }} />
                    </span>
                    <span className="w-20 shrink-0 text-right font-mono text-sm font-bold">{formatNumber(day.counted_km)} km</span>
                  </div>
                  <p className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-fg-muted">
                    <span>{day.runs} buổi · {formatDuration(day.moving_s)}</span>
                    {day.counted_km !== day.km && <span>chạy {formatNumber(day.km)} km</span>}
                    {day.boost > 1 && <span className="inline-flex items-center gap-0.5 font-semibold text-coin"><Sparkles className="size-3" aria-hidden />Ngày vàng ×{String(day.boost).replace('.', ',')}</span>}
                  </p>
                  {day.activities.length > 0 && (
                    <ul className="mt-2 space-y-1">
                      {day.activities.map((a) => (
                        <li key={a.id}>
                          <Link href={routes.activity(a.id)} className="flex items-center gap-2 rounded-lg bg-surface-2/60 px-2.5 py-1.5 text-xs hover:bg-surface-2">
                            <span className="min-w-0 flex-1 truncate font-medium">{a.title ?? 'Buổi chạy'} · {new Date(a.started_at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}</span>
                            <span className="font-mono">{formatKm(a.distance_m)} km · {formatPace(paceFrom(a.distance_m, a.moving_s))}/km</span>
                            <ChevronRight className="size-3.5 text-fg-subtle" aria-hidden />
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ol>
          )}
          {!d.show_activities && (
            <p className="flex items-center gap-1.5 text-xs text-fg-subtle"><Lock className="size-3.5" aria-hidden />Vận động viên này không công khai từng bài chạy — chỉ hiện km theo ngày.</p>
          )}
        </div>
      )}
    </Sheet>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-surface-2 px-1 py-2">
      <dd className="font-mono text-base font-bold">{value}</dd>
      <dt className="text-[11px] text-fg-subtle">{label}</dt>
    </div>
  )
}
