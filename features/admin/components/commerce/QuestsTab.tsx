'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Gauge, Layers, Plus, Target } from 'lucide-react'
import { toast } from 'sonner'
import { Button, EmptyState, ErrorState, Field, Input, Sheet, Skeleton } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { formatCoin, formatNumber } from '@/shared/lib/format'
import { adminErrorMessage } from '../../api/adminApi'
import { getQuestInsights, listQuests, saveQuest, setQuestLimits, type AdminQuest, type QuestLimits, type QuestPeriod } from '../../api/commerceApi'
import { CATEGORY_LABEL, METRIC_UNIT, PERIOD_LABEL, type QuestDraft } from '../../model/questLibrary'
import { QuestEditor } from './quests/QuestEditor'
import { QuestIdeas, type UseIdea } from './quests/QuestIdeas'

const EMPTY: AdminQuest = { title: '', description: '', period: 'EVENT', metric: 'TOTAL_KM', target: 20, reward_xu: 5, is_active: true,
  starts_at: null, ends_at: null, min_vip_tier: 0, category: 'RUN', params: {}, tiers: null, reward_item: null, reward_badge: null, reward_passes: null }
const fmt = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString('vi-VN') : '')
const LIMIT_KEY: Record<QuestPeriod, keyof QuestLimits> = { DAILY: 'maxDaily', WEEKLY: 'maxWeekly', MONTHLY: 'maxMonthly', EVENT: 'maxEvent', ONCE: 'maxOnce' }
const isLive = (q: AdminQuest, now: number) => q.is_active && (!q.ends_at || Date.parse(q.ends_at) > now)

/** Nhiệm vụ: gợi ý (số liệu, dịp, mẫu) → sửa → ước tính chi phí → đăng. Hoàn thành là tự nhận thưởng; không có XP. */
export function QuestsTab() {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['admin', 'quests'], queryFn: listQuests })
  const [edit, setEdit] = useState<AdminQuest | null>(null)
  const [source, setSource] = useState<string | null>(null)
  const [now] = useState(() => Date.now())
  const save = useMutation({
    mutationFn: saveQuest,
    onSuccess: () => {
      toast.success('Đã lưu nhiệm vụ'); setEdit(null)
      void qc.invalidateQueries({ queryKey: ['admin', 'quests'] }); void qc.invalidateQueries({ queryKey: ['game'] })
    },
    onError: (e) => toast.error(adminErrorMessage(e)),
  })
  const open = (x: AdminQuest, from: string | null = null) => { setSource(from); setEdit(x) }
  const applyIdea: UseIdea = (draft: QuestDraft, w, from) => {
    // Bỏ các trường chỉ dùng cho gợi ý (số ngày, độ lệch ngày bắt đầu, ghi chú)
    const clean = Object.fromEntries(Object.entries(draft).filter(([k]) => !['days', 'startOffset', 'note'].includes(k))) as QuestDraft
    open({ ...EMPTY, ...clean, ...w, is_active: true, min_vip_tier: 0 }, from)
  }

  return (
    <div className="space-y-3">
      <LimitsCard quests={q.data ?? []} now={now} />
      <QuestIdeas onUse={applyIdea} />
      <Button block onClick={() => open({ ...EMPTY, starts_at: new Date().toISOString(), ends_at: new Date(Date.now() + 7 * 86_400_000).toISOString() })}>
        <Plus className="size-4" aria-hidden />Tạo nhiệm vụ trống
      </Button>
      {q.isPending ? <Skeleton className="h-40" /> : q.isError ? <ErrorState message={adminErrorMessage(q.error)} error={q.error} onRetry={() => void q.refetch()} />
        : !q.data.length ? <EmptyState icon={Target} title="Chưa có nhiệm vụ" description="Chọn một gợi ý ở trên để bắt đầu." />
        : (
          <ul className="divide-y divide-border rounded-xl border border-border bg-surface">
            {q.data.map((x) => (
              <li key={x.id}>
                <button onClick={() => open(x)} className={cn('flex w-full items-center gap-3 p-3 text-left', !isLive(x, now) && 'opacity-50')}>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 truncate text-sm font-semibold">
                      {x.title}{x.tiers?.length ? <Layers className="size-3.5 shrink-0 text-fg-subtle" aria-label="Nhiều bậc" /> : null}
                    </span>
                    <span className="block text-xs text-fg-muted">
                      {PERIOD_LABEL[x.period]} · {CATEGORY_LABEL[x.category ?? 'RUN']} · {x.tiers?.length ? x.tiers.map((t) => formatNumber(t.target)).join('/') : formatNumber(x.target)} {METRIC_UNIT[x.metric] ?? ''}
                      {x.period === 'EVENT' ? ` · ${fmt(x.starts_at)}–${fmt(x.ends_at)}` : ''}{x.min_vip_tier ? ` · VIP${x.min_vip_tier}+` : ''}{!isLive(x, now) ? ' · đã tắt / hết hạn' : ''}
                    </span>
                    <span className="block text-xs text-fg-subtle">
                      {formatNumber(x.participants ?? 0)} người tham gia · {formatNumber(x.completions ?? 0)} hoàn thành · đã trả {formatCoin(x.xu_paid ?? 0)} Xu
                      {x.reward_badge ? ' · 🏅' : ''}{x.reward_item ? ' · 🎽' : ''}{x.reward_passes ? ' · 🎟️' : ''}
                    </span>
                  </span>
                  <span className="font-mono text-sm font-bold text-coin">{x.reward_xu ? `+${formatCoin(x.reward_xu)}` : '—'}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      <QuestEditor key={edit?.id ?? source ?? 'new'} edit={edit} onChange={setEdit} onClose={() => setEdit(null)}
        onSave={() => edit && save.mutate(edit)} saving={save.isPending} source={source} />
    </div>
  )
}

/** Số nhiệm vụ đang bật so với giới hạn + trần Xu; admin chỉnh được */
function LimitsCard({ quests, now }: { quests: AdminQuest[]; now: number }) {
  const qc = useQueryClient()
  const ins = useQuery({ queryKey: ['admin', 'quest-insights'], queryFn: getQuestInsights, staleTime: 5 * 60_000, retry: false })
  const [form, setForm] = useState<QuestLimits | null>(null)
  const save = useMutation({
    mutationFn: setQuestLimits,
    onSuccess: () => { toast.success('Đã lưu giới hạn'); setForm(null); void qc.invalidateQueries({ queryKey: ['admin', 'quest-insights'] }) },
    onError: (e) => toast.error(adminErrorMessage(e)),
  })
  const l = ins.data?.limits
  if (!l) return null
  const live = (p: QuestPeriod) => quests.filter((x) => x.period === p && isLive(x, now)).length
  const FIELDS: [keyof QuestLimits, string][] = [['dailyXuCap', 'Trần Xu / ngày'], ['weeklyXuCap', 'Trần Xu / tuần'], ['maxDaily', 'Tối đa nhiệm vụ ngày'],
    ['maxWeekly', 'Tối đa nhiệm vụ tuần'], ['maxMonthly', 'Tối đa nhiệm vụ tháng'], ['maxEvent', 'Tối đa sự kiện cùng lúc'], ['maxOnce', 'Tối đa nhiệm vụ một lần']]
  return (
    <div className="flex items-start gap-3 rounded-xl border border-border bg-surface p-3">
      <Gauge className="mt-0.5 size-5 shrink-0 text-fg-muted" aria-hidden />
      <div className="min-w-0 flex-1 text-xs">
        <p className="font-semibold">Đang bật: {(['DAILY', 'WEEKLY', 'MONTHLY', 'EVENT', 'ONCE'] as QuestPeriod[]).map((p) => `${PERIOD_LABEL[p].replace('Hằng ', '')} ${live(p)}/${l[LIMIT_KEY[p]]}`).join(' · ')}</p>
        <p className="text-fg-muted">Trần Xu từ nhiệm vụ: {formatCoin(l.dailyXuCap)} Xu/ngày · {formatCoin(l.weeklyXuCap)} Xu/tuần (tháng, sự kiện, một lần không trần)</p>
      </div>
      <Button size="sm" variant="ghost" onClick={() => setForm(l)}>Sửa</Button>
      <Sheet open={!!form} onClose={() => setForm(null)} title="Giới hạn nhiệm vụ"
        description="Người dùng chỉ nên thấy vài nhiệm vụ mỗi kỳ; trần Xu giữ cân bằng kinh tế."
        footer={<Button block loading={save.isPending} onClick={() => form && save.mutate(form)}>Lưu</Button>}>
        {form && (
          <div className="grid grid-cols-2 gap-3">
            {FIELDS.map(([k, label]) => (
              <Field key={k} label={label} htmlFor={`lim-${k}`}>
                <Input id={`lim-${k}`} inputMode="decimal" className="font-mono" value={form[k]}
                  onChange={(e) => setForm({ ...form, [k]: Number(e.target.value.replace(',', '.')) || 0 })} />
              </Field>
            ))}
          </div>
        )}
      </Sheet>
    </div>
  )
}
