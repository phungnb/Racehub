'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Download } from 'lucide-react'
import { Button, ErrorState, Field, Input, Skeleton } from '@/shared/ui'
import { formatNumber } from '@/shared/lib/format'
import { getOrgReport, orgErrorMessage, type OrgDetail } from '../../api/orgApi'
import { downloadCsv, toDayInput, vnDayStart } from '../../model/org'

/** Báo cáo cho bộ phận nhân sự / ban tổ chức: km, số buổi, số ngày chạy từng người trong khoảng ngày */
export function ReportTab({ org }: { org: OrgDetail }) {
  const [from, setFrom] = useState(() => toDayInput(new Date(new Date().setDate(1)).toISOString()))
  const [to, setTo] = useState(() => toDayInput(new Date().toISOString()))
  const range = { from: vnDayStart(from), to: new Date(Date.parse(vnDayStart(to)) + 86400_000).toISOString() }
  const q = useQuery({ queryKey: ['org', org.id, 'report', from, to], queryFn: () => getOrgReport(org.id, range.from, range.to), enabled: !!from && !!to && to >= from })
  const rows = q.data ?? []
  const active = rows.filter((r) => r.runs > 0).length
  const km = rows.reduce((a, r) => a + Number(r.km), 0)
  const exportCsv = () => downloadCsv(`bao-cao-${from}-${to}.csv`,
    ['Họ tên', org.unit_label, 'Mã nhân viên', 'CLB', 'Thành viên trực tiếp', 'Km', 'Số buổi', 'Số ngày chạy'],
    rows.map((r) => [r.name, r.unit_name ?? '', r.employee_code ?? '', r.clubs ?? '', r.direct ? 'Có' : 'Qua CLB', String(r.km).replace('.', ','), r.runs, r.active_days]))
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Từ ngày" htmlFor="r-from"><Input id="r-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="Đến ngày" htmlFor="r-to"><Input id="r-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
      </div>
      {q.isPending ? <Skeleton className="h-60" /> : q.isError ? <ErrorState message={orgErrorMessage(q.error)} error={q.error} onRetry={() => void q.refetch()} /> : (
        <>
          <div className="grid grid-cols-3 gap-2 text-center">
            {[['Người đã chạy', `${active}/${rows.length}`], ['Tỷ lệ tham gia', rows.length ? `${Math.round((active / rows.length) * 100)}%` : '—'], ['Tổng km', formatNumber(Math.round(km))]].map(([l, v]) => (
              <div key={l} className="rounded-xl bg-surface-2 p-2"><p className="font-mono font-bold">{v}</p><p className="text-[11px] text-fg-subtle">{l}</p></div>
            ))}
          </div>
          <Button block variant="secondary" onClick={exportCsv} disabled={!rows.length}><Download className="size-4" aria-hidden />Xuất Excel (CSV)</Button>
          <ul className="divide-y divide-border rounded-2xl border border-border bg-surface text-sm">
            <li className="grid grid-cols-[1fr_3.5rem_3rem_3rem] gap-1 px-3 py-2 text-[11px] font-semibold text-fg-subtle">
              <span>Thành viên</span><span className="text-right">Km</span><span className="text-right">Buổi</span><span className="text-right">Ngày</span>
            </li>
            {rows.map((r) => (
              <li key={r.user_id} className="grid grid-cols-[1fr_3.5rem_3rem_3rem] items-center gap-1 px-3 py-2">
                <span className="min-w-0"><span className="block truncate">{r.name}</span>
                  <span className="block truncate text-[11px] text-fg-subtle">{r.unit_name ?? r.clubs ?? ''}</span></span>
                <span className="text-right font-mono text-xs">{formatNumber(Number(r.km))}</span>
                <span className="text-right font-mono text-xs">{r.runs}</span>
                <span className="text-right font-mono text-xs">{r.active_days}</span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-fg-subtle">Chỉ tính bài chạy hợp lệ, đang chia sẻ. Gồm thành viên trực tiếp và thành viên các CLB thuộc tổ chức.</p>
        </>
      )}
    </div>
  )
}
