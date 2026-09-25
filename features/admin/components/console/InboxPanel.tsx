'use client'

import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, CheckCircle2, Receipt, Store, Swords, UserPlus, Users, type LucideIcon } from 'lucide-react'
import { Card, Skeleton } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { adminInbox, type AdminInbox } from '../../api/consoleApi'

export const inboxKey = ['admin', 'inbox'] as const
export const useAdminInbox = () => useQuery({ queryKey: inboxKey, queryFn: adminInbox, refetchInterval: 60_000 })

/** "Việc cần xử lý": mỗi ô bấm được, đưa tới đúng tab */
export function InboxPanel({ onGo }: { onGo: (tab: string) => void }) {
  const q = useAdminInbox()
  if (q.isPending) return <Skeleton className="h-36" />
  if (q.isError || !q.data) return null
  const d: AdminInbox = q.data
  const items: { key: keyof AdminInbox; tab: string; label: string; icon: LucideIcon; urgent: boolean }[] = [
    { key: 'orders', tab: 'orders', label: 'Đơn chờ xác nhận', icon: Receipt, urgent: true },
    { key: 'reviews', tab: 'review', label: 'Bài chạy chờ duyệt', icon: CheckCircle2, urgent: true },
    { key: 'partners', tab: 'partners', label: 'Hồ sơ đối tác', icon: Store, urgent: true },
    { key: 'cups', tab: 'cups', label: 'Thách đấu chờ duyệt', icon: Swords, urgent: true },
    { key: 'errors', tab: 'system', label: 'Lỗi 24 giờ qua', icon: AlertTriangle, urgent: true },
  ]
  const pending = items.reduce((n, x) => n + Number(d[x.key]), 0)
  return (
    <Card className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Việc cần xử lý</h2>
        <span className={cn('rounded-full px-2.5 py-0.5 text-xs font-bold', pending ? 'bg-danger/15 text-danger' : 'bg-brand/15 text-brand')}>
          {pending ? `${pending} việc` : 'Đã xử lý hết'}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {items.map((x) => {
          const n = Number(d[x.key])
          return (
            <button key={x.key} type="button" onClick={() => onGo(x.tab)}
              className={cn('flex items-center gap-2 rounded-xl border p-3 text-left', n > 0 ? 'border-danger/40 bg-danger/5' : 'border-border')}>
              <x.icon className={cn('size-5 shrink-0', n > 0 ? 'text-danger' : 'text-fg-subtle')} aria-hidden />
              <span className="min-w-0"><span className="block font-mono text-lg font-bold leading-none">{n}</span>
                <span className="block truncate text-xs text-fg-muted">{x.label}</span></span>
            </button>
          )
        })}
        <button type="button" onClick={() => onGo('users')} className="flex items-center gap-2 rounded-xl border border-border p-3 text-left">
          <UserPlus className="size-5 shrink-0 text-brand" aria-hidden />
          <span className="min-w-0"><span className="block font-mono text-lg font-bold leading-none">{d.new_users_7d}</span>
            <span className="block truncate text-xs text-fg-muted">Người mới 7 ngày</span></span>
        </button>
      </div>
      <p className="flex items-center gap-1.5 text-xs text-fg-subtle"><Users className="size-3.5" aria-hidden />{d.active_7d} người có bài chạy trong 7 ngày · {d.banned} tài khoản đang khóa</p>
    </Card>
  )
}
