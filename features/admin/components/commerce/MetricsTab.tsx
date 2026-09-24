'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, CheckCircle2, Minus } from 'lucide-react'
import { BarChart, Card, ErrorState, SegmentedControl, Skeleton, StatTile } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { formatVnd } from '@/shared/lib/economy'
import { formatCoin, formatNumber } from '@/shared/lib/format'
import { adminErrorMessage } from '../../api/adminApi'
import { getEconomyMetrics } from '../../api/commerceApi'
import { deriveMetrics, type MetricsMonth } from '../../model/metrics'

const pct = (v: number | null) => (v === null ? '—' : `${Math.round(v * 100)}%`)
const monthLabel = (m: string) => `T${Number(m.slice(5))}/${m.slice(2, 4)}`

type Level = 'ok' | 'warn' | 'none'
function Status({ level }: { level: Level }) {
  if (level === 'none') return <span className="flex items-center gap-1 text-xs text-fg-subtle"><Minus className="size-3.5" aria-hidden />Chưa đủ dữ liệu</span>
  return level === 'ok'
    ? <span className="flex items-center gap-1 text-xs text-success"><CheckCircle2 className="size-3.5" aria-hidden />Ổn</span>
    : <span className="flex items-center gap-1 text-xs text-warning"><AlertTriangle className="size-3.5" aria-hidden />Cần xem</span>
}

/** Chỉ số kinh tế: Xu phát ra / đốt, doanh thu, lượt tạo, đơn hàng, duyệt bài — kèm ngưỡng cảnh báo của đặc tả */
export function MetricsTab() {
  const [months, setMonths] = useState<6 | 12>(6)
  const q = useQuery({ queryKey: ['admin', 'metrics', months], queryFn: () => getEconomyMetrics(months) })
  if (q.isPending) return <Skeleton className="h-96" />
  if (q.isError) return <ErrorState message={adminErrorMessage(q.error)} onRetry={() => void q.refetch()} />
  const list = q.data.months
  const cur = list.at(-1) as MetricsMonth
  const d = deriveMetrics(cur)
  const s = q.data.snapshot
  const check = (v: number | null, bad: (x: number) => boolean): Level => (v === null ? 'none' : bad(v) ? 'warn' : 'ok')
  const rows: { label: string; value: string; rule: string; level: Level }[] = [
    { label: 'Tỉ lệ Xu đốt / Xu phát ra', value: d.ratio === null ? '—' : d.ratio.toFixed(2), rule: '0,5 – 1,5', level: check(d.ratio, (x) => x < 0.5 || x > 1.5) },
    { label: 'Xu phát ra / người chạy', value: d.perRunner === null ? '—' : formatCoin(Math.round(d.perRunner)), rule: '≤ 300 Xu/tháng', level: check(d.perRunner, (x) => x > 300) },
    { label: 'Tỉ lệ dùng lượt tạo', value: pct(d.creditUse), rule: '≥ 30%', level: check(d.creditUse, (x) => x < 0.3) },
    { label: 'Thời gian xác nhận đơn TB', value: cur.confirm_hours === null ? '—' : `${formatNumber(cur.confirm_hours)} giờ`, rule: '≤ 24 giờ', level: check(cur.confirm_hours, (x) => x > 24) },
    { label: 'Đơn quá hạn chưa trả', value: pct(d.expiredShare), rule: '≤ 40%', level: check(d.expiredShare, (x) => x > 0.4) },
    { label: 'Bài chạy chờ duyệt', value: pct(d.reviewShare), rule: '≤ 5%', level: check(d.reviewShare, (x) => x > 0.05) },
  ]
  return (
    <div className="space-y-4">
      <SegmentedControl value={String(months) as '6' | '12'} onChange={(v) => setMonths(Number(v) as 6 | 12)}
        options={[{ value: '6', label: '6 tháng' }, { value: '12', label: '12 tháng' }]} />

      <div className="grid grid-cols-2 gap-2">
        <StatTile label="Xu đang lưu hành" value={formatCoin(Math.round(s.supply))} tone="coin" />
        <StatTile label="Ví có Xu" value={formatNumber(s.holders)} />
        <StatTile label="Số dư trung vị" value={formatCoin(Math.round(s.median_balance))} unit="Xu" />
        <StatTile label="Số dư top 10%" value={formatCoin(Math.round(s.p90_balance))} unit="Xu" />
      </div>

      <Card className="space-y-2">
        <p className="text-sm font-semibold">Tháng này ({monthLabel(cur.month)}) so với ngưỡng</p>
        <ul className="divide-y divide-border text-sm">
          {rows.map((r) => (
            <li key={r.label} className="flex items-center gap-3 py-2">
              <span className="min-w-0 flex-1"><span className="block">{r.label}</span><span className="block text-xs text-fg-subtle">Ngưỡng {r.rule}</span></span>
              <span className="font-mono font-semibold">{r.value}</span>
              <span className="w-28 shrink-0"><Status level={r.level} /></span>
            </li>
          ))}
        </ul>
      </Card>

      <Card className="space-y-2">
        <p className="text-sm font-semibold">Xu phát ra và Xu bị đốt mỗi tháng</p>
        <BarChart labels={list.map((m) => monthLabel(m.month))} tickEvery={months === 12 ? 2 : 1}
          series={[{ name: 'Phát ra (chạy, chuỗi, giới thiệu, lên cấp)', values: list.map((m) => deriveMetrics(m).earned) },
                   { name: 'Đốt (phí tạo, quà, cửa hàng)', values: list.map((m) => deriveMetrics(m).burned) }]}
          format={(v) => formatCoin(Math.round(v))} caption="Xu phát ra và Xu bị đốt theo tháng" />
      </Card>

      <Card className="space-y-2">
        <p className="text-sm font-semibold">Doanh thu đơn đã xác nhận</p>
        <BarChart labels={list.map((m) => monthLabel(m.month))} tickEvery={months === 12 ? 2 : 1}
          series={[{ name: 'Doanh thu', values: list.map((m) => m.revenue_vnd) }]}
          format={(v) => (v >= 1_000_000 ? `${formatNumber(Math.round(v / 100_000) / 10)}tr` : formatVnd(v))} caption="Doanh thu theo tháng (VNĐ)" />
        <p className="text-xs text-fg-subtle">Tháng này: {formatVnd(cur.revenue_vnd)} · gói {formatVnd(cur.revenue_plan_vnd)} · nạp Xu {formatVnd(cur.revenue_vnd - cur.revenue_plan_vnd)} · {cur.orders_paid} đơn · {cur.subs_active} gói còn hạn</p>
      </Card>

      <Card className="space-y-2">
        <p className="text-sm font-semibold">Chi tiết theo tháng</p>
        <div className="-mx-1 overflow-x-auto">
          <table className="w-full min-w-[34rem] text-xs">
            <thead className="text-fg-subtle">
              <tr>{['Tháng', 'Chạy', 'Chuỗi/điểm danh', 'Giới thiệu', 'Lên cấp', 'Admin', 'Nạp', 'Phí tạo', 'Quà', 'Cửa hàng', 'Người chạy'].map((h) => (
                <th key={h} className={cn('px-1 py-1 font-medium', h === 'Tháng' ? 'text-left' : 'text-right')}>{h}</th>))}</tr>
            </thead>
            <tbody>
              {[...list].reverse().map((m) => (
                <tr key={m.month} className="border-t border-border font-mono">
                  <td className="px-1 py-1.5 font-sans">{monthLabel(m.month)}</td>
                  {[m.earn_run, m.earn_game, m.earn_referral, m.earn_level, m.admin_net, m.purchased, m.burn_fee, m.burn_gift, m.burn_shop].map((v, i) => (
                    <td key={i} className="px-1 py-1.5 text-right">{formatCoin(Math.round(v))}</td>))}
                  <td className="px-1 py-1.5 text-right">{formatNumber(m.active_runners)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-fg-subtle">Đơn vị Xu. Phát ra đã trừ thu hồi; không tính bút toán đổi tỉ giá ×10.</p>
      </Card>
    </div>
  )
}
