'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown, Download, FlaskConical } from 'lucide-react'
import { toast } from 'sonner'
import { Button, Card, EmptyState, ErrorState, SegmentedControl, Skeleton } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { supabase } from '@/shared/lib/supabase'
import { formatDuration, formatKm } from '@/shared/lib/format'
import { downloadXlsx } from '@/shared/lib/excel'
import { badPct, errorPct, errorTone, GpsQualityCard, QA_SCENARIOS, qaLabel, type GpsQualityData } from '@/features/run'
import { consoleErrorMessage } from '../../api/consoleApi'

interface QaRun {
  activity_id: string; user_id: string; name: string; started_at: string; distance_m: number; moving_s: number; elapsed_s: number
  validation_status: string; data: GpsQualityData
}
interface QaList {
  runs: QaRun[]
  all: { runs: number; fixes: number; accepted: number; with_gaps: number; gap_s: number; trimmed: number; auto_stopped: number; acc_avg: number | null; by_platform: Record<string, number> }
}

async function adminGpsQa(days: number): Promise<QaList> {
  const { data, error } = await supabase.rpc('admin_gps_qa_list', { p_days: days })
  if (error) throw error
  return data as QaList
}

const TONE = { good: 'bg-success/15 text-success', ok: 'bg-warning/15 text-warning', bad: 'bg-danger/15 text-danger', none: 'bg-surface-2 text-fg-muted' } as const
const DAYS = [{ value: '30', label: '30 ngày' }, { value: '90', label: '90 ngày' }, { value: '365', label: '1 năm' }]
const pctText = (p: number | null) => (p === null ? '—' : `${p > 0 ? '+' : ''}${p}%`)

/**
 * Quản trị → Hệ thống → Kiểm thử GPS: kết quả chạy thử thực địa theo thiết bị × 11 kịch bản (bảng kiểm),
 * sai lệch so với quãng đường chuẩn, điểm hỏng, mất tín hiệu; thống kê chất lượng GPS mọi bài ghi bằng app.
 */
export function GpsQaTab() {
  const [days, setDays] = useState('90')
  const q = useQuery({ queryKey: ['admin', 'gps-qa', days], queryFn: () => adminGpsQa(Number(days)) })
  return (
    <div className="space-y-4">
      <Card className="space-y-2 text-sm text-fg-muted">
        <p className="flex items-center gap-2 font-semibold text-fg"><FlaskConical className="size-4 text-sky-400" aria-hidden />Cách kiểm thử</p>
        <p>Người test mở <b className="text-fg">/run?qa=1</b> (admin bấm nút <b className="text-fg">Kiểm thử GPS</b> ở màn Chạy), chạy theo một kịch bản,
          ở màn tổng kết chọn kịch bản + nhập quãng đường chuẩn (vòng sân, cột mốc, cung đường đo sẵn) rồi Lưu.
          Mỗi thiết bị nên chạy đủ 11 kịch bản; sai lệch ≤ 2 % là ngang đồng hồ GPS, ≤ 5 % chấp nhận được.</p>
      </Card>
      <SegmentedControl value={days} onChange={setDays} options={DAYS} />
      {q.isPending ? <Skeleton className="h-96" />
        : q.isError ? <ErrorState message={consoleErrorMessage(q.error, 'Không tải được. Đã chạy migration 008800 chưa?')} error={q.error} onRetry={() => void q.refetch()} />
          : <Body d={q.data} />}
    </div>
  )
}

function Body({ d }: { d: QaList }) {
  const a = d.all
  const devices = useMemo(() => {
    const m = new Map<string, QaRun[]>()
    for (const r of d.runs) {
      const k = r.data.device ?? 'Không rõ thiết bị'
      m.set(k, [...(m.get(k) ?? []), r])
    }
    return [...m.entries()].sort((x, y) => y[1].length - x[1].length)
  }, [d.runs])
  const exportXlsx = () => void downloadXlsx(`kiem-thu-gps-${new Date().toISOString().slice(0, 10)}`, [{
    name: 'Kiểm thử GPS',
    head: ['Ngày', 'Người test', 'Thiết bị', 'Nền tảng', 'Kịch bản', 'RaceHub (km)', 'Chuẩn (km)', 'Sai lệch (%)', 'Điểm nhận', 'Điểm dùng', 'Điểm hỏng (%)',
      'Sai số TB (m)', 'Mất tín hiệu (lần)', 'Mất tín hiệu (giây)', 'Ẩn app (lần)', 'Ẩn app (giây)', 'Tự tạm dừng', 'Bỏ đứng yên cuối (giây)', 'Thời gian chạy (giây)', 'Tổng thời gian (giây)', 'Ghi chú'],
    rows: d.runs.map((r) => [new Date(r.started_at).toLocaleString('vi-VN'), r.name, r.data.device ?? '', r.data.platform ?? '', qaLabel(r.data.qa?.scenario),
      Math.round(Number(r.distance_m)) / 1000, r.data.qa?.ref_m ? r.data.qa.ref_m / 1000 : null, errorPct(Number(r.distance_m), r.data.qa?.ref_m),
      r.data.fixes ?? 0, r.data.accepted ?? 0, badPct(r.data), r.data.acc_avg ?? null, r.data.gaps ?? 0, r.data.gap_s ?? 0, r.data.hidden ?? 0, r.data.hidden_s ?? 0,
      r.data.auto_pauses ?? 0, r.data.trimmed_s ?? 0, r.moving_s, r.elapsed_s, r.data.qa?.note ?? '']),
  }]).catch(() => toast.error('Không tạo được file Excel, thử lại.'))

  return (
    <>
      <section className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Bài ghi bằng app" value={String(a.runs)} sub={Object.entries(a.by_platform).map(([k, n]) => `${k === 'web' ? 'trình duyệt' : k} ${n}`).join(' · ') || '—'} />
        <Stat label="Sai số trung bình" value={a.acc_avg != null ? `±${a.acc_avg} m` : '—'} sub={`${a.fixes ? Math.round((a.accepted / a.fixes) * 100) : 0}% điểm được dùng`} />
        <Stat label="Có mất tín hiệu" value={a.runs ? `${Math.round((a.with_gaps / a.runs) * 100)}%` : '—'} sub={`tổng ${formatDuration(Number(a.gap_s))}`} />
        <Stat label="Quên bấm Kết thúc" value={String(a.trimmed)} sub={`${a.auto_stopped} bài tự tạm dừng 30 phút`} />
      </section>

      {d.runs.length === 0 ? (
        <EmptyState icon={FlaskConical} title="Chưa có bài kiểm thử" description="Mở /run?qa=1 trên điện thoại cần thử, chạy một kịch bản rồi chọn kịch bản ở màn tổng kết." />
      ) : (
        <>
          <section className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-bold">Bảng kiểm theo thiết bị</h3>
              <Button size="sm" variant="secondary" onClick={exportXlsx}><Download className="size-4" aria-hidden />Xuất Excel</Button>
            </div>
            {devices.map(([device, runs]) => <DeviceCard key={device} device={device} runs={runs} />)}
          </section>
          <section className="space-y-2">
            <h3 className="font-bold">Các lần chạy thử</h3>
            <ul className="space-y-2">{d.runs.map((r) => <RunRow key={r.activity_id} r={r} />)}</ul>
          </section>
        </>
      )}
    </>
  )
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-3">
      <p className="text-xs text-fg-muted">{label}</p>
      <p className="font-mono text-xl font-bold">{value}</p>
      <p className="truncate text-[11px] text-fg-subtle">{sub}</p>
    </div>
  )
}

/** Một thiết bị × 11 kịch bản: kịch bản đã chạy hiện sai lệch tốt nhất */
function DeviceCard({ device, runs }: { device: string; runs: QaRun[] }) {
  const best = (code: string) => {
    const xs = runs.filter((r) => r.data.qa?.scenario === code)
    if (!xs.length) return null
    const errs = xs.map((r) => errorPct(Number(r.distance_m), r.data.qa?.ref_m)).filter((x): x is number => x !== null)
    return { n: xs.length, err: errs.length ? errs.reduce((m, x) => (Math.abs(x) < Math.abs(m) ? x : m)) : null }
  }
  const done = QA_SCENARIOS.filter((s) => best(s.code)).length
  return (
    <Card className="space-y-2">
      <p className="flex items-center justify-between gap-2 text-sm font-semibold"><span className="truncate">{device}</span>
        <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-xs', done === QA_SCENARIOS.length ? TONE.good : TONE.none)}>{done}/{QA_SCENARIOS.length}</span></p>
      <ul className="grid gap-1 sm:grid-cols-2">
        {QA_SCENARIOS.map((s) => {
          const b = best(s.code)
          return (
            <li key={s.code} className="flex items-center justify-between gap-2 rounded-lg bg-surface-2 px-2 py-1 text-xs">
              <span className={cn('truncate', !b && 'text-fg-subtle')}>{b ? '✓' : '○'} {s.label}</span>
              {b && <span className={cn('shrink-0 rounded px-1.5 font-mono', TONE[errorTone(b.err)])}>{b.err === null ? `${b.n} lần` : pctText(b.err)}</span>}
            </li>
          )
        })}
      </ul>
    </Card>
  )
}

function RunRow({ r }: { r: QaRun }) {
  const [open, setOpen] = useState(false)
  const err = errorPct(Number(r.distance_m), r.data.qa?.ref_m)
  return (
    <li className="rounded-xl border border-border bg-surface">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-full items-center gap-3 px-3 py-2 text-left">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">{qaLabel(r.data.qa?.scenario)}</span>
          <span className="block truncate text-xs text-fg-muted">{r.name} · {r.data.device ?? '—'} · {new Date(r.started_at).toLocaleDateString('vi-VN')}</span>
        </span>
        <span className="text-right">
          <span className="block font-mono text-sm font-bold">{formatKm(Number(r.distance_m))} km</span>
          <span className={cn('inline-block rounded px-1.5 font-mono text-[11px]', TONE[errorTone(err)])}>{err === null ? 'chưa có quãng chuẩn' : pctText(err)}</span>
        </span>
        <ChevronDown className={cn('size-4 text-fg-subtle transition-transform', open && 'rotate-180')} aria-hidden />
      </button>
      {open && (
        <div className="space-y-2 border-t border-border p-3">
          {r.data.qa?.note && <p className="rounded-lg bg-surface-2 px-3 py-2 text-xs">{r.data.qa.note}</p>}
          <GpsQualityCard q={r.data} distanceM={Number(r.distance_m)} />
          <Link href={`/activities/${r.activity_id}`} className="inline-block text-xs font-semibold text-brand underline">Xem bài chạy (bản đồ, từng km)</Link>
        </div>
      )}
    </li>
  )
}
