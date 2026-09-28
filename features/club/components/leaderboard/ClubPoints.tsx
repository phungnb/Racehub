'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronRight, History, Pencil, Plus, Sparkles, Trash2, Users, Zap } from 'lucide-react'
import { toast } from 'sonner'
import { Avatar, Button, Card, ConfirmSheet, EmptyState, ErrorState, Field, Input, SegmentedControl, Sheet, Skeleton, SwitchRow } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { formatNumber } from '@/shared/lib/format'
import type { LeaderboardPeriod } from '../../api/hubApi'
import {
  getMyPoints, getPointRules, getPointsBoard, pointsErrorMessage, savePointRules,
  type ApplyFrom, type PointRule, type PointRuleSet,
} from '../../api/pointsApi'
import { DAY_LABEL, describeRule, paceText, parsePace, RULE_TEMPLATES, validateRules } from '../../model/points'

const PERIODS: { value: LeaderboardPeriod; label: string }[] = [{ value: 'WEEK', label: 'Tuần này' }, { value: 'MONTH', label: 'Tháng này' }, { value: 'ALL', label: 'Tất cả' }]
const pts = (v: number) => formatNumber(Math.round(v * 10) / 10)
const fmtDate = (iso: string) => (iso.startsWith('-infinity') ? 'mọi bài chạy' : new Date(iso).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' }))

/** BXH → Điểm CLB: bảng điểm theo luật ban quản trị đặt, luật hiện hành + lịch sử, điểm của tôi từng bài */
export function ClubPoints({ clubId }: { clubId: string }) {
  const [period, setPeriod] = useState<LeaderboardPeriod>('WEEK')
  const rules = useQuery({ queryKey: ['club', clubId, 'point-rules'], queryFn: () => getPointRules(clubId) })
  const board = useQuery({ queryKey: ['club', clubId, 'points', period], queryFn: () => getPointsBoard(clubId, period), staleTime: 60_000 })
  const [editing, setEditing] = useState(false)
  if (rules.isPending) return <Skeleton className="h-64" />
  if (rules.isError) return <ErrorState message={pointsErrorMessage(rules.error)} error={rules.error} onRetry={() => void rules.refetch()} />
  const cur = rules.data.current
  return (
    <div className="space-y-4">
      <RulesCard set={cur} history={rules.data.history} canEdit={rules.data.can_edit} onEdit={() => setEditing(true)} />
      {cur && (
        <>
          <SegmentedControl value={period} onChange={(v) => setPeriod(v as LeaderboardPeriod)} options={PERIODS} />
          {board.isPending ? <Skeleton className="h-48" /> : board.isError ? <ErrorState error={board.error} onRetry={() => void board.refetch()} />
            : !board.data.rows.length ? <EmptyState icon={Sparkles} title="Chưa ai có điểm" description="Điểm tự cộng khi thành viên có bài chạy hợp lệ khớp luật." />
            : (
              <ol className="space-y-1.5">
                {board.data.rows.map((r) => (
                  <li key={r.user_id} className={cn('flex items-center gap-3 rounded-xl px-3 py-2', r.me ? 'bg-brand/15' : 'bg-surface')}>
                    <span className={cn('w-6 text-center font-mono text-sm font-bold', r.rank <= 3 ? 'text-coin' : 'text-fg-muted')}>{r.rank}</span>
                    <Avatar src={r.avatar_url} name={r.name} size="sm" />
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold">{r.name}{r.me ? ' (bạn)' : ''}</span>
                    <span className="text-right"><b className="font-mono">{pts(r.points)}</b> <span className="text-xs text-fg-muted">điểm · {r.runs} buổi</span></span>
                  </li>
                ))}
              </ol>
            )}
          <MyPoints clubId={clubId} period={period} />
        </>
      )}
      {editing && <RulesEditor clubId={clubId} current={cur} onClose={() => setEditing(false)} />}
    </div>
  )
}

function RulesCard({ set, history, canEdit, onEdit }: { set: PointRuleSet | null; history: PointRuleSet[]; canEdit: boolean; onEdit: () => void }) {
  const [showHistory, setShowHistory] = useState(false)
  if (!set) {
    return (
      <Card className="space-y-3 text-center">
        <Sparkles className="mx-auto size-8 text-coin" aria-hidden />
        <p className="font-semibold">CLB chưa có luật tính điểm</p>
        <p className="text-sm text-fg-muted">Điểm CLB thưởng cho sự đều đặn, chạy sáng sớm, đi chạy nhóm… chứ không chỉ ai chạy nhiều km nhất. Ban quản trị đặt luật một lần, hệ thống tự chấm cho mọi bài chạy.</p>
        {canEdit && <Button block onClick={onEdit}><Plus className="size-4" aria-hidden />Đặt luật tính điểm</Button>}
      </Card>
    )
  }
  return (
    <Card className="space-y-3">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="font-semibold">Luật tính điểm {set.enabled ? '' : '(đang tạm tắt)'}</p>
          <p className="text-xs text-fg-muted">Bản {set.version} · áp dụng cho bài chạy từ {fmtDate(set.valid_from)}{set.by ? ` · ${set.by}` : ''}</p>
        </div>
        {canEdit && <Button size="sm" variant="secondary" onClick={onEdit}><Pencil className="size-4" aria-hidden />Sửa luật</Button>}
      </div>
      <ul className="space-y-1.5">
        {set.rules.map((r, i) => (
          <li key={i} className="rounded-xl bg-surface-2/60 px-3 py-2 text-sm">
            <b>{r.name}</b>
            <span className="block text-xs text-fg-muted">{describeRule(r)}</span>
          </li>
        ))}
      </ul>
      <p className="text-xs text-fg-muted">
        {set.daily_cap ? `Tối đa ${formatNumber(set.daily_cap)} điểm mỗi ngày. ` : ''}{set.use_boost ? 'Ngày vàng ×2 / ×3 nhân điểm. ' : ''}Chỉ tính bài chạy hợp lệ, có chia sẻ.
      </p>
      {set.note && <p className="rounded-lg bg-coin/10 px-3 py-2 text-xs">{set.note}</p>}
      {history.length > 1 && (
        <>
          <button type="button" onClick={() => setShowHistory(!showHistory)} className="flex w-full items-center gap-1.5 text-xs font-semibold text-fg-muted">
            <History className="size-3.5" aria-hidden />Lịch sử thay đổi ({history.length})
            <ChevronRight className={cn('ml-auto size-4 transition-transform', showHistory && 'rotate-90')} aria-hidden />
          </button>
          {showHistory && (
            <ul className="space-y-1 text-xs text-fg-muted">
              {history.map((h) => (
                <li key={h.version}>Bản {h.version} · {new Date(h.created_at).toLocaleString('vi-VN')} · {h.by ?? '—'} · {h.enabled ? `${h.rules.length} luật` : 'tắt'} · từ {fmtDate(h.valid_from)}{h.note ? ` · ${h.note}` : ''}</li>
              ))}
            </ul>
          )}
        </>
      )}
    </Card>
  )
}

function MyPoints({ clubId, period }: { clubId: string; period: LeaderboardPeriod }) {
  const [open, setOpen] = useState(false)
  const q = useQuery({ queryKey: ['club', clubId, 'my-points', period], queryFn: () => getMyPoints(clubId, period), enabled: open })
  return (
    <Card className="space-y-2">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-full items-center gap-2 text-left">
        <span className="flex-1 font-semibold">Điểm của tôi từng bài</span>
        <ChevronRight className={cn('size-4 text-fg-subtle transition-transform', open && 'rotate-90')} aria-hidden />
      </button>
      {open && (q.isPending ? <Skeleton className="h-24" /> : q.isError ? <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        : !q.data.length ? <p className="text-sm text-fg-muted">Chưa có bài chạy nào trong kỳ này.</p> : (
          <ul className="divide-y divide-border">
            {q.data.map((r) => (
              <li key={r.activity_id} className="py-2 text-sm">
                <p className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate">{new Date(r.started_at).toLocaleDateString('vi-VN')} · {r.km.toLocaleString('vi-VN')} km</span>
                  <b className={cn('font-mono', r.points > 0 ? 'text-brand' : 'text-fg-subtle')}>+{pts(r.points)}</b>
                </p>
                <p className="text-xs text-fg-muted">
                  {r.hits.length ? r.hits.map((h) => `${h.name} +${pts(h.points)}`).join(' · ') : 'Không khớp luật nào'}
                  {r.boost > 1 ? ` · Ngày vàng ×${r.boost}` : ''}{r.group ? ' · Chạy nhóm' : ''}
                </p>
              </li>
            ))}
          </ul>
        ))}
      {open && !!q.data?.some((r) => r.daily_cap) && <p className="text-[11px] text-fg-subtle">Tổng mỗi ngày không vượt trần điểm của luật.</p>}
    </Card>
  )
}

type Draft = PointRule & { paceText: string }
const toDraft = (r: PointRule): Draft => ({ ...r, paceText: r.max_pace_s ? paceText(r.max_pace_s) : '' })
const numOrNull = (v: string) => (v.trim() === '' ? null : Number(v.replace(',', '.')))
const APPLY: { value: ApplyFrom; label: string }[] = [{ value: 'NOW', label: 'Từ bây giờ' }, { value: 'WEEK', label: 'Đầu tuần' }, { value: 'MONTH', label: 'Đầu tháng' }, { value: 'ALL', label: 'Mọi bài' }]

/** Ban quản trị (chủ nhiệm + quản trị viên) soạn luật; lưu = phiên bản mới, báo lên bảng tin CLB */
function RulesEditor({ clubId, current, onClose }: { clubId: string; current: PointRuleSet | null; onClose: () => void }) {
  const qc = useQueryClient()
  const [rules, setRules] = useState<Draft[]>(() => (current?.rules ?? RULE_TEMPLATES[0].rules).map(toDraft))
  const [cap, setCap] = useState(current ? (current.daily_cap?.toString() ?? '') : String(RULE_TEMPLATES[0].daily_cap ?? ''))
  const [boost, setBoost] = useState(current?.use_boost ?? true)
  const [enabled, setEnabled] = useState(current?.enabled ?? true)
  const [apply, setApply] = useState<ApplyFrom>(current ? 'NOW' : 'MONTH')
  const [note, setNote] = useState('')
  const [confirm, setConfirm] = useState(false)
  const clean: PointRule[] = rules.map(({ paceText: p, ...r }) => ({ ...r, name: r.name.trim(), max_pace_s: p.trim() ? parsePace(p) ?? -1 : null }))
  const paceBad = clean.findIndex((r) => r.max_pace_s === -1)
  const error = paceBad >= 0 ? `Luật ${paceBad + 1}: pace nhập dạng 6:30.` : validateRules(clean, numOrNull(cap))
  const save = useMutation({
    mutationFn: () => savePointRules(clubId, { enabled, rules: clean, daily_cap: numOrNull(cap), use_boost: boost, note: note.trim() }, apply),
    onSuccess: (v) => {
      toast.success(`Đã lưu luật bản ${v} và báo cả CLB`)
      void qc.invalidateQueries({ queryKey: ['club', clubId] })
      onClose()
    },
    onError: (e) => { setConfirm(false); toast.error(pointsErrorMessage(e)) },
  })
  const set = (i: number, patch: Partial<Draft>) => setRules((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  return (
    <Sheet open onClose={onClose} title="Luật tính điểm CLB" description="Mỗi bài chạy được cộng điểm của mọi luật khớp. Lưu là tạo bản mới, có lịch sử, cả CLB được báo."
      footer={<>
        {error && <p role="alert" className="mb-2 text-xs text-danger">{error}</p>}
        <Button block disabled={!!error} onClick={() => setConfirm(true)}>Lưu luật</Button>
      </>}>
      <div className="space-y-4">
        <div className="space-y-1.5">
          <p className="text-sm font-semibold">Mẫu gợi ý</p>
          <div className="flex flex-wrap gap-2">
            {RULE_TEMPLATES.map((t) => (
              <button key={t.label} type="button" title={t.hint} onClick={() => { setRules(t.rules.map(toDraft)); setCap(t.daily_cap?.toString() ?? '') }}
                className="rounded-full border border-border px-3 py-1.5 text-sm font-semibold hover:border-brand">{t.label}</button>
            ))}
          </div>
        </div>
        <ul className="space-y-3">
          {rules.map((r, i) => (
            <li key={i} className="space-y-2 rounded-xl border border-border p-3">
              <div className="flex gap-2">
                <Input aria-label={`Tên luật ${i + 1}`} value={r.name} maxLength={60} onChange={(e) => set(i, { name: e.target.value })} />
                <Button size="sm" variant="ghost" aria-label="Xoá luật" disabled={rules.length <= 1} onClick={() => setRules(rules.filter((_, j) => j !== i))}><Trash2 className="size-4" aria-hidden /></Button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <SegmentedControl value={r.per} onChange={(v) => set(i, { per: v as PointRule['per'] })} options={[{ value: 'RUN', label: 'Mỗi buổi' }, { value: 'KM', label: 'Mỗi km' }]} />
                <Input aria-label="Điểm" inputMode="decimal" className="font-mono" value={String(r.points)} onChange={(e) => set(i, { points: Number(e.target.value.replace(',', '.')) || 0 })} />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <Field label="Từ km" htmlFor={`r${i}-min`}><Input id={`r${i}-min`} inputMode="decimal" value={r.min_km?.toString() ?? ''} onChange={(e) => set(i, { min_km: numOrNull(e.target.value) })} /></Field>
                <Field label="Tới km" htmlFor={`r${i}-max`}><Input id={`r${i}-max`} inputMode="decimal" value={r.max_km?.toString() ?? ''} onChange={(e) => set(i, { max_km: numOrNull(e.target.value) })} /></Field>
                <Field label="Pace ≤" htmlFor={`r${i}-pace`}><Input id={`r${i}-pace`} placeholder="6:30" value={r.paceText} onChange={(e) => set(i, { paceText: e.target.value })} /></Field>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Bắt đầu từ giờ" htmlFor={`r${i}-from`}><Input id={`r${i}-from`} inputMode="numeric" placeholder="0" value={r.from_hour?.toString() ?? ''} onChange={(e) => set(i, { from_hour: numOrNull(e.target.value) })} /></Field>
                <Field label="Trước giờ" htmlFor={`r${i}-to`}><Input id={`r${i}-to`} inputMode="numeric" placeholder="24" value={r.to_hour?.toString() ?? ''} onChange={(e) => set(i, { to_hour: numOrNull(e.target.value) })} /></Field>
              </div>
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Ngày trong tuần (không chọn = mọi ngày)">
                {[1, 2, 3, 4, 5, 6, 7].map((d) => {
                  const on = r.days?.includes(d) ?? false
                  return (
                    <button key={d} type="button" aria-pressed={on} onClick={() => set(i, { days: on ? (r.days ?? []).filter((x) => x !== d) : [...(r.days ?? []), d] })}
                      className={cn('size-9 rounded-full border text-xs font-semibold', on ? 'border-brand bg-brand/15 text-brand' : 'border-border text-fg-muted')}>{DAY_LABEL[d]}</button>
                  )
                })}
              </div>
              <SwitchRow checked={!!r.group_only} onChange={(v) => set(i, { group_only: v })} label="Chỉ buổi chạy nhóm" description="Người chạy đã điểm danh ở buổi của CLB trong ngày" />
              <p className="text-xs text-fg-muted">{describeRule({ ...r, max_pace_s: parsePace(r.paceText) })}</p>
            </li>
          ))}
        </ul>
        {rules.length < 12 && (
          <Button size="sm" variant="secondary" onClick={() => setRules([...rules, toDraft({ name: 'Luật mới', per: 'RUN', points: 5 })])}><Plus className="size-4" aria-hidden />Thêm luật</Button>
        )}
        <Field label="Trần điểm mỗi ngày (để trống = không giới hạn)" htmlFor="pts-cap">
          <Input id="pts-cap" inputMode="numeric" value={cap} onChange={(e) => setCap(e.target.value.replace(/[^\d]/g, ''))} />
        </Field>
        <SwitchRow checked={boost} onChange={setBoost} icon={Zap} label="Ngày vàng nhân điểm" description="Ngày ×2 / ×3 của CLB nhân cả điểm" />
        <SwitchRow checked={enabled} onChange={setEnabled} label="Bật tính điểm" description="Tắt: BXH điểm tạm dừng, luật vẫn lưu trong lịch sử" />
        <div className="space-y-1.5">
          <p className="text-sm font-semibold">Áp dụng cho bài chạy</p>
          <SegmentedControl value={apply} onChange={(v) => setApply(v as ApplyFrom)} options={APPLY} />
          <p className="text-xs text-fg-muted">{apply === 'NOW' ? 'Bài chạy trước đó giữ nguyên điểm theo luật cũ.' : 'Điểm các bài từ mốc này được tính lại theo luật mới.'}</p>
        </div>
        <Field label="Ghi chú cho thành viên (không bắt buộc)" htmlFor="pts-note"><Input id="pts-note" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} placeholder="VD: Mùa giải tháng 10, top 3 nhận quà" /></Field>
        <p className="flex items-start gap-1.5 text-xs text-fg-subtle"><Users className="mt-0.5 size-3.5 shrink-0" aria-hidden />Chỉ chủ nhiệm và quản trị viên được sửa luật. Mọi thành viên xem được luật và lịch sử thay đổi.</p>
      </div>
      <ConfirmSheet open={confirm} onClose={() => setConfirm(false)} danger={false} loading={save.isPending} confirmLabel="Lưu & báo CLB"
        title="Lưu luật tính điểm?" description={`Luật mới áp dụng ${APPLY.find((a) => a.value === apply)!.label.toLowerCase()}. Bảng tin CLB sẽ có thông báo thay đổi.`}
        onConfirm={() => save.mutate()} />
    </Sheet>
  )
}
