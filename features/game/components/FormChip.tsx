'use client'

import { Moon, Sprout, TrendingDown, TrendingUp, Activity, Coffee } from 'lucide-react'
import { cn } from '@/shared/lib/cn'
import type { FormStatus } from '../api/gameApi'
import { useRunnerForm } from '../hooks/useGame'

export const FORM_META: Record<FormStatus, { label: string; icon: typeof Activity; tone: string }> = {
  RISING: { label: 'Đang lên phong độ', icon: TrendingUp, tone: 'bg-brand/15 text-brand' },
  STEADY: { label: 'Phong độ ổn định', icon: Activity, tone: 'bg-xp/15 text-xp' },
  SLOWING: { label: 'Chậm lại', icon: TrendingDown, tone: 'bg-warning/15 text-warning' },
  RESTING: { label: 'Tạm nghỉ', icon: Coffee, tone: 'bg-surface-2 text-fg-muted' },
  LONG_BREAK: { label: 'Nghỉ dài', icon: Moon, tone: 'bg-surface-2 text-fg-muted' },
  NEW: { label: 'Chưa có bài chạy', icon: Sprout, tone: 'bg-surface-2 text-fg-muted' },
}

/** Phong độ 28 ngày (không ảnh hưởng cấp độ). Với chính mình: gợi ý thưởng quay lại khi đang nghỉ. */
export function FormChip({ userId, showHint = false, className }: { userId?: string | null; showHint?: boolean; className?: string }) {
  const q = useRunnerForm(userId)
  if (!q.data) return null
  const f = q.data
  const m = FORM_META[f.status] ?? FORM_META.NEW
  const resting = f.status === 'RESTING' || f.status === 'LONG_BREAK'
  return (
    <div className={cn('space-y-1', className)}>
      <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold', m.tone)}
        title={`28 ngày qua: ${f.km_28d} km, ${f.runs_28d} buổi`}>
        <m.icon className="size-3" aria-hidden />{m.label}{f.days_since !== null && resting ? ` · ${f.days_since} ngày` : ''}
      </span>
      {showHint && resting && f.comeback_xu > 0 && (
        <p className="text-xs text-fg-muted">Cấp độ của bạn được giữ nguyên. Chạy một bài để quay lại — nhận +{f.comeback_xu} Xu chào mừng.</p>
      )}
    </div>
  )
}
