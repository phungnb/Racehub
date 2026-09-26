'use client'

import Link from 'next/link'
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, CalendarRange, CheckCircle2, Download, Pencil, Target, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import { Avatar, Button, ConfirmSheet, ErrorState, SegmentedControl, Skeleton } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { routes } from '@/shared/config/routes'
import { cancelCampaign, getCampaignBoard, orgErrorMessage, type BoardGroup, type CampaignBoard, type CampaignMetric } from '../api/orgApi'
import { campaignPhase, downloadCsv, fmtDay, fmtValue, METRIC, PHASE_LABEL } from '../model/org'
import { CampaignFormSheet } from './tabs/CampaignsTab'

const MEDAL = ['text-medal-gold', 'text-medal-silver', 'text-medal-bronze']
type View = 'people' | 'units' | 'clubs'

/** Bảng xếp hạng chiến dịch: cá nhân / đơn vị / CLB, mục tiêu chung, tiến độ của tôi */
export function CampaignScreen({ orgId, campaignId }: { orgId: string; campaignId: string }) {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['org', orgId, 'campaign', campaignId], queryFn: () => getCampaignBoard(campaignId) })
  const [view, setView] = useState<View>('people')
  const [done, setDone] = useState<'all' | 'done' | 'not'>('all')
  const [edit, setEdit] = useState(false)
  const [cancel, setCancel] = useState(false)
  const [now] = useState(() => Date.now())
  const cancelM = useMutation({
    mutationFn: () => cancelCampaign(campaignId),
    onSuccess: () => { toast.success('Đã huỷ chiến dịch'); void qc.invalidateQueries({ queryKey: ['org', orgId] }); setCancel(false) },
    onError: (e) => toast.error(orgErrorMessage(e)),
  })
  if (q.isPending) return <div className="space-y-3"><Skeleton className="h-40" /><Skeleton className="h-72" /></div>
  if (q.isError) return <ErrorState message={orgErrorMessage(q.error)} error={q.error} onRetry={() => void q.refetch()} />
  const b = q.data
  const c = b.campaign
  const m = c.metric
  const phase = campaignPhase(c, now)
  const pct = c.goal_total ? Math.min(100, (Number(b.total) / Number(c.goal_total)) * 100) : null
  const views = [{ value: 'people' as View, label: 'Cá nhân' },
    ...(b.units.length ? [{ value: 'units' as View, label: 'Đơn vị' }] : []),
    ...(b.clubs.length ? [{ value: 'clubs' as View, label: 'CLB' }] : [])]
  const people = b.people.filter((p) => done === 'all' || (done === 'done' ? p.completed : !p.completed))

  return (
    <div className="space-y-4 pb-8">
      <Link href={routes.org(orgId)} className="inline-flex items-center gap-1 text-sm text-fg-muted hover:text-fg"><ArrowLeft className="size-4" aria-hidden />{c.org_name}</Link>
      <header className="space-y-2 rounded-2xl border border-border bg-gradient-to-br from-brand/15 via-surface to-surface p-4">
        <div className="flex items-start gap-2">
          <h1 className="min-w-0 flex-1 text-xl font-bold leading-tight">{c.title}</h1>
          <span className="shrink-0 rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-semibold">{PHASE_LABEL[phase]}</span>
        </div>
        <p className="flex flex-wrap gap-x-3 text-xs text-fg-muted">
          <span className="flex items-center gap-1"><CalendarRange className="size-3.5" aria-hidden />{fmtDay(c.starts_at)} → {fmtDay(new Date(Date.parse(c.ends_at) - 1).toISOString())}</span>
          <span>{METRIC[m].label}{c.min_run_km > 0 ? ` · mỗi bài ≥ ${c.min_run_km} km` : ''}</span>
        </p>
        <div className="grid grid-cols-3 gap-2 pt-1 text-center">
          <Stat label="Tổng" value={fmtValue(b.total, m)} />
          <Stat label="Đã chạy" value={`${b.active}/${b.participants}`} />
          <Stat label={c.goal_per_person ? 'Hoàn thành' : 'Tổng km'} value={c.goal_per_person ? String(b.completed) : fmtValue(b.total_km, 'DISTANCE')} />
        </div>
        {pct !== null && (
          <div>
            <div className="h-2.5 overflow-hidden rounded-full bg-surface-2"><div className="h-full rounded-full bg-brand" style={{ width: `${pct}%` }} /></div>
            <p className="mt-1 flex items-center gap-1 text-xs text-fg-muted"><Target className="size-3.5" aria-hidden />Mục tiêu chung {fmtValue(c.goal_total, m)} · {Math.floor(pct)}%</p>
          </div>
        )}
        {c.description && <p className="whitespace-pre-line pt-1 text-sm text-fg-muted">{c.description}</p>}
      </header>

      {b.me && (
        <div className="flex items-center gap-3 rounded-2xl border border-brand/40 bg-brand/10 p-3">
          <span className="grid size-10 place-items-center rounded-xl bg-brand font-mono font-bold text-brand-fg">#{b.me.rank}</span>
          <div className="min-w-0 flex-1 text-sm">
            <p className="font-semibold">Bạn: {fmtValue(b.me.value, m)}</p>
            <p className="text-xs text-fg-muted">
              {c.goal_per_person
                ? Number(b.me.value) >= Number(c.goal_per_person) ? 'Đã đạt mục tiêu cá nhân 🎉' : `Còn ${fmtValue(Number(c.goal_per_person) - Number(b.me.value), m)} để đạt mục tiêu`
                : `${b.me.runs} buổi · ${b.me.active_days} ngày chạy`}
            </p>
          </div>
        </div>
      )}

      {views.length > 1 && <SegmentedControl value={view} onChange={setView} options={views} />}
      {view === 'people' && (
        <>
          {c.goal_per_person && (
            <div className="flex gap-1.5">
              {([['all', 'Tất cả'], ['done', 'Hoàn thành'], ['not', 'Chưa hoàn thành']] as const).map(([k, l]) => (
                <button key={k} type="button" aria-pressed={done === k} onClick={() => setDone(k)}
                  className={cn('rounded-full border px-3 py-1 text-xs font-semibold', done === k ? 'border-brand bg-brand text-brand-fg' : 'border-border text-fg-muted')}>{l}</button>
              ))}
            </div>
          )}
          <ol className="space-y-1.5">
            {people.map((p) => (
              <li key={p.user_id} className="flex items-center gap-3 rounded-xl border border-border bg-surface px-3 py-2">
                <span className={cn('w-7 text-center font-mono text-sm font-bold', MEDAL[p.rank - 1] ?? 'text-fg-muted')}>{p.rank}</span>
                <Avatar src={p.avatar_url} name={p.name} size="sm" />
                <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{p.name}</span>
                  {p.unit_name && <span className="block truncate text-xs text-fg-subtle">{p.unit_name}</span>}</span>
                {c.goal_per_person && (p.completed
                  ? <CheckCircle2 className="size-4 shrink-0 text-brand" aria-label="Hoàn thành" />
                  : <XCircle className="size-4 shrink-0 text-fg-subtle" aria-label="Chưa hoàn thành" />)}
                <span className="font-mono text-sm font-bold tabular-nums">{fmtValue(p.value, m)}</span>
              </li>
            ))}
          </ol>
        </>
      )}
      {view === 'units' && <GroupList rows={b.units} metric={m} />}
      {view === 'clubs' && <GroupList rows={b.clubs} metric={m} />}

      {b.is_admin && (
        <div className="grid grid-cols-3 gap-2 pt-2">
          <Button variant="secondary" onClick={() => exportBoard(b)}><Download className="size-4" aria-hidden />CSV</Button>
          <Button variant="secondary" onClick={() => setEdit(true)}><Pencil className="size-4" aria-hidden />Sửa</Button>
          <Button variant="danger" onClick={() => setCancel(true)}>Huỷ</Button>
        </div>
      )}
      {edit && <CampaignFormSheet orgId={orgId} campaign={c} onClose={() => { setEdit(false); void q.refetch() }} />}
      <ConfirmSheet open={cancel} onClose={() => setCancel(false)} title="Huỷ chiến dịch?" description="Chiến dịch ẩn khỏi danh sách. Bài chạy của mọi người không bị ảnh hưởng."
        confirmLabel="Huỷ chiến dịch" loading={cancelM.isPending} onConfirm={() => cancelM.mutate()} />
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl bg-surface-2/70 p-2"><p className="truncate font-mono text-sm font-bold">{value}</p><p className="text-[11px] text-fg-subtle">{label}</p></div>
}

/** Xếp hạng nhóm: tổng + bình quân đầu người + tỷ lệ tham gia (công bằng giữa nhóm đông / ít người) */
function GroupList({ rows, metric }: { rows: BoardGroup[]; metric: CampaignMetric }) {
  const [by, setBy] = useState<'total' | 'avg'>('total')
  const sorted = [...rows].sort((a, b) => Number(b[by]) - Number(a[by]))
  return (
    <div className="space-y-2">
      <div className="flex gap-1.5">
        {([['total', 'Theo tổng'], ['avg', 'Bình quân / người']] as const).map(([k, l]) => (
          <button key={k} type="button" aria-pressed={by === k} onClick={() => setBy(k)}
            className={cn('rounded-full border px-3 py-1 text-xs font-semibold', by === k ? 'border-brand bg-brand text-brand-fg' : 'border-border text-fg-muted')}>{l}</button>
        ))}
      </div>
      <ol className="space-y-1.5">
        {sorted.map((g, i) => (
          <li key={g.id} className="rounded-xl border border-border bg-surface px-3 py-2">
            <div className="flex items-center gap-3">
              <span className={cn('w-7 text-center font-mono text-sm font-bold', MEDAL[i] ?? 'text-fg-muted')}>{i + 1}</span>
              <span className="min-w-0 flex-1 truncate text-sm font-semibold">{g.name}</span>
              <span className="font-mono text-sm font-bold">{fmtValue(g[by], metric)}</span>
            </div>
            <p className="ml-10 text-xs text-fg-subtle">
              {g.active}/{g.members} người đã chạy ({g.members ? Math.round((g.active / g.members) * 100) : 0}%) · {by === 'total' ? `bình quân ${fmtValue(g.avg, metric)}` : `tổng ${fmtValue(g.total, metric)}`}
            </p>
          </li>
        ))}
      </ol>
    </div>
  )
}

function exportBoard(b: CampaignBoard) {
  const m = b.campaign.metric
  downloadCsv(`chien-dich-${b.campaign.title.slice(0, 30)}.csv`, ['Hạng', 'Họ tên', 'Đơn vị', METRIC[m].label, 'Km', 'Số buổi', 'Số ngày', 'Hoàn thành'],
    b.people.map((p) => [p.rank, p.name, p.unit_name ?? '', String(p.value).replace('.', ','), String(p.km).replace('.', ','), p.runs, p.active_days, p.completed ? 'Có' : '']))
}
