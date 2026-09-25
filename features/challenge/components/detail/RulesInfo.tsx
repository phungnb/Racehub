'use client'

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Gift, Pencil, Phone, Plus, ScrollText, Trash2, Wallet } from 'lucide-react'
import { toast } from 'sonner'
import { Button, Card, Field, Input, Sheet, Textarea } from '@/shared/ui'
import { challengeErrorMessage, hasRulesInfo, RULES_FIELDS, setChallengeRules, type ChallengeRulesInfo } from '../../api/challengeApi'

const ICON = { prizes: Gift, penalties: AlertTriangle, fees: Wallet, conduct: ScrollText, contact: Phone } as const

/** Ô nhập thể lệ bổ sung — dùng trong wizard tạo thử thách và khi BTC sửa sau */
export function RulesInfoForm({ value, onChange }: { value: ChallengeRulesInfo; onChange: (v: ChallengeRulesInfo) => void }) {
  const custom = value.custom ?? []
  const setCustom = (list: { title: string; body: string }[]) => onChange({ ...value, custom: list })
  return (
    <div className="space-y-4">
      {RULES_FIELDS.map((f) => (
        <Field key={f.key} label={f.label} htmlFor={`rules-${f.key}`} hint={f.hint}>
          {f.key === 'contact'
            ? <Input id={`rules-${f.key}`} value={value[f.key] ?? ''} maxLength={f.max} placeholder={f.placeholder} onChange={(e) => onChange({ ...value, [f.key]: e.target.value })} />
            : <Textarea id={`rules-${f.key}`} value={value[f.key] ?? ''} maxLength={f.max} rows={3} placeholder={f.placeholder} onChange={(e) => onChange({ ...value, [f.key]: e.target.value })} />}
        </Field>
      ))}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-fg-muted">Mục khác (tối đa 5)</p>
          <Button size="sm" variant="secondary" disabled={custom.length >= 5} onClick={() => setCustom([...custom, { title: '', body: '' }])}>
            <Plus className="size-4" aria-hidden />Thêm mục
          </Button>
        </div>
        {custom.map((x, i) => (
          <div key={i} className="space-y-2 rounded-xl border border-border p-3">
            <div className="flex gap-2">
              <Input value={x.title} maxLength={60} placeholder="Tên mục, VD: Lịch chạy nhóm" aria-label={`Tên mục ${i + 1}`}
                onChange={(e) => setCustom(custom.map((c, j) => (j === i ? { ...c, title: e.target.value } : c)))} />
              <Button size="sm" variant="ghost" aria-label="Xóa mục" onClick={() => setCustom(custom.filter((_, j) => j !== i))}><Trash2 className="size-4" aria-hidden /></Button>
            </div>
            <Textarea value={x.body} maxLength={1500} rows={3} placeholder="Nội dung" aria-label={`Nội dung mục ${i + 1}`}
              onChange={(e) => setCustom(custom.map((c, j) => (j === i ? { ...c, body: e.target.value } : c)))} />
          </div>
        ))}
      </div>
    </div>
  )
}

/** Hiển thị thể lệ bổ sung trong tab Luật chơi; BTC có nút sửa */
export function RulesInfoCard({ challengeId, rules, updatedAt, canEdit }: {
  challengeId: string; rules: ChallengeRulesInfo | null | undefined; updatedAt?: string | null; canEdit: boolean
}) {
  const [open, setOpen] = useState(false)
  if (!hasRulesInfo(rules) && !canEdit) return null
  const r = rules ?? {}
  return (
    <Card className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-semibold">Thể lệ của Ban tổ chức</h2>
        {canEdit && <Button size="sm" variant="ghost" onClick={() => setOpen(true)}><Pencil className="size-4" aria-hidden />{hasRulesInfo(r) ? 'Sửa' : 'Thêm thể lệ'}</Button>}
      </div>
      {!hasRulesInfo(r) ? (
        <p className="text-sm text-fg-muted">Chưa có thể lệ bổ sung. Thêm thể lệ thưởng, phạt, lệ phí, liên hệ… để người tham gia nắm rõ.</p>
      ) : (
        <ul className="space-y-3">
          {RULES_FIELDS.filter((f) => r[f.key]?.trim()).map((f) => {
            const Icon = ICON[f.key]
            return (
              <li key={f.key} className="flex gap-3">
                <Icon className="mt-0.5 size-4 shrink-0 text-fg-subtle" aria-hidden />
                <span className="min-w-0 text-sm"><span className="block text-fg-subtle">{f.label}</span>
                  <span className="block whitespace-pre-line break-words font-medium">{r[f.key]}</span></span>
              </li>
            )
          })}
          {(r.custom ?? []).map((x, i) => (
            <li key={i} className="flex gap-3">
              <ScrollText className="mt-0.5 size-4 shrink-0 text-fg-subtle" aria-hidden />
              <span className="min-w-0 text-sm"><span className="block text-fg-subtle">{x.title}</span>
                <span className="block whitespace-pre-line break-words font-medium">{x.body}</span></span>
            </li>
          ))}
        </ul>
      )}
      {hasRulesInfo(r) && (
        <p className="border-t border-border pt-2 text-xs text-fg-subtle">
          Thể lệ do Ban tổ chức đặt và tự chịu trách nhiệm; RaceHub không thu hộ lệ phí / tiền phạt.
          {updatedAt && ` Cập nhật ${new Date(updatedAt).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })}.`}
        </p>
      )}
      {open && <RulesEditSheet challengeId={challengeId} init={r} onClose={() => setOpen(false)} />}
    </Card>
  )
}

function RulesEditSheet({ challengeId, init, onClose }: { challengeId: string; init: ChallengeRulesInfo; onClose: () => void }) {
  const qc = useQueryClient()
  const [v, setV] = useState<ChallengeRulesInfo>(init)
  const save = useMutation({
    mutationFn: () => setChallengeRules(challengeId, v),
    onSuccess: () => { toast.success('Đã lưu thể lệ'); void qc.invalidateQueries({ queryKey: ['challenge', challengeId] }); onClose() },
    onError: (e) => toast.error(challengeErrorMessage(e)),
  })
  return (
    <Sheet open onClose={onClose} title="Thể lệ của Ban tổ chức"
      description="Nếu thử thách đã bắt đầu, người tham gia sẽ nhận thông báo thể lệ được cập nhật."
      footer={<Button block onClick={() => save.mutate()} loading={save.isPending}>Lưu thể lệ</Button>}>
      <RulesInfoForm value={v} onChange={setV} />
    </Sheet>
  )
}
