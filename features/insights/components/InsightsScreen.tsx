'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { Crown, Download, FileText, Lock, Medal, Printer } from 'lucide-react'
import { toast } from 'sonner'
import { useMyProfile } from '@/features/auth'
import { isSystemAdmin } from '@/features/admin'
import { useMyPlan } from '@/features/billing'
import { BarChart, Button, Card, EmptyState, ErrorState, SegmentedControl, Skeleton, StatTile } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { formatNumber } from '@/shared/lib/format'
import { routes } from '@/shared/config/routes'
import { exportActivities, getPerformance, getTrends, insightsErrorMessage, type Period } from '../api/insightsApi'
import { bestEfforts, fmtDuration, fmtPace, paceHistogram, summarize, toCsv, type ExportRow } from '../model/insights'
import { printReport } from './printReport'

type Tab = 'trends' | 'records' | 'report'
const NEED: Record<Tab, number> = { trends: 1, records: 2, report: 3 }
const TABS = [{ value: 'trends' as Tab, label: 'Xu hướng' }, { value: 'records' as Tab, label: 'Kỷ lục & pace' }, { value: 'report' as Tab, label: 'Báo cáo' }]
const km1 = (v: number) => formatNumber(Math.round(v * 10) / 10)

/** Mức VIP hiện tại (0 = miễn phí); admin xem được tất cả */
export function useVipTier() {
  const { profile } = useMyProfile()
  const mine = useMyPlan()
  const plan = mine.data?.plan
  const tier = isSystemAdmin(profile) ? 3 : plan && plan.plan_code.startsWith('VIP') ? Number(plan.tier) : 0
  return { tier, loading: mine.isLoading }
}

function Locked({ need }: { need: number }) {
  return (
    <Card className="space-y-3 text-center">
      <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-coin/15 text-coin"><Lock className="size-5" aria-hidden /></span>
      <p className="font-semibold">Dành cho VIP{need} trở lên</p>
      <p className="text-sm text-fg-muted">
        {need === 1 ? 'Xem km, số buổi, thời gian theo 12 tuần và 12 tháng gần nhất.'
          : need === 2 ? 'Kỷ lục 1K → Marathon từ dữ liệu từng km, phân bố pace, nhân bản thử thách cũ.'
          : 'Xuất toàn bộ bài chạy ra Excel (CSV) và bản báo cáo in / lưu PDF.'}
      </p>
      <Link href={routes.plan} className="mx-auto inline-flex h-11 items-center gap-2 rounded-xl bg-coin px-4 font-semibold text-bg">
        <Crown className="size-4" aria-hidden />Xem gói VIP
      </Link>
    </Card>
  )
}

/** Phân tích cá nhân (/me/insights): xu hướng (VIP1), kỷ lục & pace (VIP2), báo cáo (VIP3). Máy chủ kiểm tra lại bậc VIP. */
export function InsightsScreen() {
  const params = useSearchParams()
  const router = useRouter()
  const t = params.get('tab')
  const tab: Tab = t === 'records' || t === 'report' ? t : 'trends'
  const vip = useVipTier()
  const setTab = (v: Tab) => router.replace(v === 'trends' ? routes.insights : `${routes.insights}?tab=${v}`, { scroll: false })
  return (
    <div className="space-y-4">
      <SegmentedControl value={tab} onChange={setTab} options={TABS} />
      {vip.loading ? <Skeleton className="h-64" />
        : vip.tier < NEED[tab] ? <Locked need={NEED[tab]} />
        : tab === 'trends' ? <TrendsTab /> : tab === 'records' ? <RecordsTab /> : <ReportTab />}
    </div>
  )
}

function change(cur: number, prev: number) {
  if (!prev) return cur ? 'mới' : '—'
  const p = Math.round(((cur - prev) / prev) * 100)
  return `${p > 0 ? '+' : ''}${p}%`
}

function TrendsTab() {
  const [by, setBy] = useState<'weeks' | 'months'>('weeks')
  const q = useQuery({ queryKey: ['insights', 'trends'], queryFn: getTrends })
  if (q.isPending) return <Skeleton className="h-72" />
  if (q.isError) return <ErrorState message={insightsErrorMessage(q.error)} onRetry={() => void q.refetch()} />
  const list: Period[] = q.data[by]
  const cur = list.at(-1), prev = list.at(-2)
  const label = (p: Period) => {
    const d = new Date(p.start + 'T00:00:00')
    return by === 'weeks' ? `${d.getDate()}/${d.getMonth() + 1}` : `T${d.getMonth() + 1}`
  }
  const total = list.reduce((s, p) => ({ km: s.km + p.km, runs: s.runs + p.runs, mv: s.mv + p.moving_s }), { km: 0, runs: 0, mv: 0 })
  const active = list.filter((p) => p.runs > 0).length
  return (
    <div className="space-y-3">
      <SegmentedControl value={by} onChange={setBy} options={[{ value: 'weeks', label: '12 tuần' }, { value: 'months', label: '12 tháng' }]} />
      {cur && prev && (
        <div className="grid grid-cols-2 gap-2">
          <StatTile label={by === 'weeks' ? 'Tuần này' : 'Tháng này'} value={km1(cur.km)} unit={`km · ${change(cur.km, prev.km)}`} tone="brand" />
          <StatTile label="Số buổi" value={String(cur.runs)} unit={`kỳ trước ${prev.runs}`} />
          <StatTile label="Thời gian chạy" value={fmtDuration(cur.moving_s)} />
          <StatTile label="Pace TB" value={cur.km > 0 ? fmtPace(cur.moving_s / cur.km) : '—'} unit="/km" />
        </div>
      )}
      <Card className="space-y-2">
        <p className="text-sm font-semibold">Km mỗi {by === 'weeks' ? 'tuần' : 'tháng'}</p>
        <BarChart labels={list.map(label)} series={[{ name: 'Km', values: list.map((p) => p.km) }]} format={km1}
          caption={`Km mỗi ${by === 'weeks' ? 'tuần, 12 tuần gần nhất' : 'tháng, 12 tháng gần nhất'}`} />
      </Card>
      <Card className="space-y-1 text-sm">
        <p className="font-semibold">Tổng {by === 'weeks' ? '12 tuần' : '12 tháng'}</p>
        <p className="text-fg-muted">{km1(total.km)} km · {total.runs} buổi · {fmtDuration(total.mv)} · chạy đều {active}/{list.length} {by === 'weeks' ? 'tuần' : 'tháng'}</p>
        <p className="text-fg-muted">Trung bình {km1(total.km / list.length)} km mỗi {by === 'weeks' ? 'tuần' : 'tháng'}{total.km > 0 ? ` · pace ${fmtPace(total.mv / total.km)}/km` : ''}</p>
      </Card>
    </div>
  )
}

function RecordsTab() {
  const q = useQuery({ queryKey: ['insights', 'performance'], queryFn: getPerformance })
  const efforts = useMemo(() => (q.data ? bestEfforts(q.data) : []), [q.data])
  const hist = useMemo(() => (q.data ? paceHistogram(q.data) : []), [q.data])
  if (q.isPending) return <Skeleton className="h-72" />
  if (q.isError) return <ErrorState message={insightsErrorMessage(q.error)} onRetry={() => void q.refetch()} />
  if (!q.data.length) return <EmptyState icon={Medal} title="Chưa có bài chạy nào" description="Kỷ lục được tính từ các bài chạy đã được ghi nhận trong 3 năm gần nhất." />
  const splits = q.data.reduce((s, r) => s + r.splits.length, 0)
  return (
    <div className="space-y-3">
      <Card className="space-y-2">
        <p className="text-sm font-semibold">Kỷ lục cá nhân</p>
        <ul className="divide-y divide-border">
          {efforts.map((e) => (
            <li key={e.key}>
              <Link href={routes.activity(e.runId)} className="flex items-center gap-3 py-2.5">
                <Medal className="size-4 shrink-0 text-coin" aria-hidden />
                <span className="w-28 shrink-0 text-sm font-semibold">{e.label}</span>
                <span className="font-mono font-bold">{fmtDuration(e.seconds)}</span>
                <span className="ml-auto text-right text-xs text-fg-muted">
                  {fmtPace(e.seconds / e.km)}/km · {new Date(e.date).toLocaleDateString('vi-VN')}
                  {e.estimated && <span className="block text-fg-subtle">ước tính theo pace TB</span>}
                </span>
              </Link>
            </li>
          ))}
        </ul>
        {!efforts.length && <p className="text-sm text-fg-muted">Chưa đủ dữ liệu — cần bài chạy từ 1 km.</p>}
        <p className="text-xs text-fg-subtle">Tính từ {q.data.length} bài, {formatNumber(splits)} km có dữ liệu từng km (Strava). Bài không có dữ liệu từng km được ước tính theo pace trung bình.</p>
      </Card>
      <Card className="space-y-2">
        <p className="text-sm font-semibold">Phân bố pace từng km</p>
        <BarChart labels={hist.map((b) => fmtPace(b.from))} series={[{ name: 'Số km', values: hist.map((b) => b.count) }]}
          format={(v) => formatNumber(Math.round(v))} tickEvery={4} caption="Số km chạy theo từng mức pace, ô 15 giây" />
        <p className="text-xs text-fg-subtle">Cột đầu gộp mọi km nhanh hơn 3:00, cột cuối gộp km chậm hơn 8:45.</p>
      </Card>
    </div>
  )
}

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

function ReportTab() {
  const { profile } = useMyProfile()
  const now = new Date()
  const ranges = [
    { key: 'y0', label: `Năm ${now.getFullYear()}`, from: `${now.getFullYear()}-01-01`, to: iso(now) },
    { key: 'y1', label: `Năm ${now.getFullYear() - 1}`, from: `${now.getFullYear() - 1}-01-01`, to: `${now.getFullYear() - 1}-12-31` },
    { key: '12m', label: '12 tháng qua', from: iso(new Date(now.getFullYear() - 1, now.getMonth(), now.getDate() + 1)), to: iso(now) },
  ]
  const [key, setKey] = useState('y0')
  const r = ranges.find((x) => x.key === key)!
  const q = useQuery({ queryKey: ['insights', 'export', r.from, r.to], queryFn: () => exportActivities(r.from, r.to) })
  const s = useMemo(() => (q.data ? summarize(q.data) : null), [q.data])
  const download = (rows: ExportRow[]) => {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' }))
    a.download = `racehub-${r.from}-${r.to}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Khoảng thời gian">
        {ranges.map((x) => (
          <button key={x.key} role="radio" aria-checked={key === x.key} onClick={() => setKey(x.key)}
            className={cn('rounded-full border px-3 py-1.5 text-sm font-semibold', key === x.key ? 'border-brand bg-brand/10' : 'border-border text-fg-muted')}>{x.label}</button>
        ))}
      </div>
      {q.isPending ? <Skeleton className="h-48" /> : q.isError ? <ErrorState message={insightsErrorMessage(q.error)} onRetry={() => void q.refetch()} /> : s && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <StatTile label="Tổng km" value={km1(s.km)} tone="brand" />
            <StatTile label="Số buổi" value={String(s.runs)} />
            <StatTile label="Thời gian chạy" value={fmtDuration(s.moving_s)} />
            <StatTile label="Pace TB" value={s.km ? fmtPace(s.pace) : '—'} unit="/km" />
          </div>
          <Card className="space-y-2">
            <p className="text-sm font-semibold">Theo tháng</p>
            {!s.months.length ? <p className="text-sm text-fg-muted">Không có bài chạy trong khoảng này.</p> : (
              <table className="w-full text-sm">
                <thead className="text-xs text-fg-subtle"><tr><th className="py-1 text-left font-medium">Tháng</th><th className="py-1 text-right font-medium">Buổi</th><th className="py-1 text-right font-medium">Km</th><th className="py-1 text-right font-medium">Pace</th></tr></thead>
                <tbody>
                  {s.months.map((m) => (
                    <tr key={m.month} className="border-t border-border">
                      <td className="py-1.5">{m.month.slice(5)}/{m.month.slice(0, 4)}</td>
                      <td className="py-1.5 text-right font-mono">{m.runs}</td>
                      <td className="py-1.5 text-right font-mono">{km1(m.km)}</td>
                      <td className="py-1.5 text-right font-mono">{m.km ? fmtPace(m.moving_s / m.km) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" disabled={!q.data.length} onClick={() => download(q.data)}><Download className="size-4" aria-hidden />Tải Excel (CSV)</Button>
            <Button disabled={!q.data.length} onClick={() => { if (!printReport({ name: profile?.display_name ?? 'Runner', range: r.label, rows: q.data, summary: s })) toast.error('Trình duyệt chặn cửa sổ in — hãy cho phép popup.') }}>
              <Printer className="size-4" aria-hidden />In / lưu PDF
            </Button>
          </div>
          <p className="flex items-center gap-1.5 text-xs text-fg-subtle"><FileText className="size-3.5" aria-hidden />Chỉ gồm bài đã được ghi nhận (không tính bài chờ duyệt hoặc bị từ chối).</p>
        </>
      )}
    </div>
  )
}
