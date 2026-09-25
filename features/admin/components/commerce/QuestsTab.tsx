'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Target } from 'lucide-react'
import { toast } from 'sonner'
import { Button, EmptyState, ErrorState, Field, Input, Sheet, Skeleton, Textarea } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { formatCoin, formatNumber } from '@/shared/lib/format'
import { adminErrorMessage } from '../../api/adminApi'
import { listQuests, saveQuest, type AdminQuest, type QuestMetric, type QuestPeriod } from '../../api/commerceApi'

const PERIODS: { v: QuestPeriod; label: string }[] = [
  { v: 'DAILY', label: 'Hằng ngày' }, { v: 'WEEKLY', label: 'Hằng tuần' }, { v: 'MONTHLY', label: 'Hằng tháng' }, { v: 'EVENT', label: 'Sự kiện' },
]
const METRICS: { v: QuestMetric; label: string; unit: string; weeklyOnly?: boolean }[] = [
  { v: 'TOTAL_KM', label: 'Tổng km trong kỳ', unit: 'km' },
  { v: 'RUN_COUNT', label: 'Số bài chạy trong kỳ', unit: 'bài' },
  { v: 'RUN_KM', label: 'Một bài dài ít nhất', unit: 'km' },
  { v: 'CHECKIN', label: 'Điểm danh (có bài chạy)', unit: 'lần' },
  { v: 'CHALLENGE_JOINS', label: 'Tham gia thử thách', unit: 'thử thách' },
  { v: 'WEEK_KM', label: 'Km trong tuần', unit: 'km', weeklyOnly: true },
  { v: 'WEEK_RUN_DAYS', label: 'Số ngày chạy trong tuần', unit: 'ngày', weeklyOnly: true },
]
const EMPTY: AdminQuest = { title: '', description: '', period: 'EVENT', metric: 'TOTAL_KM', target: 20, reward_xu: 50, is_active: true, starts_at: null, ends_at: null, min_vip_tier: 0 }
const toLocal = (iso: string | null) => (iso ? new Date(new Date(iso).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '')
const fromLocal = (v: string) => (v ? new Date(v).toISOString() : null)
const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('vi-VN') : '')

/** Nhiệm vụ: admin tạo / sửa / tắt; hoàn thành là tự nhận Xu (không có XP — XP chỉ từ km) */
export function QuestsTab() {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['admin', 'quests'], queryFn: listQuests })
  const [edit, setEdit] = useState<AdminQuest | null>(null)
  const save = useMutation({
    mutationFn: saveQuest,
    onSuccess: () => { toast.success('Đã lưu nhiệm vụ'); setEdit(null); void qc.invalidateQueries({ queryKey: ['admin', 'quests'] }); void qc.invalidateQueries({ queryKey: ['game'] }) },
    onError: (e) => toast.error(adminErrorMessage(e)),
  })
  const set = (patch: Partial<AdminQuest>) => edit && setEdit({ ...edit, ...patch })
  const metric = METRICS.find((m) => m.v === edit?.metric)

  return (
    <div className="space-y-3">
      <Button block onClick={() => setEdit({ ...EMPTY, starts_at: new Date().toISOString(), ends_at: new Date(Date.now() + 7 * 86_400_000).toISOString() })}>
        <Plus className="size-4" aria-hidden />Tạo nhiệm vụ
      </Button>
      {q.isPending ? <Skeleton className="h-40" /> : q.isError ? <ErrorState message={adminErrorMessage(q.error)} error={q.error} onRetry={() => void q.refetch()} />
        : !q.data.length ? <EmptyState icon={Target} title="Chưa có nhiệm vụ" />
        : (
          <ul className="divide-y divide-border rounded-xl border border-border bg-surface">
            {q.data.map((x) => (
              <li key={x.id}>
                <button onClick={() => setEdit(x)} className={cn('flex w-full items-center gap-3 p-3 text-left', !x.is_active && 'opacity-50')}>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{x.title}</span>
                    <span className="block text-xs text-fg-muted">
                      {PERIODS.find((p) => p.v === x.period)?.label} · {METRICS.find((m) => m.v === x.metric)?.label ?? x.metric} {formatNumber(x.target)}
                      {x.period === 'EVENT' ? ` · ${fmt(x.starts_at)}–${fmt(x.ends_at)}` : ''}{x.min_vip_tier ? ` · VIP${x.min_vip_tier}+` : ''}{!x.is_active ? ' · đã tắt' : ''}
                    </span>
                    <span className="block text-xs text-fg-subtle">{formatNumber(x.completions ?? 0)} lượt hoàn thành · đã trả {formatCoin(x.xu_paid ?? 0)} Xu</span>
                  </span>
                  <span className="font-mono text-sm font-bold text-coin">{x.reward_xu ? `+${formatCoin(x.reward_xu)}` : '—'}</span>
                </button>
              </li>
            ))}
          </ul>
        )}

      <Sheet open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? 'Sửa nhiệm vụ' : 'Tạo nhiệm vụ'}
        footer={<Button block onClick={() => edit && save.mutate(edit)} loading={save.isPending} disabled={!edit || edit.title.trim().length < 2 || !(edit.target > 0)}>Lưu</Button>}>
        {edit && (
          <div className="space-y-3">
            <Field label="Tên nhiệm vụ" htmlFor="q-title"><Input id="q-title" value={edit.title} maxLength={80} onChange={(e) => set({ title: e.target.value })} placeholder="VD: Tuần lễ chạy 30 km" /></Field>
            <Field label="Mô tả (hiện dưới tên)" htmlFor="q-desc"><Textarea id="q-desc" rows={2} value={edit.description ?? ''} onChange={(e) => set({ description: e.target.value })} /></Field>
            <div className="grid grid-cols-4 gap-1.5" role="radiogroup" aria-label="Kỳ">
              {PERIODS.map((p) => (
                <button key={p.v} role="radio" aria-checked={edit.period === p.v}
                  onClick={() => set({ period: p.v, metric: METRICS.find((m) => m.v === edit.metric)?.weeklyOnly && p.v !== 'WEEKLY' ? 'TOTAL_KM' : edit.metric })}
                  className={cn('rounded-lg border py-2 text-xs font-semibold', edit.period === p.v ? 'border-brand bg-brand/10' : 'border-border text-fg-muted')}>{p.label}</button>
              ))}
            </div>
            <Field label="Chỉ số" htmlFor="q-metric">
              <select id="q-metric" value={edit.metric} onChange={(e) => set({ metric: e.target.value as QuestMetric })}
                className="h-11 w-full rounded-xl border border-border bg-surface px-3 text-sm">
                {METRICS.filter((m) => !m.weeklyOnly || edit.period === 'WEEKLY').map((m) => <option key={m.v} value={m.v}>{m.label}</option>)}
              </select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label={`Mục tiêu (${metric?.unit ?? ''})`} htmlFor="q-target"><Input id="q-target" inputMode="decimal" className="font-mono" value={edit.target || ''}
                onChange={(e) => set({ target: Number(e.target.value.replace(',', '.')) || 0 })} /></Field>
              <Field label="Thưởng (Xu)" htmlFor="q-xu"><Input id="q-xu" inputMode="numeric" className="font-mono" value={edit.reward_xu || ''}
                onChange={(e) => set({ reward_xu: Number(e.target.value.replace(/\D/g, '')) || 0 })} /></Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Bắt đầu" htmlFor="q-start" hint={edit.period === 'EVENT' ? 'Bắt buộc' : 'Để trống = ngay'}>
                <Input id="q-start" type="datetime-local" value={toLocal(edit.starts_at)} onChange={(e) => set({ starts_at: fromLocal(e.target.value) })} /></Field>
              <Field label="Kết thúc" htmlFor="q-end" hint={edit.period === 'EVENT' ? 'Bắt buộc' : 'Để trống = không hạn'}>
                <Input id="q-end" type="datetime-local" value={toLocal(edit.ends_at)} onChange={(e) => set({ ends_at: fromLocal(e.target.value) })} /></Field>
            </div>
            <div className="grid grid-cols-4 gap-1.5" role="radiogroup" aria-label="Dành cho">
              {[0, 1, 2, 3].map((t) => (
                <button key={t} role="radio" aria-checked={edit.min_vip_tier === t} onClick={() => set({ min_vip_tier: t })}
                  className={cn('rounded-lg border py-2 text-xs font-semibold', edit.min_vip_tier === t ? 'border-brand bg-brand/10' : 'border-border text-fg-muted')}>
                  {t === 0 ? 'Mọi người' : `VIP${t}+`}
                </button>
              ))}
            </div>
            <label className="flex items-center justify-between text-sm font-medium">Đang bật
              <input type="checkbox" checked={edit.is_active} onChange={(e) => set({ is_active: e.target.checked })} className="size-5 accent-[var(--color-brand)]" /></label>
            <p className="text-xs text-fg-subtle">Hoàn thành là tự cộng Xu, mỗi kỳ một lần (sự kiện: một lần cả đợt). Bài chạy bị hủy thì thu hồi thưởng.</p>
          </div>
        )}
      </Sheet>
    </div>
  )
}
