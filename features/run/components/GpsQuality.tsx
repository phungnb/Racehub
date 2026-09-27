'use client'

import { FlaskConical, Satellite } from 'lucide-react'
import { Card, Field, Input, Textarea } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { formatDuration, formatKm } from '@/shared/lib/format'
import { badPct, errorPct, errorTone, QA_SCENARIOS, REJECT_LABEL, type QaInput, type QaScenario } from '../model/qa'

/** Dữ liệu chất lượng GPS (tóm tắt RunSession.quality() / bảng activity_gps_quality) */
export interface GpsQualityData {
  fixes?: number; accepted?: number; rejected?: Record<string, number>; acc_avg?: number | null; acc_max?: number
  gaps?: number; gap_s?: number; gap_counted?: number; pauses?: number; auto_pauses?: number; long_stops?: number; auto_stopped?: number
  hidden?: number; hidden_s?: number; trimmed_s?: number; platform?: string; device?: string | null; background?: boolean; auto_pause?: boolean
  qa?: { scenario?: string; ref_m?: number | null; note?: string | null; err_pct?: number | null } | null
}

const TONE = { good: 'text-success', ok: 'text-warning', bad: 'text-danger', none: 'text-fg-muted' } as const

function Row({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1 text-sm">
      <span className="text-fg-muted">{label}</span>
      <span className={cn('text-right font-mono tabular font-semibold', tone)}>{value}</span>
    </div>
  )
}

/** Thẻ chỉ số chất lượng GPS của một buổi chạy (màn tổng kết khi kiểm thử, chi tiết bài chạy, Quản trị) */
export function GpsQualityCard({ q, distanceM, refM, className }: { q: GpsQualityData; distanceM: number; refM?: number | null; className?: string }) {
  const err = errorPct(distanceM, refM ?? q.qa?.ref_m)
  const bad = badPct(q)
  const rejected = Object.entries(q.rejected ?? {}).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1])
  return (
    <Card className={cn('space-y-1', className)}>
      <p className="mb-1 flex items-center gap-2 text-sm font-semibold"><Satellite className="size-4 text-brand" aria-hidden />Chất lượng GPS</p>
      {err !== null && <Row label="Sai lệch so với quãng chuẩn" value={`${err > 0 ? '+' : ''}${err}%`} tone={TONE[errorTone(err)]} />}
      <Row label="Điểm GPS nhận / dùng" value={`${q.fixes ?? 0} / ${q.accepted ?? 0}`} />
      <Row label="Điểm hỏng bị bỏ" value={`${bad}%`} tone={bad <= 2 ? TONE.good : bad <= 8 ? TONE.ok : TONE.bad} />
      {q.acc_avg != null && <Row label="Sai số trung bình / lớn nhất" value={`±${q.acc_avg} m / ±${q.acc_max ?? 0} m`} tone={q.acc_avg <= 10 ? TONE.good : q.acc_avg <= 20 ? TONE.ok : TONE.bad} />}
      <Row label="Mất tín hiệu" value={q.gaps ? `${q.gaps} lần · ${formatDuration(q.gap_s ?? 0)}` : 'Không'} tone={q.gaps ? TONE.ok : TONE.good} />
      {!!q.hidden && <Row label="Ẩn app / tắt màn hình" value={`${q.hidden} lần · ${formatDuration(q.hidden_s ?? 0)}`} />}
      <Row label="Tạm dừng tay / tự tạm dừng" value={`${q.pauses ?? 0} / ${q.auto_pauses ?? 0}`} />
      {!!q.long_stops && <Row label="Đứng nghỉ ≥ 10 phút" value={`${q.long_stops} lần${q.auto_stopped ? ' · tự tạm dừng' : ''}`} />}
      {!!q.trimmed_s && <Row label="Bỏ đứng yên cuối bài" value={formatDuration(q.trimmed_s)} />}
      {q.device && <Row label="Thiết bị" value={`${q.device}${q.platform && q.platform !== 'web' ? ' · app cài' : ' · trình duyệt'}`} />}
      {rejected.length > 0 && (
        <details className="pt-1 text-xs text-fg-muted">
          <summary className="cursor-pointer">Chi tiết điểm bị lọc</summary>
          <ul className="mt-1 space-y-0.5">{rejected.map(([k, n]) => <li key={k} className="flex justify-between"><span>{REJECT_LABEL[k] ?? k}</span><span className="font-mono">{n}</span></li>)}</ul>
        </details>
      )}
    </Card>
  )
}

/** Màn tổng kết, chế độ kiểm thử: chọn kịch bản, nhập quãng đường chuẩn + ghi chú (gửi kèm khi Lưu) */
export function GpsQaPanel({ qa, onChange, distanceM, summary }: { qa: QaInput; onChange: (q: QaInput) => void; distanceM: number; summary: GpsQualityData | null }) {
  const refKm = qa.ref_m ? String(Math.round(qa.ref_m) / 1000) : ''
  return (
    <div className="space-y-3">
      <Card className="space-y-3 border-sky-500/40 bg-sky-500/5">
        <p className="flex items-center gap-2 text-sm font-semibold"><FlaskConical className="size-4 text-sky-400" aria-hidden />Kiểm thử GPS</p>
        <Field label="Kịch bản" htmlFor="qa-scenario">
          {(
            <select id="qa-scenario" value={qa.scenario ?? ''} onChange={(e) => onChange({ ...qa, scenario: (e.target.value || null) as QaScenario | null })}
              className="h-11 w-full rounded-xl border border-border bg-surface px-3 text-sm">
              <option value="">— Chọn kịch bản đã chạy —</option>
              {QA_SCENARIOS.map((s) => <option key={s.code} value={s.code}>{s.label}</option>)}
            </select>
          )}
        </Field>
        {qa.scenario && <p className="text-xs text-fg-muted">{QA_SCENARIOS.find((s) => s.code === qa.scenario)?.hint}</p>}
        <Field label="Quãng đường chuẩn (km)" htmlFor="qa-ref" hint={`RaceHub đo ${formatKm(distanceM)} km. Để trống nếu không có số đo chuẩn.`}>
          {(
            <Input id="qa-ref" inputMode="decimal" placeholder="vd. 5 hoặc 2,4" defaultValue={refKm}
              onChange={(e) => { const v = Number(e.target.value.replace(',', '.')); onChange({ ...qa, ref_m: v > 0 ? Math.round(v * 1000) : null }) }} />
          )}
        </Field>
        <Field label="Ghi chú" htmlFor="qa-note">
          {<Textarea id="qa-note" rows={2} maxLength={300} value={qa.note} placeholder="vd. khoá màn hình từ km 2 đến km 4, trời mưa…" onChange={(e) => onChange({ ...qa, note: e.target.value })} />}
        </Field>
        {!qa.scenario && <p className="text-xs text-warning">Chọn kịch bản để bài này vào danh sách Kiểm thử GPS của Quản trị.</p>}
      </Card>
      {summary && <GpsQualityCard q={summary} distanceM={distanceM} refM={qa.ref_m} />}
    </div>
  )
}

