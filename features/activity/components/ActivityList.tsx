'use client'

import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { routes } from '@/shared/config/routes'
import { Footprints, Clock3 } from 'lucide-react'
import { listMyRecentActivities } from '../api/activities'
import { Card, EmptyState, ErrorState, Skeleton } from '@/shared/ui'
import { formatDuration, formatKm, formatPace, formatRelative, paceFrom } from '@/shared/lib/format'

const SOURCE_LABEL: Record<string, string> = { STRAVA: 'Strava', DIRECT_GPS: 'GPS RaceHub', GARMIN: 'Garmin', COROS: 'COROS' }

export function ActivityList({ userId }: { userId: string }) {
  const q = useQuery({ queryKey: ['activities', 'mine', userId], queryFn: () => listMyRecentActivities(userId) })

  if (q.isPending) return <div className="space-y-2"><Skeleton className="h-16" /><Skeleton className="h-16" /></div>
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />
  if (q.data.length === 0) {
    return <EmptyState icon={Footprints} title="Chưa có bài chạy nào"
      description="Kết nối Strava hoặc bấm nút Chạy để ghi lại buổi chạy đầu tiên." />
  }

  return (
    <ul className="space-y-2">
      {q.data.map((a) => (
        <li key={a.id}>
          <Link href={routes.activity(a.id)} className="block rounded-[var(--radius-card)] focus-visible:outline-2 focus-visible:outline-brand">
          <Card className="flex items-center justify-between gap-3 py-3 transition-colors hover:border-fg-subtle">
            <div className="min-w-0">
              <p className="truncate font-semibold">{a.title}</p>
              <p className="text-xs text-fg-subtle">
                {formatRelative(a.startedAt)}
                {a.source && <span className="ml-2">· {SOURCE_LABEL[a.source] ?? a.source}</span>}
                {a.status === 'PENDING' && <span className="ml-2 whitespace-nowrap rounded bg-warning/15 px-1.5 py-0.5 text-warning">Chờ duyệt</span>}
                {a.status === 'REJECTED' && <span className="ml-2 whitespace-nowrap rounded bg-danger/15 px-1.5 py-0.5 text-danger">Không hợp lệ</span>}
              </p>
              {(a.status === 'PENDING' || a.status === 'REJECTED') && a.reason && (
                <p className="mt-0.5 text-xs text-fg-muted">{a.reason}</p>
              )}
            </div>
            <div className="shrink-0 text-right">
              <p className="font-mono tabular text-lg font-bold text-brand">{formatKm(a.distanceM)}<span className="ml-0.5 text-xs text-fg-muted">km</span></p>
              <p className="flex items-center justify-end gap-1 font-mono tabular text-xs text-fg-muted">
                <Clock3 className="size-3" aria-hidden />{formatDuration(a.movingS)} · {formatPace(paceFrom(a.distanceM, a.movingS))}/km
              </p>
            </div>
          </Card>
          </Link>
        </li>
      ))}
    </ul>
  )
}
