'use client'

import Link from 'next/link'
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarRange, Flag, Plus, Target, Trash2, Users } from 'lucide-react'
import { toast } from 'sonner'
import { Button, EmptyState, ErrorState, Field, Input, Sheet, Skeleton, SwitchRow, Textarea } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { routes } from '@/shared/config/routes'
import { listCampaigns, orgErrorMessage, saveCampaign, type BoostDay, type Campaign, type CampaignMetric, type OrgDetail } from '../../api/orgApi'
import { campaignPhase, fmtDay, fmtValue, METRIC, PHASE_LABEL, toDayInput, vnDayStart } from '../../model/org'

const PHASE_CLS = { LIVE: 'bg-brand/15 text-brand', UPCOMING: 'bg-coin/15 text-coin', ENDED: 'bg-surface-2 text-fg-muted' } as const

export function CampaignsTab({ org }: { org: OrgDetail }) {
  const q = useQuery({ queryKey: ['org', org.id, 'campaigns'], queryFn: () => listCampaigns(org.id) })
  const [editing, setEditing] = useState<Campaign | 'new' | null>(null)
  const [now] = useState(() => Date.now())
  return (
    <div className="space-y-3">
      {org.is_admin && org.active && (
        <Button block onClick={() => setEditing('new')}><Plus className="size-4" aria-hidden />Tạo chiến dịch</Button>
      )}
      {q.isPending ? <div className="space-y-2"><Skeleton className="h-32" /><Skeleton className="h-32" /></div>
        : q.isError ? <ErrorState message={orgErrorMessage(q.error)} error={q.error} onRetry={() => void q.refetch()} />
        : !q.data.length ? (
          <EmptyState icon={Flag} title="Chưa có chiến dịch" description={org.is_admin
            ? 'Tạo chiến dịch đầu tiên — ví dụ “Tháng 10 chạy 5.000 km cùng công ty”. Bài chạy hợp lệ của mọi người được tính tự động.'
            : 'Khi tổ chức mở chiến dịch, bài chạy hợp lệ của bạn sẽ tự được tính.'} />
        ) : (
          <ul className="space-y-3">
            {q.data.map((c) => {
              const phase = campaignPhase(c, now)
              const pct = c.goal_total ? Math.min(100, (Number(c.total) / Number(c.goal_total)) * 100) : null
              return (
                <li key={c.id}>
                  <Link href={routes.orgCampaign(org.id, c.id)} className="block space-y-2 rounded-2xl border border-border bg-surface p-4 hover:border-fg-subtle">
                    <div className="flex items-start gap-2">
                      <h3 className="min-w-0 flex-1 font-semibold">{c.title}</h3>
                      <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold', PHASE_CLS[phase])}>{PHASE_LABEL[phase]}</span>
                    </div>
                    <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-fg-muted">
                      <span className="flex items-center gap-1"><CalendarRange className="size-3.5" aria-hidden />{fmtDay(c.starts_at)} → {fmtDay(c.ends_at)}</span>
                      <span className="flex items-center gap-1"><Users className="size-3.5" aria-hidden />{c.active}/{c.participants} người đã chạy</span>
                      <span>{METRIC[c.metric].label}</span>
                    </p>
                    <p className="flex items-baseline justify-between gap-2">
                      <span className="font-mono text-xl font-bold">{fmtValue(c.total, c.metric)}</span>
                      {c.my_value != null && <span className="text-xs text-fg-muted">Bạn: <b className="text-fg">{fmtValue(c.my_value, c.metric)}</b></span>}
                    </p>
                    {pct !== null && (
                      <div>
                        <div className="h-2 overflow-hidden rounded-full bg-surface-2"><div className="h-full rounded-full bg-brand" style={{ width: `${pct}%` }} /></div>
                        <p className="mt-1 flex items-center gap-1 text-xs text-fg-subtle"><Target className="size-3.5" aria-hidden />Mục tiêu chung {fmtValue(c.goal_total, c.metric)} · {Math.floor(pct)}%</p>
                      </div>
                    )}
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      {editing && <CampaignFormSheet orgId={org.id} campaign={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  )
}

export function CampaignFormSheet({ orgId, campaign, onClose }: { orgId: string; campaign: Campaign | null; onClose: () => void }) {
  const qc = useQueryClient()
  const [title, setTitle] = useState(campaign?.title ?? '')
  const [desc, setDesc] = useState(campaign?.description ?? '')
  const [metric, setMetric] = useState<CampaignMetric>(campaign?.metric ?? 'DISTANCE')
  const [from, setFrom] = useState(() => campaign ? toDayInput(campaign.starts_at) : toDayInput(new Date().toISOString()))
  const [to, setTo] = useState(() => campaign ? toDayInput(new Date(Date.parse(campaign.ends_at) - 1).toISOString()) : toDayInput(new Date(Date.now() + 29 * 86400_000).toISOString()))
  const [goalTotal, setGoalTotal] = useState(campaign?.goal_total ? String(campaign.goal_total) : '')
  const [goalEach, setGoalEach] = useState(campaign?.goal_per_person ? String(campaign.goal_per_person) : '')
  const [minKm, setMinKm] = useState(String(campaign?.min_run_km ?? 1))
  const [cap, setCap] = useState(campaign?.daily_cap_km ? String(campaign.daily_cap_km) : '')
  const [reviewTop, setReviewTop] = useState(String(campaign?.review_top ?? 0))
  const [boostOn, setBoostOn] = useState(!!campaign?.boost_days?.length)
  const [boost, setBoost] = useState<BoostDay[]>(campaign?.boost_days ?? [])
  const [cert, setCert] = useState(campaign?.cert_enabled ?? true)
  const num = (v: string) => (v.trim() ? Number(v.replace(',', '.')) : null)
  const save = useMutation({
    mutationFn: () => saveCampaign(orgId, campaign?.id ?? null, {
      title: title.trim(), description: desc.trim() || null, metric,
      starts_at: vnDayStart(from), ends_at: new Date(Date.parse(vnDayStart(to)) + 86400_000).toISOString(),
      goal_total: num(goalTotal), goal_per_person: num(goalEach), min_run_km: num(minKm) ?? 1,
      daily_cap_km: num(cap), review_top: Number(reviewTop) || 0, boost_days: boostOn ? boost.filter((b) => b.date) : [], cert_enabled: cert,
    }),
    onSuccess: () => {
      toast.success(campaign ? 'Đã lưu chiến dịch' : 'Đã tạo chiến dịch và báo cho mọi người')
      void qc.invalidateQueries({ queryKey: ['org', orgId] })
      onClose()
    },
    onError: (e) => toast.error(orgErrorMessage(e)),
  })
  const valid = title.trim().length >= 3 && !!from && !!to && to >= from
  const unit = METRIC[metric].unit
  return (
    <Sheet open onClose={onClose} title={campaign ? 'Sửa chiến dịch' : 'Tạo chiến dịch'}
      description="Tính tự động từ bài chạy hợp lệ, đang chia sẻ của thành viên tổ chức và thành viên các CLB thuộc tổ chức."
      footer={<Button block onClick={() => save.mutate()} loading={save.isPending} disabled={!valid}>{campaign ? 'Lưu' : 'Tạo & thông báo'}</Button>}>
      <div className="space-y-4">
        <Field label="Tên chiến dịch" htmlFor="c-title"><Input id="c-title" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} placeholder="Tháng 10 — cả công ty chạy 5.000 km" /></Field>
        <div role="radiogroup" aria-label="Cách tính" className="grid gap-2">
          {(Object.keys(METRIC) as CampaignMetric[]).map((m) => (
            <button key={m} type="button" role="radio" aria-checked={metric === m} onClick={() => setMetric(m)}
              className={cn('rounded-xl border p-3 text-left', metric === m ? 'border-brand/60 bg-brand/10' : 'border-border')}>
              <span className="block text-sm font-semibold">{METRIC[m].label}</span>
              <span className="block text-xs text-fg-muted">{METRIC[m].hint}</span>
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Từ ngày" htmlFor="c-from"><Input id="c-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="Đến hết ngày" htmlFor="c-to"><Input id="c-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label={`Mục tiêu chung (${unit})`} htmlFor="c-gt" hint="Không bắt buộc"><Input id="c-gt" inputMode="decimal" value={goalTotal} onChange={(e) => setGoalTotal(e.target.value)} placeholder="5000" /></Field>
          <Field label={`Mỗi người (${unit})`} htmlFor="c-ge" hint="Đạt = “hoàn thành”"><Input id="c-ge" inputMode="decimal" value={goalEach} onChange={(e) => setGoalEach(e.target.value)} placeholder="30" /></Field>
        </div>
        <Field label="Mỗi bài tối thiểu (km)" htmlFor="c-min" hint="Bài ngắn hơn không tính — tránh ghi nhận cho có">
          <Input id="c-min" inputMode="decimal" value={minKm} onChange={(e) => setMinKm(e.target.value)} />
        </Field>
        <div className="space-y-3 rounded-xl border border-border p-3">
          <p className="text-sm font-semibold">Công bằng & chống gian lận</p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Trần km mỗi ngày" htmlFor="c-cap" hint="Để trống = không giới hạn"><Input id="c-cap" inputMode="decimal" value={cap} onChange={(e) => setCap(e.target.value)} placeholder="30" /></Field>
            <Field label="Duyệt top trước khi trao" htmlFor="c-rev" hint="0 = không cần"><Input id="c-rev" inputMode="numeric" value={reviewTop} onChange={(e) => setReviewTop(e.target.value.replace(/\D/g, '').slice(0, 3))} /></Field>
          </div>
          <p className="text-xs text-fg-subtle">Khi kết thúc, bấm “Chốt kết quả”: bảng xếp hạng được cố định, top N chờ bạn xác nhận hợp lệ hoặc loại (có lý do) trước khi trao giải / quay thưởng.</p>
        </div>
        <div className="space-y-2 rounded-xl border border-border p-3">
          <SwitchRow checked={boostOn} onChange={setBoostOn} label="Ngày hội ×2 / ×3" description="Km (hoặc số buổi) trong ngày hội được nhân hệ số — ví dụ ngày chạy đồng loạt toàn công ty." />
          {boostOn && (
            <div className="space-y-2">
              {boost.map((b, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input type="date" value={b.date} min={from} max={to} onChange={(e) => setBoost(boost.map((x, j) => (j === i ? { ...x, date: e.target.value } : x)))} aria-label={`Ngày hội ${i + 1}`} />
                  {([2, 3] as const).map((m) => (
                    <button key={m} type="button" aria-pressed={b.mult === m} onClick={() => setBoost(boost.map((x, j) => (j === i ? { ...x, mult: m } : x)))}
                      className={cn('h-11 shrink-0 rounded-xl border px-3 text-sm font-bold', b.mult === m ? 'border-coin bg-coin text-brand-fg' : 'border-border')}>×{m}</button>
                  ))}
                  <Button variant="ghost" size="sm" aria-label="Xoá ngày" onClick={() => setBoost(boost.filter((_, j) => j !== i))}><Trash2 className="size-4" aria-hidden /></Button>
                </div>
              ))}
              {boost.length < 20 && <Button size="sm" variant="secondary" onClick={() => setBoost([...boost, { date: from, mult: 2 }])}><Plus className="size-4" aria-hidden />Thêm ngày hội</Button>}
            </div>
          )}
        </div>
        <SwitchRow checked={cert} onChange={setCert} label="Cấp chứng nhận hoàn thành" description="Người đạt mục tiêu (hoặc có chạy, nếu không đặt mục tiêu) tải được chứng nhận. Thiết kế mẫu ở trang chiến dịch." />
        <Field label="Mô tả / thể lệ" htmlFor="c-desc">
          <Textarea id="c-desc" value={desc} maxLength={2000} onChange={(e) => setDesc(e.target.value)} placeholder="Giải thưởng, cách trao, lưu ý…" />
        </Field>
      </div>
    </Sheet>
  )
}
