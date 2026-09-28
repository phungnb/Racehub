'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ShieldCheck } from 'lucide-react'
import { Avatar, Card, EmptyState, ErrorState, Skeleton } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { adminAccountRisks, consoleErrorMessage, RISK_FLAG, type AccountRisk } from '../../api/consoleApi'
import { UserDetail } from './UsersTab'

const PERIODS = [7, 30, 90] as const
const tone = (s: number) => (s >= 60 ? 'bg-danger text-white' : s >= 40 ? 'bg-warning text-black' : 'bg-surface-2 text-fg')

/** Người dùng → Tài khoản bất thường: gợi ý để admin xem xét, không tự khóa ai (migration 010300) */
export function RiskTab() {
  const [days, setDays] = useState<(typeof PERIODS)[number]>(30)
  const [open, setOpen] = useState<string | null>(null)
  const q = useQuery({ queryKey: ['admin', 'risks', days], queryFn: () => adminAccountRisks(days) })
  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <p className="text-sm text-fg-muted">Dấu hiệu dùng chung tài khoản, nuôi nhiều tài khoản, ăn gian Xu. Xem kỹ trước khi khóa.</p>
        <div role="tablist" className="inline-flex rounded-full bg-surface-2 p-1 text-xs font-semibold">
          {PERIODS.map((d) => (
            <button key={d} role="tab" aria-selected={d === days} onClick={() => setDays(d)}
              className={cn('rounded-full px-3 py-1', d === days ? 'bg-surface text-fg shadow-sm' : 'text-fg-subtle')}>{d} ngày</button>
          ))}
        </div>
      </div>
      {q.isPending ? <Skeleton className="h-40" />
        : q.isError ? <ErrorState message={consoleErrorMessage(q.error, 'Không tải được danh sách.')} error={q.error} onRetry={() => void q.refetch()} />
        : !q.data.length ? <EmptyState icon={ShieldCheck} title="Không có tài khoản bất thường" description={`Trong ${days} ngày qua chưa thấy dấu hiệu nào đáng chú ý.`} />
        : q.data.map((r) => (
          <div key={r.user_id} className="space-y-2">
            <RiskCard r={r} active={open === r.user_id} onToggle={() => setOpen(open === r.user_id ? null : r.user_id)} />
            {open === r.user_id && <UserDetail id={r.user_id} />}
          </div>
        ))}
    </div>
  )
}

function RiskCard({ r, active, onToggle }: { r: AccountRisk; active: boolean; onToggle: () => void }) {
  return (
    <Card className={cn('space-y-2', active && 'border-brand')}>
      <button type="button" onClick={onToggle} aria-expanded={active} className="flex w-full items-center gap-3 text-left">
        <Avatar src={r.avatar_url} name={r.name} size="md" />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2 font-semibold">
            <span className="truncate">{r.name}</span>
            {r.banned && <span className="rounded-full bg-danger/15 px-2 py-0.5 text-[11px] font-bold text-danger">Đang khóa</span>}
          </span>
          {r.email && <span className="block truncate text-xs text-fg-subtle">{r.email}</span>}
        </span>
        <span className={cn('grid size-11 shrink-0 place-items-center rounded-full font-mono text-sm font-black', tone(r.score))} aria-label={`Điểm rủi ro ${r.score}`}>{r.score}</span>
      </button>
      <ul className="space-y-1 text-sm">
        {r.flags.map((f) => (
          <li key={f.code}>
            <b>{RISK_FLAG[f.code].label} ×{f.count}</b>
            <span className="block text-xs text-fg-muted">{RISK_FLAG[f.code].hint}</span>
          </li>
        ))}
      </ul>
      <p className="text-xs text-fg-subtle">{active ? 'Bấm lại để thu gọn' : 'Bấm để xem hồ sơ, giao dịch và khóa tài khoản'}</p>
    </Card>
  )
}
