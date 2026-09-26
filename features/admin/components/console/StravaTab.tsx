'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import { Card, ConfirmSheet, ErrorState, Input, Skeleton } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { formatNumber } from '@/shared/lib/format'
import { adminSetStravaPolicy, adminStravaSharingStats, type StravaSharePolicy } from '@/features/integrations'
import { adminErrorMessage } from '../../api/adminApi'

const OPTIONS: { value: StravaSharePolicy; title: string; desc: string }[] = [
  { value: 'OPT_IN', title: 'Mặc định hiện — runner tự tắt được (đang dùng)', desc: 'Kết nối Strava = đồng ý: bài lên bảng tin CLB, BXH, thử thách, giải chạy. Runner tắt ở Cài đặt → Quyền riêng tư thì chỉ tính cho riêng họ.' },
  { value: 'OWNER_ONLY', title: 'A — chỉ chủ bài thấy', desc: 'Tuân thủ chặt nhất Thoả thuận API Strava. Bài Strava không bao giờ hiện cho người khác; muốn lên BXH phải ghi bằng app RaceHub.' },
  { value: 'ALL', title: 'B — luôn hiện (rủi ro cao)', desc: 'Như trước đây. Có thể vi phạm Thoả thuận API Strava và bị thu hồi quyền truy cập.' },
]

/** Chính sách hiển thị bài Strava cho người khác (migration 007000) */
export function StravaTab() {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['admin', 'strava-sharing'], queryFn: adminStravaSharingStats })
  const [pick, setPick] = useState<StravaSharePolicy | null>(null)
  const [reason, setReason] = useState('')
  const save = useMutation({
    mutationFn: () => adminSetStravaPolicy(pick!, reason.trim()),
    onSuccess: (r) => {
      toast.success(`Đã chuyển chính sách · ${formatNumber(r.changed)} bài Strava được cập nhật`)
      setPick(null); setReason('')
      void qc.invalidateQueries({ queryKey: ['admin', 'strava-sharing'] })
    },
    onError: (e) => toast.error(adminErrorMessage(e)),
  })
  if (q.isPending) return <Skeleton className="h-64" />
  if (q.isError || !q.data) return <ErrorState message={adminErrorMessage(q.error)} error={q.error} onRetry={() => void q.refetch()} />
  const s = q.data
  return (
    <div className="space-y-4">
      <Card className="grid grid-cols-2 gap-3 text-center sm:grid-cols-4">
        {[['Đã kết nối Strava', s.connected], ['Đang hiện', s.opted_in], ['Đã tắt (chỉ mình tôi)', s.opted_out], ['Bài Strava đang ẩn', s.hidden_runs]].map(([l, v]) => (
          <div key={l as string}><p className="text-xs text-fg-subtle">{l}</p><p className="font-mono tabular text-xl font-bold">{formatNumber(v as number)}</p></div>
        ))}
      </Card>
      <ul className="space-y-2">
        {OPTIONS.map((o) => {
          const active = s.policy === o.value
          return (
            <li key={o.value}>
              <button type="button" disabled={active} onClick={() => setPick(o.value)}
                className={cn('w-full rounded-[var(--radius-card)] border p-3 text-left', active ? 'border-brand bg-brand/10' : 'border-border hover:border-fg-subtle')}>
                <p className="flex items-center gap-2 font-semibold">{active && <ShieldCheck className="size-4 text-brand" aria-hidden />}{o.title}{active && <span className="text-xs font-normal text-brand">· đang dùng</span>}</p>
                <p className="mt-1 text-sm text-fg-muted">{o.desc}</p>
              </button>
            </li>
          )
        })}
      </ul>
      <p className="text-xs text-fg-subtle">Đổi chính sách áp dụng ngay cho mọi bài Strava: thêm / gỡ khỏi bảng tin CLB, thử thách đang diễn ra, giải chạy ảo. Được ghi nhật ký quản trị.</p>
      <ConfirmSheet open={pick !== null} onClose={() => setPick(null)} danger={pick === 'ALL'} loading={save.isPending}
        title="Đổi chính sách bài Strava?" confirmLabel="Áp dụng" onConfirm={() => { if (reason.trim().length >= 3) save.mutate(); else toast.error('Ghi lý do (ít nhất 3 ký tự)') }}>
        <div className="space-y-2 text-sm text-fg-muted">
          <p>{OPTIONS.find((o) => o.value === pick)?.title}</p>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Lý do (vd: Strava yêu cầu ngày …)" aria-label="Lý do" />
        </div>
      </ConfirmSheet>
    </div>
  )
}
