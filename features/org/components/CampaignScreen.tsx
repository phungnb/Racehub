'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Award, CalendarRange, CheckCircle2, Download, EyeOff, Lock, Palette, Pencil, ShieldCheck, Target, XCircle, Zap } from 'lucide-react'
import { toast } from 'sonner'
import { Avatar, Button, ConfirmSheet, ErrorState, Input, SegmentedControl, Sheet, Skeleton } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { routes } from '@/shared/config/routes'
import { DrawPanel } from '@/features/draw'
import type { StoredCert } from '@/features/race'
import {
  cancelCampaign, getCampaignBoard, lockCampaign, orgErrorMessage, reviewCampaignResult,
  type BoardGroup, type BoardPerson, type CampaignBoard, type CampaignMetric,
} from '../api/orgApi'
import { campaignPhase, downloadCsv, fmtDay, fmtValue, METRIC, PHASE_LABEL, unitOptions } from '../model/org'
import { CampaignFormSheet } from './tabs/CampaignsTab'
import { CampaignCertDesigner, CampaignCertificateSheet } from './CampaignCert'

const MEDAL = ['text-medal-gold', 'text-medal-silver', 'text-medal-bronze']
type View = 'people' | 'units' | 'clubs'

/** Bảng xếp hạng chiến dịch: cá nhân / đơn vị (nhiều cấp) / CLB, chốt + duyệt top N, chứng nhận, quay thưởng */
export function CampaignScreen({ orgId, campaignId }: { orgId: string; campaignId: string }) {
  const qc = useQueryClient()
  const key = ['org', orgId, 'campaign', campaignId]
  const q = useQuery({ queryKey: key, queryFn: () => getCampaignBoard(campaignId) })
  const [view, setView] = useState<View>('people')
  const [done, setDone] = useState<'all' | 'done' | 'not'>('all')
  const [sheet, setSheet] = useState<'edit' | 'cancel' | 'lock' | 'design' | 'cert' | null>(null)
  const [reviewing, setReviewing] = useState<BoardPerson | null>(null)
  const [now] = useState(() => Date.now())
  const refresh = () => void qc.invalidateQueries({ queryKey: ['org', orgId] })
  const cancelM = useMutation({
    mutationFn: () => cancelCampaign(campaignId),
    onSuccess: () => { toast.success('Đã huỷ chiến dịch'); refresh(); setSheet(null) },
    onError: (e) => toast.error(orgErrorMessage(e)),
  })
  const lockM = useMutation({
    mutationFn: () => lockCampaign(campaignId),
    onSuccess: (r) => { toast.success(r.pending ? `Đã chốt — ${r.pending} người chờ duyệt` : 'Đã chốt kết quả'); refresh(); setSheet(null) },
    onError: (e) => toast.error(orgErrorMessage(e)),
  })
  if (q.isPending) return <div className="space-y-3"><Skeleton className="h-40" /><Skeleton className="h-72" /></div>
  if (q.isError) return <ErrorState message={orgErrorMessage(q.error)} error={q.error} onRetry={() => void q.refetch()} />
  const b = q.data
  const c = b.campaign
  const m = c.metric
  const phase = campaignPhase(c, now)
  const pct = c.goal_total ? Math.min(100, (Number(b.total) / Number(c.goal_total)) * 100) : null
  const views = [...(b.hidden ? [] : [{ value: 'people' as View, label: 'Cá nhân' }]),
    ...(b.units.length ? [{ value: 'units' as View, label: 'Đơn vị' }] : []),
    ...(b.clubs.length ? [{ value: 'clubs' as View, label: 'CLB' }] : [])]
  const cur: View = views.some((v) => v.value === view) ? view : views[0]?.value ?? 'people'
  const people = b.people.filter((p) => done === 'all' || (done === 'done' ? p.completed : !p.completed))
  const certReady = c.cert_enabled && !!b.me && (c.goal_per_person ? b.me.completed : phase === 'ENDED' && Number(b.me.value) > 0)

  return (
    <div className="space-y-4 pb-8">
      <Link href={routes.org(orgId)} className="inline-flex items-center gap-1 text-sm text-fg-muted hover:text-fg"><ArrowLeft className="size-4" aria-hidden />{c.org_name}</Link>
      <header className="space-y-2 rounded-2xl border border-border bg-gradient-to-br from-brand/15 via-surface to-surface p-4">
        <div className="flex items-start gap-2">
          <h1 className="min-w-0 flex-1 text-xl font-bold leading-tight">{c.title}</h1>
          <span className={cn('flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold', b.locked ? 'bg-coin/20 text-coin' : 'bg-surface-2')}>
            {b.locked && <Lock className="size-3" aria-hidden />}{b.locked ? 'Đã chốt' : PHASE_LABEL[phase]}
          </span>
        </div>
        <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-fg-muted">
          <span className="flex items-center gap-1"><CalendarRange className="size-3.5" aria-hidden />{fmtDay(c.starts_at)} → {fmtDay(new Date(Date.parse(c.ends_at) - 1).toISOString())}</span>
          <span>{METRIC[m].label}{c.min_run_km > 0 ? ` · mỗi bài ≥ ${c.min_run_km} km` : ''}{c.daily_cap_km ? ` · tối đa ${c.daily_cap_km} km/ngày` : ''}</span>
        </p>
        {c.boost_days.length > 0 && (
          <p className="flex flex-wrap items-center gap-1.5 text-xs">
            <Zap className="size-3.5 text-coin" aria-hidden />Ngày hội:
            {c.boost_days.map((d) => <span key={d.date} className="rounded-full bg-coin/15 px-2 py-0.5 font-semibold text-coin">{fmtDay(`${d.date}T00:00:00+07:00`)} ×{d.mult}</span>)}
          </p>
        )}
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
                ? b.me.completed ? 'Đã đạt mục tiêu cá nhân 🎉' : `Còn ${fmtValue(Number(c.goal_per_person) - Number(b.me.value), m)} để đạt mục tiêu`
                : `${b.me.runs} buổi · ${b.me.active_days} ngày chạy`}
            </p>
          </div>
          {certReady && <Button size="sm" variant="coin" onClick={() => setSheet('cert')}><Award className="size-4" aria-hidden />Chứng nhận</Button>}
        </div>
      )}

      {b.is_admin && b.locked && !!b.pending_reviews && (
        <p className="flex items-start gap-2 rounded-xl border border-coin/40 bg-coin/10 p-3 text-sm">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-coin" aria-hidden />{b.pending_reviews} người top đầu chờ bạn xác nhận hợp lệ trước khi trao giải / quay thưởng.
        </p>
      )}
      {b.hidden && (
        <p className="flex items-start gap-2 rounded-xl bg-surface-2 p-3 text-sm text-fg-muted">
          <EyeOff className="mt-0.5 size-4 shrink-0" aria-hidden />Tổ chức bật chế độ riêng tư: bạn thấy thứ hạng của mình và bảng xếp hạng theo đơn vị.
        </p>
      )}

      {views.length > 1 && <SegmentedControl value={cur} onChange={setView} options={views} />}
      {cur === 'people' && !b.hidden && (
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
              <li key={p.user_id} className={cn('flex items-center gap-3 rounded-xl border bg-surface px-3 py-2', p.review_status === 'PENDING' ? 'border-coin/50' : 'border-border')}>
                <span className={cn('w-7 text-center font-mono text-sm font-bold', MEDAL[p.rank - 1] ?? 'text-fg-muted')}>{p.rank}</span>
                <Avatar src={p.avatar_url} name={p.name} size="sm" />
                <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{p.name}</span>
                  {p.unit_name && <span className="block truncate text-xs text-fg-subtle">{p.unit_name}</span>}</span>
                {c.goal_per_person && (p.completed
                  ? <CheckCircle2 className="size-4 shrink-0 text-brand" aria-label="Hoàn thành" />
                  : <XCircle className="size-4 shrink-0 text-fg-subtle" aria-label="Chưa hoàn thành" />)}
                <span className="font-mono text-sm font-bold tabular-nums">{fmtValue(p.value, m)}</span>
                {b.is_admin && p.review_status === 'PENDING' && <Button size="sm" variant="secondary" onClick={() => setReviewing(p)}>Duyệt</Button>}
                {b.is_admin && b.locked && p.review_status === 'OK' && p.rank <= c.review_top && <ShieldCheck className="size-4 shrink-0 text-brand" aria-label="Đã xác nhận" />}
              </li>
            ))}
          </ol>
          {b.is_admin && !!b.disqualified?.length && (
            <div className="rounded-xl border border-danger/30 bg-danger/5 p-3 text-sm">
              <p className="font-semibold text-danger">Đã loại ({b.disqualified.length})</p>
              {b.disqualified.map((d) => <p key={d.user_id} className="text-xs text-fg-muted">{d.name} · {fmtValue(d.value, m)} — {d.note}</p>)}
            </div>
          )}
        </>
      )}
      {cur === 'units' && <UnitRanking rows={b.units} metric={m} />}
      {cur === 'clubs' && <GroupList rows={b.clubs} metric={m} />}

      <DrawPanel scope="ORG_CAMPAIGN" refId={campaignId} canManage={b.is_admin} />

      {b.is_admin && (
        <div className="grid grid-cols-2 gap-2 pt-2">
          <Button variant="secondary" onClick={() => exportBoard(b)}><Download className="size-4" aria-hidden />Xuất CSV</Button>
          {c.cert_enabled && <Button variant="secondary" onClick={() => setSheet('design')}><Palette className="size-4" aria-hidden />Mẫu chứng nhận</Button>}
          {!b.locked && phase === 'ENDED' && <Button onClick={() => setSheet('lock')}><Lock className="size-4" aria-hidden />Chốt kết quả</Button>}
          {!b.locked && <Button variant="secondary" onClick={() => setSheet('edit')}><Pencil className="size-4" aria-hidden />Sửa</Button>}
          {!b.locked && <Button variant="danger" onClick={() => setSheet('cancel')}>Huỷ chiến dịch</Button>}
        </div>
      )}
      {sheet === 'edit' && <CampaignFormSheet orgId={orgId} campaign={c} onClose={() => { setSheet(null); void q.refetch() }} />}
      {sheet === 'design' && <CampaignCertDesigner orgId={orgId} onClose={() => setSheet(null)}
        campaign={{ id: c.id, title: c.title, org_name: c.org_name, metric: m, ends_at: c.ends_at, cert_design: c.cert_design as StoredCert | null }} />}
      {sheet === 'cert' && <CampaignCertificateSheet campaignId={campaignId} onClose={() => setSheet(null)} />}
      {reviewing && <ReviewSheet campaignId={campaignId} p={reviewing} metric={m} onClose={() => { setReviewing(null); refresh() }} />}
      <ConfirmSheet open={sheet === 'lock'} onClose={() => setSheet(null)} danger={false} title="Chốt kết quả chiến dịch?"
        description={`Bảng xếp hạng được cố định (bài chạy nộp muộn không còn tính).${c.review_top ? ` Top ${c.review_top} chờ bạn xác nhận trước khi trao giải.` : ''}`}
        confirmLabel="Chốt kết quả" loading={lockM.isPending} onConfirm={() => lockM.mutate()} />
      <ConfirmSheet open={sheet === 'cancel'} onClose={() => setSheet(null)} title="Huỷ chiến dịch?" description="Chiến dịch ẩn khỏi danh sách. Bài chạy của mọi người không bị ảnh hưởng."
        confirmLabel="Huỷ chiến dịch" loading={cancelM.isPending} onConfirm={() => cancelM.mutate()} />
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl bg-surface-2/70 p-2"><p className="truncate font-mono text-sm font-bold">{value}</p><p className="text-[11px] text-fg-subtle">{label}</p></div>
}

function ReviewSheet({ campaignId, p, metric, onClose }: { campaignId: string; p: BoardPerson; metric: CampaignMetric; onClose: () => void }) {
  const [note, setNote] = useState('')
  const act = useMutation({
    mutationFn: (ok: boolean) => reviewCampaignResult(campaignId, p.user_id, ok, note),
    onSuccess: (_, ok) => { toast.success(ok ? 'Đã xác nhận hợp lệ' : 'Đã loại khỏi kết quả'); onClose() },
    onError: (e) => toast.error(orgErrorMessage(e)),
  })
  return (
    <Sheet open onClose={onClose} title={`Duyệt kết quả #${p.rank}: ${p.name}`}
      description={`${fmtValue(p.value, metric)} · ${fmtValue(p.km, 'DISTANCE')} · ${p.runs} buổi · ${p.active_days} ngày. Bài chạy đã qua bộ lọc GPS / pace; loại nếu có dấu hiệu bất thường.`}
      footer={<div className="grid grid-cols-2 gap-2">
        <Button variant="danger" loading={act.isPending && act.variables === false} disabled={note.trim().length < 3} onClick={() => act.mutate(false)}>Loại</Button>
        <Button loading={act.isPending && act.variables === true} onClick={() => act.mutate(true)}><ShieldCheck className="size-4" aria-hidden />Hợp lệ</Button>
      </div>}>
      <div className="space-y-2">
        <Input value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder="Lý do nếu loại (bắt buộc), vd: bài 42 km pace bất thường" aria-label="Lý do" />
      </div>
    </Sheet>
  )
}

/** Xếp hạng đơn vị theo cấp (Vùng → Chi nhánh → Phòng); tổng đã cộng dồn đơn vị con */
function UnitRanking({ rows, metric }: { rows: BoardGroup[]; metric: CampaignMetric }) {
  const tree = useMemo(() => unitOptions(rows.map((r) => ({ ...r, parent_id: r.parent_id ?? null }))), [rows])
  const levels = Math.max(1, ...tree.map((u) => u.depth + 1))
  const [lvl, setLvl] = useState(0)
  const at = tree.filter((u) => u.depth === Math.min(lvl, levels - 1)).map((u) => ({ ...u, name: u.depth ? u.path : u.name }))
  return (
    <div className="space-y-2">
      {levels > 1 && (
        <div className="flex gap-1.5">
          {Array.from({ length: levels }, (_, i) => (
            <button key={i} type="button" aria-pressed={lvl === i} onClick={() => setLvl(i)}
              className={cn('rounded-full border px-3 py-1 text-xs font-semibold', lvl === i ? 'border-brand bg-brand text-brand-fg' : 'border-border text-fg-muted')}>Cấp {i + 1}</button>
          ))}
        </div>
      )}
      <GroupList rows={at} metric={metric} />
    </div>
  )
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
  downloadCsv(`chien-dich-${b.campaign.title.slice(0, 30)}.csv`, ['Hạng', 'Họ tên', 'Đơn vị', METRIC[m].label, 'Km', 'Số buổi', 'Số ngày', 'Hoàn thành', 'Duyệt'],
    b.people.map((p) => [p.rank, p.name, p.unit_name ?? '', String(p.value).replace('.', ','), String(p.km).replace('.', ','), p.runs, p.active_days,
      p.completed ? 'Có' : '', p.review_status === 'PENDING' ? 'Chờ duyệt' : p.review_status === 'OK' && b.locked ? 'Hợp lệ' : '']))
}
