'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Gem, Trophy } from 'lucide-react'
import { EmptyState, ErrorState, SegmentedControl, Skeleton } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { formatNumber } from '@/shared/lib/format'
import { getClubRankings, type ClubTier } from '../../api/battleApi'
import { ClubAvatar } from '../hub/ClubAvatar'

export const TIER: Record<ClubTier, { label: string; tone: string; month: number }> = {
  DIAMOND: { label: 'Kim cương', tone: 'bg-sky-400/15 text-sky-300', month: 120 },
  PLATINUM: { label: 'Bạch kim', tone: 'bg-teal-400/15 text-teal-300', month: 80 },
  GOLD: { label: 'Vàng', tone: 'bg-medal-gold/15 text-medal-gold', month: 50 },
  SILVER: { label: 'Bạc', tone: 'bg-medal-silver/15 text-medal-silver', month: 25 },
  BRONZE: { label: 'Đồng', tone: 'bg-medal-bronze/15 text-medal-bronze', month: 0 },
}

/** Bảng xếp hạng CLB toàn hệ thống: km trung bình mỗi thành viên (không phụ thuộc quân số) */
export function ClubRankings({ clubId }: { clubId: string }) {
  const [period, setPeriod] = useState<'WEEK' | 'MONTH'>('MONTH')
  const q = useQuery({ queryKey: ['club-rankings', period], queryFn: () => getClubRankings(period), staleTime: 120_000 })
  const f = period === 'WEEK' ? 0.25 : 1
  return (
    <div className="space-y-3">
      <SegmentedControl value={period} onChange={setPeriod} options={[{ value: 'WEEK', label: 'Tuần này' }, { value: 'MONTH', label: 'Tháng này' }]} />
      <p className="text-xs text-fg-muted">
        Xếp theo <b className="text-fg">km trung bình mỗi thành viên</b> — CLB nhỏ vẫn đua được với CLB lớn. CLB từ 3 thành viên.
      </p>
      <div className="flex flex-wrap gap-1.5">
        {(Object.keys(TIER) as ClubTier[]).map((t) => (
          <span key={t} className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold', TIER[t].tone)}>
            {TIER[t].label}{TIER[t].month ? ` ≥ ${formatNumber(TIER[t].month * f)} km` : ''}
          </span>
        ))}
      </div>
      {q.isPending ? <Skeleton className="h-64" /> : q.isError ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : !q.data.length ? (
        <EmptyState icon={Trophy} title="Chưa có CLB nào đủ điều kiện" description="CLB cần ít nhất 3 thành viên để vào bảng xếp hạng." />
      ) : (
        <ol className="space-y-1.5">
          {q.data.map((c) => (
            <li key={c.club_id} className={cn('flex items-center gap-3 rounded-xl border px-3 py-2.5',
              c.club_id === clubId ? 'border-brand/50 bg-brand/10' : c.is_mine ? 'border-brand/25 bg-surface' : 'border-border bg-surface')}>
              <span className={cn('w-7 text-center font-mono text-sm font-bold', c.rank <= 3 ? ['text-medal-gold', 'text-medal-silver', 'text-medal-bronze'][c.rank - 1] : 'text-fg-muted')}>{c.rank}</span>
              <ClubAvatar club={c} size="sm" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{c.name}</span>
                <span className="flex items-center gap-1.5 text-xs text-fg-subtle">
                  <span className={cn('inline-flex items-center gap-0.5 rounded-full px-1.5 font-semibold', TIER[c.tier].tone)}>
                    {c.tier === 'DIAMOND' && <Gem className="size-3" aria-hidden />}{TIER[c.tier].label}
                  </span>
                  {c.runners}/{c.members} người chạy · {formatNumber(c.km)} km
                </span>
              </span>
              <span className="text-right font-mono font-bold tabular">{formatNumber(c.avg_km)}<span className="block text-[10px] font-normal text-fg-muted">km/người</span></span>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
