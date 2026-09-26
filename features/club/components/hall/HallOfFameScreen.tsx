'use client'

import { useQuery } from '@tanstack/react-query'
import { Crown, Medal, Sparkles, Timer, Trophy } from 'lucide-react'
import { Avatar, Card, EmptyState, ErrorState, SectionTitle, Skeleton } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { formatDuration, formatKm, formatNumber, formatRelative } from '@/shared/lib/format'
import { getHallOfFame, type HallOfFame } from '../../api/hubApi'

const MEDAL = ['text-medal-gold', 'text-medal-silver', 'text-medal-bronze']
const DIST_LABEL: Record<string, string> = { '5K': '5 km', '10K': '10 km', '21K': 'Half Marathon', '42K': 'Full Marathon' }

/** Tab Đại sảnh (migration 007800): Full / Half Marathon, kỷ lục CLB, BXH năm, cột mốc gần đây */
export function HallOfFameScreen({ clubId }: { clubId: string }) {
  const q = useQuery({ queryKey: ['club', clubId, 'hall'], queryFn: () => getHallOfFame(clubId), staleTime: 5 * 60_000 })
  if (q.isPending) return <div className="space-y-3"><Skeleton className="h-40" /><Skeleton className="h-56" /></div>
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />
  const h = q.data
  const empty = !h.marathon.length && !h.half.length && !h.records.length && !h.year.length
  if (empty) return <EmptyState icon={Trophy} title="Đại sảnh còn trống" description="Bài chạy hợp lệ của thành viên sẽ tự ghi danh: Half / Full Marathon, kỷ lục CLB, cột mốc km." />
  return (
    <div className="space-y-6 pb-8">
      <Finishers title="Full Marathon" emoji="🏅" rows={h.marathon} />
      <Finishers title="Half Marathon" emoji="🥈" rows={h.half} />
      {h.records.length > 0 && <Records rows={h.records} />}
      {h.year.length > 0 && (
        <section>
          <SectionTitle>Km năm {new Date(h.year_start).getFullYear()}</SectionTitle>
          <ol className="space-y-1.5">
            {h.year.map((y) => (
              <li key={y.user_id} className="flex items-center gap-3 rounded-xl border border-border bg-surface px-3 py-2">
                <span className={cn('w-6 text-center font-mono text-sm font-bold', MEDAL[y.rank - 1] ?? 'text-fg-muted')}>{y.rank}</span>
                <Avatar src={y.avatar_url} name={y.name} size="sm" />
                <span className="min-w-0 flex-1 truncate text-sm font-semibold">{y.name}</span>
                <span className="text-xs text-fg-subtle">{y.runs} buổi</span>
                <span className="font-mono tabular font-bold">{formatKm(y.distance_m)}<span className="ml-0.5 text-xs text-fg-muted">km</span></span>
              </li>
            ))}
          </ol>
        </section>
      )}
      {h.milestones.length > 0 && (
        <section>
          <SectionTitle>Cột mốc gần đây</SectionTitle>
          <ul className="space-y-1.5">
            {h.milestones.map((m) => (
              <li key={`${m.user_id}-${m.code}`} className="flex items-center gap-3 rounded-xl bg-surface-2 px-3 py-2 text-sm">
                <Sparkles className="size-4 shrink-0 text-coin" aria-hidden />
                <span className="min-w-0 flex-1"><b>{m.name}</b> {m.label}</span>
                <span className="shrink-0 text-xs text-fg-subtle">{formatRelative(m.reached_at)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <p className="text-xs text-fg-subtle">Chỉ tính bài chạy hợp lệ và đang chia sẻ. Kỷ lục ước tính từ bài có cự ly sát mốc (≤ +5%).</p>
    </div>
  )
}

function Finishers({ title, emoji, rows }: { title: string; emoji: string; rows: HallOfFame['marathon'] }) {
  if (!rows.length) return null
  return (
    <section>
      <SectionTitle>{emoji} {title} · {formatNumber(rows.length)} người</SectionTitle>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {rows.map((r) => (
          <Card key={r.user_id} className="flex items-center gap-2 p-3">
            <Avatar src={r.avatar_url} name={r.name} size="md" />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{r.name}</p>
              <p className="text-[11px] text-fg-muted">
                {r.times > 1 ? `${r.times} lần · ` : ''}{r.best_s ? `PB ${formatDuration(r.best_s)}` : new Date(r.first_at).toLocaleDateString('vi-VN')}
              </p>
            </div>
          </Card>
        ))}
      </div>
    </section>
  )
}

function Records({ rows }: { rows: HallOfFame['records'] }) {
  const groups = ['5K', '10K', '21K', '42K'].map((l) => ({ label: l, rows: rows.filter((r) => r.label === l) })).filter((g) => g.rows.length)
  return (
    <section>
      <SectionTitle><span className="inline-flex items-center gap-1.5"><Timer className="size-4" aria-hidden />Kỷ lục CLB</span></SectionTitle>
      <div className="grid gap-2 sm:grid-cols-2">
        {groups.map((g) => (
          <Card key={g.label} className="space-y-1.5 p-3">
            <p className="flex items-center gap-1.5 text-sm font-bold"><Medal className="size-4 text-coin" aria-hidden />{DIST_LABEL[g.label]}</p>
            {g.rows.map((r) => (
              <p key={r.user_id} className="flex items-center gap-2 text-sm">
                {r.rank === 1 ? <Crown className={cn('size-4', MEDAL[0])} aria-hidden /> : <span className={cn('w-4 text-center font-mono text-xs font-bold', MEDAL[r.rank - 1])}>{r.rank}</span>}
                <span className="min-w-0 flex-1 truncate">{r.name}</span>
                <span className="font-mono tabular font-semibold">{formatDuration(r.best_s)}</span>
              </p>
            ))}
          </Card>
        ))}
      </div>
    </section>
  )
}
