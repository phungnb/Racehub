'use client'

import { useState } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { ScrollText } from 'lucide-react'
import { Button, Card, EmptyState, ErrorState, Skeleton } from '@/shared/ui'
import { adminAuditList, AUDIT_LABEL, auditLabel } from '../../api/consoleApi'

const GROUPS: { value: string; label: string }[] = [
  { value: '', label: 'Tất cả' }, { value: 'USER_', label: 'Người dùng' }, { value: 'CHALLENGE_', label: 'Thử thách' },
  { value: 'CONFIRM_ORDER', label: 'Đơn hàng' }, { value: 'ADMIN_GRANT_XU', label: 'Xu' }, { value: 'PARTNER_', label: 'Đối tác' },
  { value: 'SAVE_', label: 'Cấu hình bán hàng' }, { value: 'PUBLISH_CONFIG', label: 'Chính sách' },
]

/** Nhật ký quản trị (chỉ thêm, không sửa / xóa được): ai làm gì, lúc nào, lý do */
export function AuditTab() {
  const [action, setAction] = useState('')
  const q = useInfiniteQuery({
    queryKey: ['admin', 'audit', action],
    queryFn: ({ pageParam }) => adminAuditList(action, pageParam),
    initialPageParam: null as number | null,
    getNextPageParam: (last) => (last.length === 100 ? last[last.length - 1].id : undefined),
  })
  const rows = q.data?.pages.flat() ?? []
  return (
    <div className="space-y-3">
      <div className="flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none]">
        {GROUPS.map((g) => (
          <button key={g.value} type="button" aria-pressed={action === g.value} onClick={() => setAction(g.value)}
            className={`shrink-0 rounded-full border px-3 py-1.5 text-sm font-semibold ${action === g.value ? 'border-brand bg-brand text-brand-fg' : 'border-border text-fg-muted'}`}>{g.label}</button>
        ))}
      </div>
      {q.isPending ? <Skeleton className="h-60" /> : q.isError ? <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        : !rows.length ? <EmptyState icon={ScrollText} title="Chưa có nhật ký" description="Mọi thao tác quản trị sẽ được ghi lại ở đây." />
        : (
          <Card className="p-0">
            <ul className="divide-y divide-border">
              {rows.map((r) => (
                <li key={r.id} className="space-y-0.5 px-3 py-2.5 text-sm">
                  <p className="flex flex-wrap items-center justify-between gap-2">
                    <b title={r.action}>{AUDIT_LABEL[r.action] ? auditLabel(r.action) : r.action}</b>
                    <span className="text-xs text-fg-subtle">{new Date(r.at).toLocaleString('vi-VN')}</span>
                  </p>
                  <p className="text-xs text-fg-muted">{r.actor ?? 'Hệ thống'} → <span className="font-mono">{r.target}</span></p>
                  {r.reason && <p className="text-xs">Lý do: {r.reason}</p>}
                  {(r.old_value != null || r.new_value != null) && (
                    <details className="text-xs text-fg-subtle"><summary className="cursor-pointer">Chi tiết</summary>
                      <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-bg p-2">{JSON.stringify({ truoc: r.old_value, sau: r.new_value }, null, 1)}</pre>
                    </details>
                  )}
                </li>
              ))}
            </ul>
          </Card>
        )}
      {q.hasNextPage && <Button block variant="secondary" loading={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()}>Xem cũ hơn</Button>}
    </div>
  )
}
