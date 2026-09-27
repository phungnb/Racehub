'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Check, Gift, RotateCcw } from 'lucide-react'
import { toast } from 'sonner'
import { Button, Card, ConfirmSheet, Field, Input, SectionTitle, Skeleton, Textarea } from '@/shared/ui'
import {
  DEFAULT_PLAN_CONTENT, PLAN_CARD_LABEL, PLAN_VARS, renderPerks, validatePlanContent,
  type PlanCardContent, type PlanContent, type PlanVars,
} from '@/shared/lib/ops'
import { getFreeChallengeSlots, getPlanCompare } from '@/features/billing'
import { useOpsPolicy, usePublishOps } from '@/features/system'
import { adminErrorMessage } from '../../api/adminApi'

const KEYS = Object.keys(PLAN_CARD_LABEL) as (keyof PlanContent)[]
const lines = (t: string) => t.split('\n').map((s) => s.trim()).filter(Boolean)

/**
 * Thẻ gói không bán (Miễn phí, CLB Miễn phí, Doanh nghiệp) trên trang /goi — lưu vào Chính sách vận hành (009200):
 * có phiên bản, nhật ký quản trị, khôi phục ở Hệ thống → Chính sách vận hành → Lịch sử.
 */
export function FreePlansEditor() {
  const ops = useOpsPolicy()
  const compare = useQuery({ queryKey: ['billing', 'compare'], queryFn: getPlanCompare, staleTime: 60_000 })
  const slots = useQuery({ queryKey: ['billing', 'free-slots', true], queryFn: getFreeChallengeSlots, staleTime: 60_000 })
  if (compare.isPending) return <Skeleton className="h-64" />
  const c = compare.data?.club
  const vars: Partial<PlanVars> = c ? {
    freeSlots: slots.data ?? 5, clubMaxMembers: c.freeMaxMembers, clubMaxOpen: c.freeMaxOpen, clubMaxSlots: c.freeMaxSlots,
    clubMinActive: c.freeMinActiveMembers, activeDays: c.activeWindowDays, clubCaptains: compare.data!.free_captains,
    proMaxOpen: c.proMaxOpen, proMaxSlots: c.proMaxSlots,
  } : {}
  return <Editor key={ops.version} current={ops.content.plans} version={ops.version} vars={vars} />
}

function Editor({ current, version, vars }: { current: PlanContent; version: number; vars: Partial<PlanVars> }) {
  const [draft, setDraft] = useState(() => Object.fromEntries(KEYS.map((k) => [k, { ...current[k], perksText: current[k].perks.join('\n') }])) as
    Record<keyof PlanContent, PlanCardContent & { perksText: string }>)
  const [note, setNote] = useState('')
  const [confirm, setConfirm] = useState(false)
  const publish = usePublishOps()
  const plans: PlanContent = Object.fromEntries(KEYS.map((k) => {
    const { perksText, ...rest } = draft[k]
    return [k, { ...rest, title: rest.title.trim(), subtitle: rest.subtitle.trim(), note: rest.note.trim(), perks: lines(perksText) }]
  })) as unknown as PlanContent
  const error = validatePlanContent(plans)
  const changed = JSON.stringify(plans) !== JSON.stringify(current)
  const set = (k: keyof PlanContent, patch: Partial<PlanCardContent & { perksText: string }>) => setDraft((d) => ({ ...d, [k]: { ...d[k], ...patch } }))
  const save = () => publish.mutate({ p: { content: { plans } }, note: note || 'Sửa thẻ gói miễn phí' }, {
    onSuccess: (v) => { toast.success(`Đã cập nhật trang Gói (chính sách vận hành bản v${v})`); setConfirm(false); setNote('') },
    onError: (e) => toast.error(adminErrorMessage(e)),
  })

  return (
    <section className="space-y-3">
      <SectionTitle>Gói miễn phí & Doanh nghiệp (trang Gói)</SectionTitle>
      <Card className="space-y-2 text-xs text-fg-muted">
        <p>Ba thẻ này không bán nên không có giá. Mỗi dòng quyền lợi một ý. Chèn biến trong ngoặc nhọn để số tự khớp với chính sách đang áp dụng — đổi hạn mức ở tab Kinh tế là trang Gói tự đổi theo, không phải sửa chữ.</p>
        <ul className="flex flex-wrap gap-1.5">
          {PLAN_VARS.map((v) => (
            <li key={v.key} className="rounded-lg border border-border px-2 py-1" title={v.label}>
              <code className="font-mono text-fg">{`{${v.key}}`}</code> = {vars[v.key] ?? '…'} <span className="text-fg-subtle">· {v.label}</span>
            </li>
          ))}
        </ul>
        <p className="text-fg-subtle">Biến bằng 0 (không có / không giới hạn) thì dòng đó tự ẩn. Đang dùng bản v{version} của chính sách vận hành.</p>
      </Card>

      {KEYS.map((k) => {
        const d = draft[k]
        const preview = renderPerks(lines(d.perksText), vars)
        return (
          <Card key={k} className="space-y-3">
            <div className="flex items-center gap-2">
              <Gift className="size-4 text-brand" aria-hidden />
              <p className="flex-1 font-semibold">{PLAN_CARD_LABEL[k]}</p>
              <Button size="sm" variant="ghost" onClick={() => set(k, { ...DEFAULT_PLAN_CONTENT[k], perksText: DEFAULT_PLAN_CONTENT[k].perks.join('\n') })}>
                <RotateCcw className="size-4" aria-hidden />Mẫu gốc
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Tên gói" htmlFor={`fp-title-${k}`}><Input id={`fp-title-${k}`} maxLength={60} value={d.title} onChange={(e) => set(k, { title: e.target.value })} /></Field>
              <Field label="Mô tả ngắn" htmlFor={`fp-sub-${k}`}><Input id={`fp-sub-${k}`} maxLength={200} value={d.subtitle} onChange={(e) => set(k, { subtitle: e.target.value })} /></Field>
            </div>
            <Field label="Quyền lợi (mỗi dòng một ý)" htmlFor={`fp-perks-${k}`}>
              <Textarea id={`fp-perks-${k}`} rows={6} value={d.perksText} onChange={(e) => set(k, { perksText: e.target.value })} />
            </Field>
            <Field label="Ghi chú dưới thẻ" htmlFor={`fp-note-${k}`}>
              <Input id={`fp-note-${k}`} maxLength={300} value={d.note} onChange={(e) => set(k, { note: e.target.value })} />
            </Field>
            <div className="space-y-1.5 rounded-xl border border-dashed border-border p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">Xem trước</p>
              <p className="font-bold">{d.title || '—'}</p>
              {d.subtitle && <p className="text-xs text-fg-muted">{d.subtitle}</p>}
              <ul className="space-y-1">
                {preview.map((t, i) => <li key={i} className="flex gap-2 text-sm"><Check className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden />{t}</li>)}
              </ul>
              {d.note && <p className="text-xs text-fg-muted">{d.note}</p>}
            </div>
          </Card>
        )
      })}

      <div className="space-y-2 rounded-2xl border border-border bg-bg/95 p-3">
        {error ? <p role="alert" className="text-xs text-danger">{error}</p>
          : <p className="text-xs text-fg-muted">{changed ? 'Có thay đổi chưa lưu.' : 'Chưa có thay đổi.'}</p>}
        <Button block disabled={!changed || !!error} onClick={() => setConfirm(true)}>Lưu thẻ gói</Button>
      </div>

      <ConfirmSheet open={confirm} onClose={() => setConfirm(false)} danger={false} loading={publish.isPending} confirmLabel="Áp dụng ngay"
        title="Cập nhật trang Gói?" onConfirm={save}>
        <div className="space-y-3 text-sm">
          <p className="text-fg-muted">Người dùng thấy nội dung mới trong vài phút. Khôi phục bản cũ ở Hệ thống → Chính sách vận hành → Lịch sử.</p>
          <Field label="Ghi chú thay đổi (vào nhật ký quản trị)" htmlFor="fp-note">
            <Input id="fp-note" maxLength={160} placeholder="vd. Thêm quyền lợi gói miễn phí" value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </div>
      </ConfirmSheet>
    </section>
  )
}
