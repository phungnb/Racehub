'use client'

import Link from 'next/link'
import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { MessageCircle, MoreVertical } from 'lucide-react'
import { toast } from 'sonner'
import { Avatar, ConfirmSheet, EmptyState, ErrorState, PageHeader, Skeleton } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { routes } from '@/shared/config/routes'
import { formatRelative } from '@/shared/lib/format'
import { clearDirectThread, getInbox, socialErrorMessage, type InboxItem } from '../api/socialApi'
import { socialKeys } from '../hooks/keys'

/** Hộp thư: các cuộc trò chuyện 1-1, mới nhất trước, đậm nếu có tin chưa đọc */
export function InboxScreen() {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: socialKeys.inbox, queryFn: getInbox, refetchInterval: 15_000 })
  const [target, setTarget] = useState<InboxItem | null>(null)
  const press = useRef<ReturnType<typeof setTimeout> | null>(null)
  const longPressed = useRef(false)
  const clear = useMutation({
    mutationFn: (user: string) => clearDirectThread(user),
    onSuccess: (_, user) => {
      toast('Đã xóa cuộc trò chuyện ở phía bạn')
      setTarget(null)
      void qc.invalidateQueries({ queryKey: socialKeys.inbox })
      void qc.invalidateQueries({ queryKey: socialKeys.unread })
      void qc.invalidateQueries({ queryKey: socialKeys.thread(user) })
    },
    onError: (e) => toast.error(socialErrorMessage(e)),
  })
  const startPress = (t: InboxItem) => {
    press.current = setTimeout(() => { longPressed.current = true; setTarget(t); navigator.vibrate?.(15) }, 500)
  }
  const endPress = () => { if (press.current) clearTimeout(press.current); press.current = null }
  return (
    <div className="space-y-4 animate-fade-in">
      <PageHeader title="Tin nhắn" subtitle="Nhắn riêng với runner bạn theo dõi, bạn kết nối hoặc cùng CLB" />
      {q.isPending ? (
        <div className="space-y-2">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-16" />)}</div>
      ) : q.isError ? (
        <ErrorState message="Không tải được hộp thư." error={q.error} onRetry={() => void q.refetch()} />
      ) : !q.data.length ? (
        <EmptyState icon={MessageCircle} title="Chưa có tin nhắn"
          description="Mở hồ sơ một runner rồi bấm Nhắn tin. Bạn nhắn được khi người đó theo dõi bạn, là bạn kết nối, hoặc cùng CLB." />
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
          {q.data.map((t) => (
            <li key={t.user.id} className="flex items-center hover:bg-surface-2">
              <Link href={routes.message(t.user.id)} className="flex min-h-16 min-w-0 flex-1 items-center gap-3 py-2.5 pl-3 pr-1 [-webkit-touch-callout:none]"
                onClick={(e) => { if (longPressed.current) { e.preventDefault(); longPressed.current = false } }}
                onContextMenu={(e) => { e.preventDefault(); setTarget(t) }}
                onTouchStart={() => startPress(t)} onTouchEnd={endPress} onTouchMove={endPress} onTouchCancel={endPress}>
                <Avatar src={t.user.avatar_url} name={t.user.display_name} size="md" />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-2">
                    <span className={cn('min-w-0 flex-1 truncate', t.unread ? 'font-bold' : 'font-semibold')}>{t.user.display_name ?? 'Runner'}</span>
                    <span className="shrink-0 text-xs text-fg-subtle">{formatRelative(t.last_message_at)}</span>
                  </span>
                  <span className={cn('block truncate text-sm', t.unread ? 'font-semibold text-fg' : 'text-fg-muted')}>
                    {t.last ? `${t.last.mine ? 'Bạn: ' : ''}${t.last.deleted ? 'Tin nhắn đã được thu hồi' : t.last.body}` : ''}
                  </span>
                </span>
                {t.unread > 0 && (
                  <span className="grid min-w-6 place-items-center rounded-full bg-live px-1.5 text-xs font-bold leading-6 text-white" aria-label={`${t.unread} tin chưa đọc`}>
                    {t.unread > 99 ? '99+' : t.unread}
                  </span>
                )}
              </Link>
              <button type="button" onClick={() => setTarget(t)} aria-label={`Tùy chọn cuộc trò chuyện với ${t.user.display_name ?? 'Runner'}`}
                className="grid size-11 shrink-0 place-items-center rounded-full text-fg-subtle hover:bg-surface-2">
                <MoreVertical className="size-4" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
      <ConfirmSheet open={!!target} onClose={() => setTarget(null)} title={`Xóa cuộc trò chuyện với ${target?.user.display_name ?? 'Runner'}?`}
        confirmLabel="Xóa" loading={clear.isPending} onConfirm={() => target && clear.mutate(target.user.id)}
        description="Chỉ xóa ở phía bạn, người kia vẫn giữ nguyên tin nhắn. Khi có tin mới, cuộc trò chuyện hiện lại (không kèm tin cũ)." />
    </div>
  )
}
