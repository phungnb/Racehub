'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Flag, Lock, Trophy } from 'lucide-react'
import { toast } from 'sonner'
import { Avatar, Button, Card, ClockPicker, EmptyState, ErrorState, RankSearch, Skeleton, ScrollRow } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { filterSearch } from '@/shared/lib/search'
import { challengeErrorMessage, getConquestBoard, setMyConquest, type ChallengeDetail, type ConquestBoard, type ConquestCategory } from '../../api/challengeApi'
import { challengeKeys } from '../../hooks/useChallenge'
import { formatClock, kmLabel, parseClock } from '../../model/challenge'
import { DoneFilter, useDoneFilter } from './DoneFilter'

const targetText = (b: ConquestBoard, s: number | null) => (s ? `${formatClock(s)}${b.objective === 'BEST_PACE' ? '/km' : ''}` : '—')
const resultText = (b: ConquestBoard, time: number | null, pace: number | null) =>
  b.objective === 'BEST_PACE' ? (pace ? `${formatClock(pace)}/km` : '—') : formatClock(time)

/** Chinh phục thời gian / pace: đăng ký hạng mục của tôi + BXH theo từng hạng mục */
export function ConquestPanel({ d, onPick }: { d: ChallengeDetail; onPick: (userId: string) => void }) {
  const c = d.challenge
  const q = useQuery({ queryKey: challengeKeys.conquest(c.id), queryFn: () => getConquestBoard(c.id) })
  const [cat, setCat] = useState<string | null>(null)
  if (q.isPending) return <Skeleton className="h-60" />
  if (q.isError) return <ErrorState message={challengeErrorMessage(q.error)} error={q.error} onRetry={() => void q.refetch()} />
  const b = q.data
  const joined = !!d.me && d.me.status !== 'LEFT'
  // Mở sẵn hạng mục mình đã đăng ký (không phải luôn hạng mục đầu tiên — người chọn 21K mở ra phải thấy 21K)
  const mineFirst = joined ? b.categories.find((x) => b.mine.some((m) => m.category_id === x.id))?.id : undefined
  const active = cat ?? mineFirst ?? b.categories[0]?.id ?? null
  return (
    <div className="space-y-4">
      {joined && <MyCategories d={d} b={b} />}
      {b.categories.length > 0 && (
        <ScrollRow innerClassName="gap-2 pb-1" role="tablist" aria-label="Hạng mục">
          {b.categories.map((x) => (
            <button key={x.id} role="tab" aria-selected={active === x.id} onClick={() => setCat(x.id)}
              className={cn('flex min-h-10 shrink-0 flex-col items-start rounded-xl border px-3 py-1.5 text-left',
                active === x.id ? 'border-brand bg-brand/10' : 'border-border bg-surface')}>
              <span className="text-sm font-semibold">{x.label}</span>
              <span className="text-[11px] text-fg-muted">{x.achieved}/{x.entrants} đạt{x.target_s ? ` · ≤ ${targetText(b, x.target_s)}` : ''}</span>
            </button>
          ))}
        </ScrollRow>
      )}
      {active && <CategoryBoard b={b} cat={b.categories.find((x) => x.id === active)!} onPick={onPick} />}
    </div>
  )
}

function MyCategories({ d, b }: { d: ChallengeDetail; b: ConquestBoard }) {
  const c = d.challenge
  const qc = useQueryClient()
  const [now] = useState(() => Date.now())
  const started = now >= Date.parse(c.start_date)
  const mine = new Map(b.mine.map((m) => [m.category_id, m]))
  // Đã đăng ký rồi mà có kết quả ở cự ly nào thì không sửa đăng ký cự ly đó (máy chủ chặn CONQUEST_RESULT_LOCKED)
  const resultLocked = new Set(b.mine.length ? b.my_results ?? [] : [])
  const [picked, setPicked] = useState<Record<string, string>>(() =>
    Object.fromEntries(b.mine.map((m) => [m.category_id, m.target_s ? formatClock(m.target_s) : ''])))
  const [editing, setEditing] = useState(b.mine.length === 0)
  const save = useMutation({
    mutationFn: () => setMyConquest(c.id, Object.entries(picked).map(([id, t]) => ({ category_id: id, target_s: b.mode === 'SELF' ? parseClock(t) : null }))),
    onSuccess: (board) => {
      qc.setQueryData(challengeKeys.conquest(c.id), board)
      void qc.invalidateQueries({ queryKey: challengeKeys.detail(c.id) })
      toast.success('Đã lưu hạng mục của bạn'); setEditing(false)
    },
    onError: (e) => toast.error(challengeErrorMessage(e)),
  })
  const pace = b.objective === 'BEST_PACE'
  if (!editing) {
    return (
      <Card className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="flex items-center gap-2 font-semibold"><Flag className="size-4 text-brand" aria-hidden />Hạng mục của bạn</p>
          <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>{started ? 'Thêm hạng mục' : 'Sửa'}</Button>
        </div>
        <ul className="space-y-1.5">
          {b.categories.filter((x) => mine.has(x.id)).map((x) => {
            const m = mine.get(x.id)!
            return (
              <li key={x.id} className={cn('flex items-center gap-2 rounded-xl px-3 py-2 text-sm', m.achieved ? 'bg-coin/10' : 'bg-surface-2/60')}>
                <span className="flex-1"><b>{x.label}</b> <span className="text-fg-muted">· {b.mode === 'ANY' ? 'đạt cự ly' : `mục tiêu ${targetText(b, m.target_s ?? x.target_s)}`}</span></span>
                <span className="font-mono font-bold">{resultText(b, m.best_time_s, m.best_pace_s)}</span>
                {m.achieved ? <Trophy className="size-4 text-coin" aria-label="Đã đạt" /> : null}
              </li>
            )
          })}
        </ul>
      </Card>
    )
  }
  return (
    <Card className="space-y-3 border-brand/40">
      <p className="flex items-center gap-2 font-semibold"><Flag className="size-4 text-brand" aria-hidden />Chọn hạng mục bạn muốn chinh phục</p>
      <p className="text-xs text-fg-muted">
        {b.mode === 'SELF' ? `Cuộn chọn ${pace ? 'pace (phút · giây mỗi km)' : 'thời gian (giờ · phút · giây)'} mục tiêu của bạn cho từng hạng mục. ` : ''}
        {started ? 'Thử thách đã bắt đầu: bạn thêm được hạng mục mới, nhưng không bỏ hay đổi mục tiêu đã đăng ký.' : 'Đổi được tới giờ xuất phát.'}
        {resultLocked.size > 0 && ' Hạng mục đã có kết quả thì không sửa đăng ký được nữa.'}
      </p>
      <ul className="space-y-2">
        {b.categories.map((x) => {
          const on = x.id in picked
          const hasResult = resultLocked.has(x.id)
          const locked = (started && mine.has(x.id)) || hasResult
          return (
            <li key={x.id} className={cn('rounded-xl border p-2.5', on ? 'border-brand/60 bg-brand/5' : 'border-border')}>
              <label className="flex items-center gap-3">
                <input type="checkbox" checked={on} disabled={locked} className="size-5 accent-[var(--color-brand)]"
                  onChange={(e) => setPicked((p) => {
                    const n = { ...p }
                    // Gợi ý sẵn: mục tiêu của hạng mục, không có thì pace 6:00/km — người chạy chỉ cần cuộn chỉnh
                    if (e.target.checked) n[x.id] = formatClock(x.target_s ?? (pace ? 360 : Math.max(60, Math.round((x.distance_m / 1000) * 6) * 60)))
                    else delete n[x.id]
                    return n
                  })} />
                <span className="flex-1"><span className="block font-semibold">{x.label}</span>
                  <span className="block text-xs text-fg-muted">{kmLabel(x.distance_m / 1000)}{x.target_s ? ` · mục tiêu ${targetText(b, x.target_s)}` : ''}</span>
                  {hasResult && <span className="block text-xs text-warning">Bạn đã có kết quả ở cự ly này — không sửa đăng ký được</span>}</span>
                {locked && <Lock className="size-4 text-fg-subtle" aria-label="Đã khóa" />}
              </label>
              {on && b.mode === 'SELF' && (
                <ClockPicker className="mt-2" mode={pace ? 'pace' : 'time'} disabled={locked} label={`Mục tiêu ${x.label}`}
                  maxHours={Math.max(3, Math.ceil((x.distance_m / 1000) * 12 / 60))}
                  value={parseClock(picked[x.id] ?? '')} onChange={(sec) => setPicked((p) => ({ ...p, [x.id]: formatClock(sec) }))} />
              )}
            </li>
          )
        })}
      </ul>
      <div className="flex gap-2">
        {b.mine.length > 0 && <Button variant="secondary" onClick={() => setEditing(false)}>Hủy</Button>}
        <Button block loading={save.isPending}
          disabled={!Object.keys(picked).length || (b.mode === 'SELF' && Object.values(picked).some((t) => parseClock(t) === null))}
          onClick={() => save.mutate()}>Lưu hạng mục</Button>
      </div>
    </Card>
  )
}

function CategoryBoard({ b, cat, onPick }: { b: ConquestBoard; cat: ConquestCategory; onPick: (userId: string) => void }) {
  const [q, setQ] = useState('')
  const [done, setDone] = useDoneFilter()
  const all = b.rows.filter((r) => r.category_id === cat.id)
  const byDone = done === 'ALL' ? all : all.filter((r) => (done === 'DONE') === r.achieved)
  const list = filterSearch(byDone, q, (r) => [r.display_name])
  if (!all.length) return <EmptyState icon={Trophy} title="Chưa ai đăng ký hạng mục này" description="Tham gia và chọn hạng mục để lên bảng." />
  return (
    <section className="space-y-2">
      <DoneFilter mode={done} onChange={setDone} ended={false} total={all.length} done={all.filter((r) => r.achieved).length} />
      {all.length > 5 && <RankSearch value={q} onChange={setQ} total={byDone.length} matched={list.length} />}
      <ol className="divide-y divide-border rounded-[var(--radius-card)] border border-border bg-surface">
        {list.map((r) => (
          <li key={r.user_id}>
            <button type="button" onClick={() => onPick(r.user_id)} className={cn('flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-surface-2', r.me && 'bg-brand/10')}>
              <span className={cn('w-6 text-center font-mono text-sm font-bold', r.rank === 1 ? 'text-medal-gold' : r.rank === 2 ? 'text-medal-silver' : r.rank === 3 ? 'text-medal-bronze' : 'text-fg-muted')}>{r.rank ?? '—'}</span>
              <Avatar src={r.avatar_url} name={r.display_name} size="sm" />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5 truncate text-sm font-semibold">{r.me ? 'Bạn' : r.display_name ?? 'Runner'}
                  {r.achieved && <Check className="size-4 shrink-0 text-coin" aria-label="Đã đạt mục tiêu" />}</span>
                <span className="block text-xs text-fg-subtle">{b.mode === 'ANY' ? 'Đạt cự ly' : `Mục tiêu ${targetText(b, r.target_s)}`}{r.best_at ? ` · ${new Date(r.best_at).toLocaleDateString('vi-VN')}` : ''}</span>
              </span>
              <span className={cn('font-mono text-sm font-bold', r.achieved ? 'text-coin' : 'text-fg')}>{resultText(b, r.best_time_s, r.best_pace_s)}</span>
            </button>
          </li>
        ))}
      </ol>
      <p className="text-xs text-fg-subtle">
        Kết quả lấy bài chạy tốt nhất có cự ly ≥ {kmLabel(cat.distance_m / 1000)}, quy đổi theo pace trung bình của bài. Bấm một người để xem từng ngày.
      </p>
    </section>
  )
}
