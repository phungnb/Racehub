'use client'

import Link from 'next/link'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Copy, Crown, History } from 'lucide-react'
import { useVipTier } from '@/features/insights'
import { EmptyState, ErrorState, Sheet, Skeleton } from '@/shared/ui'
import { formatNumber } from '@/shared/lib/format'
import { routes } from '@/shared/config/routes'
import { challengeErrorMessage, getChallengeTemplates, type ChallengeTemplate } from '../../api/challengeApi'
import { FORMAT_META, type ChallengeFormat } from '../../model/challenge'

/** Dùng lại thử thách mình đã tạo làm mẫu (VIP2): giữ luật chơi, quy mô, đội, thời lượng */
export function TemplatePicker({ onPick }: { onPick: (t: ChallengeTemplate) => void }) {
  const vip = useVipTier()
  const [open, setOpen] = useState(false)
  const q = useQuery({ queryKey: ['challenge-templates'], queryFn: getChallengeTemplates, enabled: open && vip.tier >= 2 })
  if (vip.loading) return null
  if (vip.tier < 2) {
    return (
      <Link href={routes.plan} className="flex items-center gap-3 rounded-xl border border-dashed border-border p-3 text-sm">
        <Crown className="size-4 shrink-0 text-coin" aria-hidden />
        <span className="flex-1 text-fg-muted">Nhân bản thử thách cũ làm mẫu — dành cho VIP2</span>
      </Link>
    )
  }
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="flex w-full items-center gap-3 rounded-xl border border-border bg-surface p-3 text-left text-sm font-semibold">
        <Copy className="size-4 shrink-0 text-brand" aria-hidden />
        <span className="flex-1">Dùng lại thử thách cũ</span>
        <span className="rounded bg-coin/15 px-1.5 text-[11px] font-bold text-coin">VIP</span>
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Chọn thử thách làm mẫu" description="Giữ luật chơi, quy mô, đội và số ngày; thời gian dời về từ giờ tới. Phí tạo tính lại như thử thách mới.">
        {q.isPending ? <Skeleton className="h-40" /> : q.isError ? <ErrorState message={challengeErrorMessage(q.error)} onRetry={() => void q.refetch()} />
          : !q.data.length ? <EmptyState icon={History} title="Bạn chưa tạo thử thách nào" />
          : (
            <ul className="divide-y divide-border">
              {q.data.map((t) => (
                <li key={t.id}>
                  <button type="button" className="flex w-full flex-col items-start gap-0.5 py-3 text-left" onClick={() => { onPick(t); setOpen(false) }}>
                    <span className="font-semibold">{t.title}</span>
                    <span className="text-xs text-fg-muted">
                      {FORMAT_META[t.format as ChallengeFormat]?.label ?? t.format} · {t.days} ngày · tối đa {formatNumber(t.max_slots)} người
                      {Number(t.target_value) > 0 ? ` · mục tiêu ${formatNumber(Number(t.target_value))}` : ''} · {new Date(t.start_date).toLocaleDateString('vi-VN')}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
      </Sheet>
    </>
  )
}
