'use client'

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown, Download, Lock, Trophy } from 'lucide-react'
import { toast } from 'sonner'
import { Avatar, BarChart, Button, ErrorState, SegmentedControl, Skeleton } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { formatNumber } from '@/shared/lib/format'
import { downloadXlsx } from '@/shared/lib/excel'
import { getOrgOverview, orgErrorMessage, type OrgDetail, type OrgOverview } from '../../api/orgApi'
import { periodRange, rankUnits, rollUpUnits, type Period, type RankBy, type RolledUnit } from '../../model/overview'

const PERIODS: { value: Period; label: string }[] = [
  { value: 'week', label: 'Tuần' }, { value: 'month', label: 'Tháng' }, { value: '30d', label: '30 ngày' }, { value: 'year', label: 'Năm' },
]
const RANK_BY: { value: RankBy; label: string }[] = [{ value: 'total', label: 'Tổng km' }, { value: 'avg', label: 'Bình quân' }, { value: 'rate', label: 'Tham gia' }]
const km = (v: number) => formatNumber(Math.round(Number(v) * 10) / 10)
const MEDAL = ['🥇', '🥈', '🥉']

/** Tổng quan tổ chức: chỉ số phong trào, km theo ngày, BXH đơn vị (cộng dồn nhiều cấp) / CLB / cá nhân — mở đầu tiên khi vào tổ chức */
export function OverviewTab({ org }: { org: OrgDetail }) {
  const [period, setPeriod] = useState<Period>('month')
  const [by, setBy] = useState<RankBy>('total')
  const [now] = useState(() => new Date())
  const range = useMemo(() => periodRange(period, now), [period, now])
  const q = useQuery({ queryKey: ['org', org.id, 'overview', period], queryFn: () => getOrgOverview(org.id, range.from, range.to) })
  const units = useMemo(() => (q.data ? rollUpUnits(q.data.units) : []), [q.data])

  return (
    <div className="space-y-4">
      <SegmentedControl value={period} onChange={setPeriod} options={PERIODS} />
      {q.isPending ? <Skeleton className="h-96" /> : q.isError ? <ErrorState message={orgErrorMessage(q.error)} error={q.error} onRetry={() => void q.refetch()} /> : (
        <Body org={org} d={q.data} units={units} by={by} setBy={setBy} range={range} />
      )}
    </div>
  )
}

function Body({ org, d, units, by, setBy, range }: {
  org: OrgDetail; d: OrgOverview; units: RolledUnit[]; by: RankBy; setBy: (b: RankBy) => void; range: { from: string; to: string; label: string }
}) {
  const k = d.kpi
  const rate = k.people ? Math.round((k.active / k.people) * 100) : 0
  const days = useMemo(() => fillDays(d.days, range.from, range.to), [d.days, range.from, range.to])
  const clubs = d.clubs.map((c) => ({ ...c, km: Number(c.km) || 0, avg: c.members ? Number(c.km) / c.members : 0, rate: c.members ? Math.round((c.active / c.members) * 100) : 0 }))
  const exportAll = () => void downloadXlsx(`tong-quan-${org.name.slice(0, 30)}-${range.label}`, [
    { name: 'Chỉ số', head: ['Chỉ số', range.label], rows: [['Thành viên', k.people], ['Đã chạy', k.active], ['Tỷ lệ tham gia (%)', rate],
      ['Tổng km', Number(k.km)], ['Số buổi', k.runs], ['Km bình quân / người', Number(k.avg_km)]] },
    { name: org.unit_label, head: ['Hạng', org.unit_label, 'Cấp', 'Thành viên', 'Đã chạy', 'Tỷ lệ (%)', 'Tổng km', 'Km / người'],
      rows: flatten(units).map((u, i) => [i + 1, u.name, u.depth + 1, u.members, u.active, u.rate, u.km, u.avg]) },
    ...(clubs.length ? [{ name: 'CLB', head: ['Hạng', 'CLB', 'Thành viên', 'Đã chạy', 'Tỷ lệ (%)', 'Tổng km', 'Km / người'],
      rows: rankUnits(clubs, by).map((c, i) => [i + 1, c.name, c.members, c.active, c.rate, c.km, Math.round(c.avg * 100) / 100]) }] : []),
    ...(d.top.length ? [{ name: 'Top cá nhân', head: ['Hạng', 'Họ tên', org.unit_label, 'Km', 'Số buổi'],
      rows: d.top.map((t) => [t.rank, t.name, t.unit_name ?? '', Number(t.km), t.runs]) }] : []),
  ]).catch(() => toast.error('Không tạo được file Excel, thử lại.'))

  return (
    <>
      <div className="grid grid-cols-2 gap-2">
        <Kpi label="Tham gia" value={`${rate}%`} sub={`${formatNumber(k.active)}/${formatNumber(k.people)} người đã chạy`} accent />
        <Kpi label="Tổng km" value={km(k.km)} sub={`${formatNumber(k.runs)} buổi chạy`} />
        <Kpi label="Km bình quân" value={km(k.avg_km)} sub="mỗi thành viên" />
        <Kpi label="Hạng của bạn" value={d.me && Number(d.me.km) > 0 ? `#${d.me.rank}` : '—'} sub={d.me ? `${km(d.me.km)} km · ${d.me.runs} buổi` : 'Chưa có bài chạy'} />
      </div>

      <section className="rounded-2xl border border-border bg-surface p-3">
        <p className="mb-2 text-sm font-semibold">Km theo ngày · {range.label.toLowerCase()}</p>
        <BarChart labels={days.map((x) => x.label)} series={[{ name: 'Km', values: days.map((x) => x.km) }]} format={(v) => `${km(v)} km`}
          caption={`Tổng km cả tổ chức theo ngày, ${range.label.toLowerCase()}`} height={140} />
      </section>

      {units.length > 0 && (
        <section className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-bold">BXH {org.unit_label.toLowerCase()}</h3>
            <SegmentedControl value={by} onChange={setBy} options={RANK_BY} className="text-xs" />
          </div>
          <GroupList list={rankUnits(units, by)} by={by} expandable />
          <p className="text-[11px] text-fg-subtle">Số của đơn vị cấp trên đã cộng cả đơn vị con. Bình quân = tổng km ÷ số thành viên — công bằng giữa đơn vị đông và ít người.</p>
        </section>
      )}

      {clubs.length > 0 && (
        <section className="space-y-2">
          <h3 className="font-bold">BXH CLB thành viên</h3>
          <GroupList list={rankUnits(clubs, by)} by={by} />
        </section>
      )}

      <section className="space-y-2">
        <h3 className="flex items-center gap-2 font-bold"><Trophy className="size-4 text-coin" aria-hidden />Top cá nhân</h3>
        {d.hidden ? (
          <p className="flex items-start gap-2 rounded-xl bg-surface-2 p-3 text-sm text-fg-muted"><Lock className="mt-0.5 size-4 shrink-0" aria-hidden />
            Tổ chức bật chế độ riêng tư: chỉ ban quản trị xem được danh sách cá nhân. Bạn vẫn thấy thứ hạng của mình ở trên.</p>
        ) : !d.top.length ? <p className="rounded-xl bg-surface-2 p-3 text-sm text-fg-muted">Chưa có bài chạy nào trong khoảng này.</p> : (
          <ol className="divide-y divide-border rounded-2xl border border-border bg-surface">
            {d.top.map((t) => (
              <li key={t.user_id} className="flex items-center gap-3 px-3 py-2">
                <span className="w-7 text-center font-mono text-sm font-bold">{MEDAL[t.rank - 1] ?? t.rank}</span>
                <Avatar src={t.avatar_url} name={t.name} size="sm" />
                <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{t.name}</span>
                  <span className="block truncate text-xs text-fg-muted">{t.unit_name ?? ''}</span></span>
                <span className="text-right"><span className="block font-mono text-sm font-bold">{km(t.km)}</span><span className="block text-[11px] text-fg-subtle">{t.runs} buổi</span></span>
              </li>
            ))}
          </ol>
        )}
      </section>

      {d.is_admin && <Button block variant="secondary" onClick={exportAll}><Download className="size-4" aria-hidden />Xuất Excel tổng quan</Button>}
      <p className="text-[11px] text-fg-subtle">Chỉ tính bài chạy hợp lệ, đang chia sẻ. Gồm thành viên trực tiếp và thành viên các CLB thuộc tổ chức.</p>
    </>
  )
}

function Kpi({ label, value, sub, accent }: { label: string; value: string; sub: string; accent?: boolean }) {
  return (
    <div className={cn('rounded-2xl border p-3', accent ? 'border-brand/40 bg-brand/10' : 'border-border bg-surface')}>
      <p className="text-xs text-fg-muted">{label}</p>
      <p className="font-mono text-2xl font-bold">{value}</p>
      <p className="truncate text-[11px] text-fg-subtle">{sub}</p>
    </div>
  )
}

type Row = { id: string; name: string; members: number; active: number; km: number; avg: number; rate: number; avatar_url?: string | null; children?: RolledUnit[] }
function GroupList({ list, by, expandable }: { list: Row[]; by: RankBy; expandable?: boolean }) {
  const [open, setOpen] = useState<string | null>(null)
  const max = Math.max(1, ...list.map((x) => (by === 'total' ? x.km : by === 'avg' ? x.avg : x.rate)))
  return (
    <ol className="space-y-1.5">
      {list.map((u, i) => {
        const v = by === 'total' ? u.km : by === 'avg' ? u.avg : u.rate
        const kids = expandable ? rankUnits(u.children ?? [], by) : []
        return (
          <li key={u.id} className="rounded-xl border border-border bg-surface">
            <button type="button" disabled={!kids.length} onClick={() => setOpen(open === u.id ? null : u.id)} className="w-full px-3 py-2 text-left disabled:cursor-default">
              <div className="flex items-center gap-2">
                <span className="w-6 text-center font-mono text-sm font-bold">{MEDAL[i] ?? i + 1}</span>
                {u.avatar_url !== undefined && <Avatar src={u.avatar_url} name={u.name} size="xs" />}
                <span className="min-w-0 flex-1 truncate text-sm font-semibold">{u.name}</span>
                <span className="font-mono text-sm font-bold">{by === 'rate' ? `${u.rate}%` : `${km(v)} km`}</span>
                {kids.length > 0 && <ChevronDown className={cn('size-4 text-fg-subtle transition-transform', open === u.id && 'rotate-180')} aria-hidden />}
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-2"><div className="h-full rounded-full bg-brand" style={{ width: `${Math.max(2, (v / max) * 100)}%` }} /></div>
              <p className="mt-1 text-[11px] text-fg-subtle">{u.active}/{u.members} người đã chạy ({u.rate}%) · {by === 'avg' ? `tổng ${km(u.km)} km` : `bình quân ${km(u.avg)} km`}</p>
            </button>
            {open === u.id && kids.length > 0 && (
              <div className="border-t border-border px-2 py-2"><GroupList list={kids} by={by} expandable /></div>
            )}
          </li>
        )
      })}
    </ol>
  )
}

const flatten = (list: RolledUnit[]): RolledUnit[] => list.flatMap((u) => [u, ...flatten(u.children)])

/** Điền đủ các ngày trong khoảng (ngày không chạy = 0) để biểu đồ liền mạch */
function fillDays(days: { day: string; km: number }[], from: string, to: string) {
  const map = new Map(days.map((d) => [d.day, Number(d.km) || 0]))
  const out: { label: string; km: number }[] = []
  const start = Date.parse(from) + 7 * 3600_000, end = Math.min(Date.parse(to), Date.now() + 86400_000) + 7 * 3600_000
  for (let t = start; t < end && out.length < 400; t += 86400_000) {
    const iso = new Date(t).toISOString().slice(0, 10)
    out.push({ label: `${iso.slice(8, 10)}/${iso.slice(5, 7)}`, km: map.get(iso) ?? 0 })
  }
  return out
}
