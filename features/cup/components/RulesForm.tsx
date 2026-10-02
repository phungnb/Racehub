'use client'

import { Field, Input } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import type { MatchFormat, MatchMeasure, MatchTerms, MatchTiebreak } from '../api/cupApi'
import { FORMAT_LABEL, MEASURE_LABEL, TIEBREAK_LABEL, toLocalInput } from '../model/match'

const fromLocal = (v: string) => (v ? new Date(v).toISOString() : '')
const toLocal = (iso: string) => (iso ? toLocalInput(new Date(iso)) : '')

function Choice<T extends string | number | null>({ value, options, onChange, label }: {
  value: T; options: { v: T; label: string; hint?: string }[]; onChange: (v: T) => void; label: string
}) {
  return (
    <div role="radiogroup" aria-label={label} className={cn('grid gap-2', options.length > 3 ? 'grid-cols-4' : options.some((o) => o.hint) ? 'grid-cols-1' : 'grid-cols-3')}>
      {options.map((o) => (
        <button key={String(o.v)} type="button" role="radio" aria-checked={value === o.v} onClick={() => onChange(o.v)}
          className={cn('rounded-xl border px-3 py-2 text-left', value === o.v ? 'border-brand bg-brand/10' : 'border-border hover:border-fg-subtle',
            !o.hint && 'text-center')}>
          <span className="block text-sm font-semibold">{o.label}</span>
          {o.hint && <span className="block text-[11px] text-fg-muted">{o.hint}</span>}
        </button>
      ))}
    </div>
  )
}

/** Luật thi đấu: dùng chung cho tạo trận 1–1, đề xuất lại và tạo thách đấu nhiều CLB */
export function RulesForm({ value: t, onChange, kind }: { value: MatchTerms; onChange: (t: MatchTerms) => void; kind: 'CUP' | 'DUEL' }) {
  const set = <K extends keyof MatchTerms>(k: K, v: MatchTerms[K]) => onChange({ ...t, [k]: v })
  const days = Math.round((Date.parse(t.end_at) - Date.parse(t.start_at)) / 86400_000)
  const setDays = (d: number) => {
    const end = new Date(Date.parse(t.start_at)); end.setDate(end.getDate() + d); end.setMinutes(end.getMinutes() - 1)
    set('end_at', end.toISOString())
  }
  const setStart = (iso: string) => {
    if (!iso) return
    const keep = Date.parse(t.end_at) - Date.parse(t.start_at)
    onChange({ ...t, start_at: iso, end_at: new Date(Date.parse(iso) + keep).toISOString() })
  }
  return (
    <div className="space-y-4">
      <Field label="Đo bằng">
        <Choice<MatchMeasure> label="Đo bằng" value={t.measure}
          onChange={(v) => onChange({ ...t, measure: v, format: v === 'PACE' && t.format === 'TOTAL' ? 'AVG' : t.format })}
          options={(Object.keys(MEASURE_LABEL) as MatchMeasure[]).map((v) => ({ v, label: MEASURE_LABEL[v].title, hint: MEASURE_LABEL[v].hint }))} />
      </Field>
      <Field label="Hình thức tính">
        <Choice<MatchFormat> label="Hình thức tính" value={t.format}
          onChange={(v) => onChange({ ...t, format: v, top_n: v === 'TOP' ? t.top_n ?? 5 : null, min_roster: v === 'TOP' ? Math.max(t.min_roster, t.top_n ?? 5) : t.min_roster })}
          options={(Object.keys(FORMAT_LABEL) as MatchFormat[]).filter((v) => !(t.measure === 'PACE' && v === 'TOTAL'))
            .map((v) => ({ v, label: FORMAT_LABEL[v].title, hint: FORMAT_LABEL[v].hint }))} />
      </Field>
      {t.format === 'TOP' && (
        <Field label="Số VĐV giỏi nhất được tính mỗi CLB">
          <Choice<number | null> label="Top" value={t.top_n} onChange={(v) => onChange({ ...t, top_n: v, min_roster: Math.max(t.min_roster, v ?? 1) })}
            options={[3, 5, 10, 20].map((v) => ({ v, label: `Top ${v}` }))} />
        </Field>
      )}
      {t.measure === 'PACE' && (
        <Field label="Mỗi người chạy tối thiểu để được xét pace">
          <Choice<number> label="Km tối thiểu" value={t.pace_min_km} onChange={(v) => set('pace_min_km', v)}
            options={[3, 5, 10, 21].map((v) => ({ v, label: `${v} km` }))} />
        </Field>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Bắt đầu" htmlFor="m-start">
          <Input id="m-start" type="datetime-local" value={toLocal(t.start_at)} onChange={(e) => setStart(fromLocal(e.target.value))} />
        </Field>
        <Field label="Kéo dài">
          <Choice<number> label="Kéo dài" value={days} onChange={setDays}
            options={[3, 7, 14, 30].map((v) => ({ v, label: v === 30 ? '1 tháng' : v % 7 === 0 ? `${v / 7} tuần` : `${v} ngày` }))} />
        </Field>
      </div>
      <Field label="Chốt danh sách thi đấu" hint="Sau giờ chốt không đăng ký / rút được — tránh 'chiêu mộ' giữa trận">
        <Choice<number> label="Chốt danh sách" value={t.lock_hours} onChange={(v) => set('lock_hours', v)}
          options={[0, 1, 6, 24].map((v) => ({ v, label: v ? `Trước ${v} giờ` : 'Đúng giờ G' }))} />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="VĐV tối thiểu mỗi CLB" htmlFor="m-min">
          <Input id="m-min" inputMode="numeric" value={String(t.min_roster)}
            onChange={(e) => set('min_roster', Math.max(1, Math.min(100, Number(e.target.value.replace(/\D/g, '')) || 1)))} />
        </Field>
        <Field label="Tối đa (để trống = không giới hạn)" htmlFor="m-max">
          <Input id="m-max" inputMode="numeric" value={t.max_roster == null ? '' : String(t.max_roster)}
            onChange={(e) => { const v = e.target.value.replace(/\D/g, ''); set('max_roster', v ? Math.min(500, Number(v)) : null) }} />
        </Field>
      </div>
      {kind === 'DUEL' && (
        <Field label="Bên nào thiếu VĐV tối thiểu lúc chốt">
          <Choice<'FORFEIT' | 'CANCEL'> label="Thiếu người" value={t.forfeit_rule} onChange={(v) => set('forfeit_rule', v)}
            options={[{ v: 'FORFEIT', label: 'Xử thua' }, { v: 'CANCEL', label: 'Hủy trận' }]} />
        </Field>
      )}

      {t.measure !== 'PACE' && (
        <>
          <Field label="Trần mỗi người mỗi ngày" hint="Chặn một người 'gánh' cả đội và hạn chế thiệt hại nếu có bài gian lận lọt qua">
            <Choice<number | null> label="Trần ngày" value={t.daily_cap_km} onChange={(v) => set('daily_cap_km', v)}
              options={[{ v: 21, label: '21 km' }, { v: 42, label: '42 km' }, { v: 60, label: '60 km' }, { v: null, label: 'Không' }]} />
          </Field>
          <Field label="Mỗi người góp tối đa (% tổng của đội)">
            <Choice<number | null> label="Trần đóng góp" value={t.share_cap_pct} onChange={(v) => set('share_cap_pct', v)}
              options={[{ v: null, label: 'Không' }, { v: 30, label: '30%' }, { v: 40, label: '40%' }, { v: 50, label: '50%' }]} />
          </Field>
        </>
      )}
      <Field label="Khi bằng điểm">
        <Choice<MatchTiebreak> label="Khi bằng điểm" value={t.tiebreak} onChange={(v) => set('tiebreak', v)}
          options={(Object.keys(TIEBREAK_LABEL) as MatchTiebreak[]).map((v) => ({ v, label: v === 'PARTICIPANTS' ? 'Nhiều người chạy' : v === 'DAYS' ? 'Nhiều ngày chạy' : 'Hòa' }))} />
      </Field>
    </div>
  )
}
