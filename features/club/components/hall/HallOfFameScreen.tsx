'use client'

import { useMemo, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown, Crown, Medal, Sparkles, Timer, Trophy } from 'lucide-react'
import { Avatar, Card, EmptyState, ErrorState, RankSearch, scrollToRow, Sheet, Skeleton } from '@/shared/ui'
import { filterSearch } from '@/shared/lib/search'
import { useSession } from '@/features/auth'
import { cn } from '@/shared/lib/cn'
import { formatDuration, formatKm, formatNumber, formatRelative } from '@/shared/lib/format'
import { getHallOfFame, type HallFinisher, type HallOfFame } from '../../api/hubApi'
import { useClub } from '../../hooks/useClub'
import { DrawPanel } from '@/features/draw'

const MEDAL = ['text-medal-gold', 'text-medal-silver', 'text-medal-bronze']
const YEAR_PREVIEW = 10
const FINISHER_PREVIEW = 6
const DIST_LABEL: Record<string, string> = { '5K': '5 km', '10K': '10 km', '21K': 'Half Marathon', '42K': 'Full Marathon' }

/** Tab Đại sảnh (migration 007800): Full / Half Marathon, kỷ lục CLB, BXH năm, cột mốc gần đây */
export function HallOfFameScreen({ clubId }: { clubId: string }) {
  const q = useQuery({ queryKey: ['club', clubId, 'hall'], queryFn: () => getHallOfFame(clubId), staleTime: 5 * 60_000 })
  const { isStaff } = useClub(clubId)
  if (q.isPending) return <div className="space-y-3"><Skeleton className="h-40" /><Skeleton className="h-56" /></div>
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />
  const h = q.data
  const empty = !h.marathon.length && !h.half.length && !h.records.length && !h.year.length
  if (empty) return (
    <div className="space-y-6">
      <EmptyState icon={Trophy} title="Đại sảnh còn trống" description="Bài chạy hợp lệ của thành viên sẽ tự ghi danh: Half / Full Marathon, kỷ lục CLB, cột mốc km." />
      <DrawPanel scope="CLUB" refId={clubId} canManage={isStaff} />
    </div>
  )
  return (
    <div className="space-y-6 pb-8">
      <DrawPanel scope="CLUB" refId={clubId} canManage={isStaff} />
      <Finishers title="Full Marathon" emoji="🏅" rows={h.marathon} />
      <Finishers title="Half Marathon" emoji="🥈" rows={h.half} />
      {h.records.length > 0 && <Records rows={h.records} />}
      {h.year.length > 0 && <YearBoard year={h.year} start={h.year_start} />}
      {h.milestones.length > 0 && (
        <Fold title="Cột mốc gần đây" count={h.milestones.length}>
          <ul className="space-y-1.5">
            {h.milestones.map((m) => (
              <li key={`${m.user_id}-${m.code}`} className="flex items-center gap-3 rounded-xl bg-surface-2 px-3 py-2 text-sm">
                <Sparkles className="size-4 shrink-0 text-coin" aria-hidden />
                <span className="min-w-0 flex-1"><b>{m.name}</b> {m.label}</span>
                <span className="shrink-0 text-xs text-fg-subtle">{formatRelative(m.reached_at)}</span>
              </li>
            ))}
          </ul>
        </Fold>
      )}
      <p className="text-xs text-fg-subtle">Chỉ tính bài chạy hợp lệ và đang chia sẻ. Kỷ lục ước tính từ bài có cự ly sát mốc (≤ +5%).</p>
    </div>
  )
}

/** Mục thu gọn / mở rộng: bấm tiêu đề để ẩn hoặc hiện danh sách */
function Fold({ title, count, defaultOpen = true, children }: { title: ReactNode; count?: number; defaultOpen?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
        className="mb-2 flex w-full items-center gap-2 text-left">
        <span className="min-w-0 flex-1 text-sm font-bold">{title}{count !== undefined && <span className="ml-1.5 font-normal text-fg-muted">· {formatNumber(count)}</span>}</span>
        <ChevronDown className={cn('size-5 shrink-0 text-fg-subtle transition-transform', open && 'rotate-180')} aria-hidden />
      </button>
      {open && children}
    </section>
  )
}

function Finishers({ title, emoji, rows }: { title: string; emoji: string; rows: HallOfFame['marathon'] }) {
  const [all, setAll] = useState(false)
  const [pick, setPick] = useState<HallFinisher | null>(null)
  if (!rows.length) return null
  const shown = all ? rows : rows.slice(0, FINISHER_PREVIEW)
  return (
    <Fold title={`${emoji} ${title}`} count={rows.length}>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {shown.map((r) => (
          <button key={r.user_id} type="button" onClick={() => setPick(r)} className="text-left" aria-label={`Xem thành tích của ${r.name}`}>
            <Card className="flex items-center gap-2 p-3 transition-colors hover:border-brand">
              <Avatar src={r.avatar_url} name={r.name} size="md" />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{r.name}</p>
                <p className="text-[11px] text-fg-muted">
                  {r.times > 1 ? `${r.times} lần · ` : ''}{r.best_s ? `PB ${formatDuration(r.best_s)}` : new Date(r.first_at).toLocaleDateString('vi-VN')}
                </p>
              </div>
            </Card>
          </button>
        ))}
      </div>
      {rows.length > FINISHER_PREVIEW && (
        <button type="button" onClick={() => setAll((v) => !v)} className="mt-2 w-full rounded-xl py-2 text-sm font-semibold text-brand hover:bg-surface-2">
          {all ? 'Thu gọn' : `Xem tất cả ${formatNumber(rows.length)} người`}
        </button>
      )}
      {pick && <BestSheet title={title} person={pick} onClose={() => setPick(null)} />}
    </Fold>
  )
}

/** 3 thành tích tốt nhất của một VĐV ở cự ly Full / Half */
function BestSheet({ title, person, onClose }: { title: string; person: HallFinisher; onClose: () => void }) {
  const top = person.top3 ?? []
  return (
    <Sheet open onClose={onClose} title={person.name} description={`3 thành tích ${title} tốt nhất · ${person.times} lần hoàn thành`}>
      {top.length ? (
        <ol className="space-y-2 pb-2">
          {top.map((b, i) => (
            <li key={`${b.at}-${i}`} className="flex items-center gap-3 rounded-xl border border-border bg-surface px-3 py-2.5">
              <span className={cn('w-6 text-center font-mono text-sm font-bold', MEDAL[i])}>{i + 1}</span>
              <span className="min-w-0 flex-1 text-sm text-fg-muted">{new Date(b.at).toLocaleDateString('vi-VN')} · {formatKm(b.km * 1000)} km</span>
              <span className="font-mono tabular font-bold">{formatDuration(b.best_s)}</span>
            </li>
          ))}
        </ol>
      ) : <p className="py-6 text-center text-sm text-fg-muted">Chưa có thành tích có thời gian hợp lệ.</p>}
      <p className="pb-2 text-xs text-fg-subtle">Thời gian ước tính quy về đúng cự ly từ bài chạy sát mốc (≤ +6%).</p>
    </Sheet>
  )
}

/** Km năm của mọi thành viên: dòng của mình luôn ghim phía trên, có ô tìm khi danh sách dài */
function YearBoard({ year, start }: { year: HallOfFame['year']; start: string }) {
  const me = useSession().session?.user.id
  const [term, setTerm] = useState('')
  const [all, setAll] = useState(false)
  const searching = term.trim().length > 0
  const matched = useMemo(() => filterSearch(year, term, (y) => [y.name]), [year, term])
  const list = searching || all ? matched : year.slice(0, YEAR_PREVIEW)
  const mine = year.find((y) => y.user_id === me)
  const mineVisible = !!mine && list.some((y) => y.user_id === me)
  const row = (y: HallOfFame['year'][number], pinned = false) => (
    <li key={`${pinned ? 'pin-' : ''}${y.user_id}`} id={pinned ? undefined : `hall-year-${y.user_id}`}
      className={cn('flex items-center gap-3 rounded-xl border bg-surface px-3 py-2', y.user_id === me ? 'border-brand bg-brand/5' : 'border-border')}>
      <span className={cn('w-6 text-center font-mono text-sm font-bold', MEDAL[y.rank - 1] ?? 'text-fg-muted')}>{y.rank}</span>
      <Avatar src={y.avatar_url} name={y.name} size="sm" />
      <span className="min-w-0 flex-1 truncate text-sm font-semibold">{y.name}{y.user_id === me && <span className="ml-1.5 text-xs font-normal text-brand">Bạn</span>}</span>
      <span className="text-xs text-fg-subtle">{y.runs} buổi</span>
      <span className="font-mono tabular font-bold">{formatKm(y.distance_m)}<span className="ml-0.5 text-xs text-fg-muted">km</span></span>
    </li>
  )
  return (
    <Fold title={`Km năm ${new Date(start).getFullYear()}`} count={year.length}>
      <div className="space-y-2">
        {year.length > YEAR_PREVIEW && (
          <RankSearch value={term} onChange={setTerm} total={year.length} matched={matched.length} placeholder="Tìm thành viên…"
            onFindMe={mine ? () => { setAll(true); setTimeout(() => scrollToRow(`hall-year-${mine.user_id}`), 50) } : undefined} />
        )}
        {mine && !mineVisible && <ol>{row(mine, true)}</ol>}
        <ol className="space-y-1.5">{list.map((y) => row(y))}</ol>
        {!searching && year.length > YEAR_PREVIEW && (
          <button type="button" onClick={() => setAll((v) => !v)} className="w-full rounded-xl py-2 text-sm font-semibold text-brand hover:bg-surface-2">
            {all ? 'Thu gọn' : `Xem tất cả ${formatNumber(year.length)} thành viên`}
          </button>
        )}
      </div>
    </Fold>
  )
}
function Records({ rows }: { rows: HallOfFame['records'] }) {
  const groups = ['5K', '10K', '21K', '42K'].map((l) => ({ label: l, rows: rows.filter((r) => r.label === l) })).filter((g) => g.rows.length)
  return (
    <Fold title={<span className="inline-flex items-center gap-1.5"><Timer className="size-4" aria-hidden />Kỷ lục CLB</span>}>
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
    </Fold>
  )
}
