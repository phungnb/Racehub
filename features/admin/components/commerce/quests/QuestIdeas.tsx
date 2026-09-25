'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, CalendarHeart, ChevronDown, Lightbulb, Library, Sparkles } from 'lucide-react'
import { Button, Card, SegmentedControl, Skeleton } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { formatCoin, formatNumber } from '@/shared/lib/format'
import { getQuestInsights, type QuestPeriod } from '../../../api/commerceApi'
import {
  PERIOD_LABEL, QUEST_TEMPLATES, occasionWindow, suggestFromInsights, templateWindow, upcomingOccasions, type QuestDraft,
} from '../../../model/questLibrary'

export type UseIdea = (draft: QuestDraft, window: { starts_at: string | null; ends_at: string | null }, source: string) => void

const rewardText = (d: QuestDraft) => [
  d.reward_xu ? `${formatCoin(d.reward_xu)} Xu` : null, d.reward_badge ? `huy hiệu "${d.reward_badge.title}"` : null,
].filter(Boolean).join(' + ') || 'chưa đặt thưởng'
const targetText = (d: QuestDraft) => (d.tiers?.length ? d.tiers.map((t) => formatNumber(t.target)).join(' / ') : formatNumber(d.target))

/** Gợi ý tạo nhiệm vụ: theo số liệu thật, theo dịp sắp tới, và thư viện mẫu */
export function QuestIdeas({ onUse }: { onUse: UseIdea }) {
  const [open, setOpen] = useState(true)
  const [now] = useState(() => Date.now())
  const [lib, setLib] = useState<QuestPeriod>('DAILY')
  const ins = useQuery({ queryKey: ['admin', 'quest-insights'], queryFn: getQuestInsights, staleTime: 5 * 60_000, retry: false })
  const ideas = ins.data ? suggestFromInsights(ins.data) : []
  const occasions = upcomingOccasions(now, 60)

  return (
    <Card className="space-y-3 p-4">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex w-full items-center gap-2 text-left">
        <Lightbulb className="size-5 text-coin" aria-hidden />
        <span className="flex-1">
          <span className="block text-sm font-bold">Gợi ý nhiệm vụ</span>
          <span className="block text-xs text-fg-muted">
            {ins.data ? `${formatNumber(ins.data.runners_7d)} runner chạy 7 ngày qua · ${formatNumber(ins.data.runners_30d)} trong 30 ngày` : 'Theo số liệu, dịp sắp tới và mẫu có sẵn'}
          </span>
        </span>
        <ChevronDown className={cn('size-4 text-fg-muted transition-transform', open && 'rotate-180')} aria-hidden />
      </button>
      {open && (
        <div className="space-y-4">
          <Section icon={Sparkles} title="Theo số liệu RaceHub">
            {ins.isPending ? <Skeleton className="h-20" />
              : ins.isError ? <p className="text-xs text-fg-muted">Chưa đọc được số liệu (cần migration 004600).</p>
              : ideas.map((s) => (
                <Idea key={s.key} title={s.title} note={s.reason} warn={s.tone === 'warn'}
                  onUse={s.draft ? () => onUse(s.draft!, templateWindow(s.draft!, now), s.title) : undefined} />
              ))}
          </Section>

          <Section icon={CalendarHeart} title="Dịp sắp tới (60 ngày)">
            {occasions.length ? occasions.map((o) => (
              <div key={`${o.key}-${o.date}`} className="space-y-1.5">
                <p className="text-xs font-semibold text-fg-muted">
                  {o.name} · {new Date(`${o.date}T00:00:00+07:00`).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' })}
                  {o.inDays === 0 ? ' · hôm nay' : ` · còn ${o.inDays} ngày`}
                </p>
                {o.ideas.map((d) => (
                  <Idea key={d.title} title={d.title} note={`${targetText(d)} · ${rewardText(d)} · ${d.days} ngày — ${d.note}`}
                    onUse={() => onUse(d, occasionWindow(o.date, d.startOffset, d.days), o.name)} />
                ))}
              </div>
            )) : <p className="text-xs text-fg-muted">Không có dịp nào trong 60 ngày tới.</p>}
          </Section>

          <Section icon={Library} title="Thư viện mẫu">
            <SegmentedControl value={lib} onChange={setLib}
              options={(['DAILY', 'WEEKLY', 'MONTHLY', 'EVENT', 'ONCE'] as QuestPeriod[]).map((p) => ({ value: p, label: PERIOD_LABEL[p].replace('Hằng ', '') }))} />
            {QUEST_TEMPLATES.filter((t) => t.draft.period === lib).map((t) => (
              <Idea key={t.key} title={t.draft.title} note={`${targetText(t.draft)} · ${rewardText(t.draft)} — ${t.why}`}
                onUse={() => onUse(t.draft, templateWindow(t.draft, now), t.draft.title)} />
            ))}
          </Section>
        </div>
      )}
    </Card>
  )
}

function Section({ icon: Icon, title, children }: { icon: typeof Sparkles; title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-fg-subtle"><Icon className="size-3.5" aria-hidden />{title}</h3>
      {children}
    </section>
  )
}

function Idea({ title, note, warn, onUse }: { title: string; note: string; warn?: boolean; onUse?: () => void }) {
  return (
    <div className={cn('flex items-start gap-3 rounded-xl border px-3 py-2.5', warn ? 'border-warning/40 bg-warning/5' : 'border-border')}>
      {warn && <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{title}</p>
        <p className="text-xs text-fg-muted">{note}</p>
      </div>
      {onUse && <Button size="sm" variant="secondary" onClick={onUse}>Dùng</Button>}
    </div>
  )
}
