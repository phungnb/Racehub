'use client'

import Link from 'next/link'
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Ban, Flag, MessageCircle, MoreHorizontal, UserCheck, UserPlus } from 'lucide-react'
import { toast } from 'sonner'
import { Avatar, Button, ConfirmSheet, Sheet, Skeleton } from '@/shared/ui'
import { routes } from '@/shared/config/routes'
import {
  blockRunner, followList, followRunner, followStatus, socialErrorMessage, unblockRunner, unfollowRunner, type FollowStatus,
} from '../api/socialApi'
import { socialKeys } from '../hooks/keys'
import { ReportRunnerSheet } from './ReportRunnerSheet'

/**
 * Hồ sơ runner: số người theo dõi / đang theo dõi, nút Theo dõi (một chiều như Strava), Nhắn tin, Chặn / Báo cáo.
 * Máy chủ chưa có migration 011500 → không hiện gì.
 */
export function FollowPanel({ userId, name }: { userId: string; name: string }) {
  const qc = useQueryClient()
  const key = socialKeys.status(userId)
  const q = useQuery({ queryKey: key, queryFn: () => followStatus(userId), retry: false })
  const [list, setList] = useState<'FOLLOWERS' | 'FOLLOWING' | null>(null)
  const [sheet, setSheet] = useState<'menu' | 'report' | 'block' | 'unfollow' | null>(null)
  const done = (s: FollowStatus) => {
    qc.setQueryData(key, s)
    void qc.invalidateQueries({ queryKey: socialKeys.feed })
    void qc.invalidateQueries({ queryKey: socialKeys.suggestions })
  }
  const follow = useMutation({
    mutationFn: () => followRunner(userId),
    onSuccess: (s) => { done(s); toast.success(`Đã theo dõi ${name}`, { description: 'Hoạt động của họ sẽ hiện ở mục Đang theo dõi trên Trang chủ.' }) },
    onError: (e) => toast.error(socialErrorMessage(e)),
  })
  const unfollow = useMutation({ mutationFn: () => unfollowRunner(userId), onSuccess: (s) => { done(s); setSheet(null) }, onError: (e) => toast.error(socialErrorMessage(e)) })
  const block = useMutation({
    mutationFn: () => (q.data?.blocked_by_me ? unblockRunner(userId) : blockRunner(userId)),
    onSuccess: () => { toast.success(q.data?.blocked_by_me ? `Đã bỏ chặn ${name}` : `Đã chặn ${name}`); setSheet(null); void qc.invalidateQueries({ queryKey: ['social'] }) },
    onError: (e) => toast.error(socialErrorMessage(e)),
  })

  if (q.isPending) return <Skeleton className="mx-auto h-11 w-64" />
  if (q.isError || !q.data) return null
  const s = q.data

  return (
    <div className="space-y-3">
      <div className="flex justify-center gap-5 text-sm">
        <button type="button" onClick={() => setList('FOLLOWERS')} className="min-h-11 px-1">
          <b className="text-base text-fg">{s.followers}</b> <span className="text-fg-muted">người theo dõi</span>
        </button>
        <button type="button" onClick={() => setList('FOLLOWING')} className="min-h-11 px-1">
          <span className="text-fg-muted">Đang theo dõi</span> <b className="text-base text-fg">{s.following_count}</b>
        </button>
      </div>
      {s.blocked ? (
        <div className="flex justify-center gap-2">
          <p className="self-center text-sm text-fg-muted">{s.blocked_by_me ? 'Bạn đã chặn người này.' : 'Không thể theo dõi hay nhắn tin cho người này.'}</p>
          <Button size="sm" variant="ghost" onClick={() => setSheet('menu')} aria-label="Tùy chọn"><MoreHorizontal className="size-4" aria-hidden /></Button>
        </div>
      ) : (
        <div className="flex justify-center gap-2">
          {s.following ? (
            <Button variant="secondary" onClick={() => setSheet('unfollow')}><UserCheck className="size-4" aria-hidden />Đang theo dõi</Button>
          ) : (
            <Button onClick={() => follow.mutate()} loading={follow.isPending}>
              <UserPlus className="size-4" aria-hidden />{s.followed_by ? 'Theo dõi lại' : 'Theo dõi'}
            </Button>
          )}
          {s.can_message && (
            <Link href={routes.message(userId)}><Button variant="secondary"><MessageCircle className="size-4" aria-hidden />Nhắn tin</Button></Link>
          )}
          <Button variant="ghost" onClick={() => setSheet('menu')} aria-label="Tùy chọn khác"><MoreHorizontal className="size-5" aria-hidden /></Button>
        </div>
      )}
      {s.followed_by && !s.blocked && <p className="text-center text-xs text-fg-subtle">{name} đang theo dõi bạn</p>}

      <Sheet open={sheet === 'menu'} onClose={() => setSheet(null)} title={name}>
        <div className="grid gap-2">
          <Button variant="secondary" block onClick={() => setSheet('report')}><Flag className="size-4" aria-hidden />Báo cáo</Button>
          {(!s.blocked || s.blocked_by_me) && (
            <Button variant="danger" block onClick={() => setSheet('block')}><Ban className="size-4" aria-hidden />{s.blocked_by_me ? 'Bỏ chặn' : 'Chặn'}</Button>
          )}
        </div>
      </Sheet>
      <ConfirmSheet open={sheet === 'unfollow'} onClose={() => setSheet(null)} title={`Bỏ theo dõi ${name}?`} confirmLabel="Bỏ theo dõi"
        description="Hoạt động của họ sẽ không còn hiện ở mục Đang theo dõi." loading={unfollow.isPending} onConfirm={() => unfollow.mutate()} />
      <ConfirmSheet open={sheet === 'block'} onClose={() => setSheet(null)} title={s.blocked_by_me ? `Bỏ chặn ${name}?` : `Chặn ${name}?`}
        confirmLabel={s.blocked_by_me ? 'Bỏ chặn' : 'Chặn'} loading={block.isPending} onConfirm={() => block.mutate()}
        description={s.blocked_by_me ? 'Hai bạn lại có thể theo dõi và nhắn tin cho nhau.' : 'Hai bạn tự bỏ theo dõi nhau, không nhắn tin được cho nhau, kết nối bị hủy. Người kia không được báo.'} />
      {sheet === 'report' && <ReportRunnerSheet userId={userId} name={name} context="PROFILE" onClose={() => setSheet(null)} />}
      <FollowListSheet userId={userId} kind={list} onClose={() => setList(null)} />
    </div>
  )
}

function FollowListSheet({ userId, kind, onClose }: { userId: string; kind: 'FOLLOWERS' | 'FOLLOWING' | null; onClose: () => void }) {
  const q = useQuery({ queryKey: socialKeys.list(userId, kind ?? ''), queryFn: () => followList(userId, kind!), enabled: !!kind })
  return (
    <Sheet open={!!kind} onClose={onClose} title={kind === 'FOLLOWING' ? 'Đang theo dõi' : 'Người theo dõi'}>
      {q.isPending ? (
        <div className="space-y-2">{Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-12" />)}</div>
      ) : !q.data?.length ? (
        <p className="py-6 text-center text-sm text-fg-muted">Chưa có ai.</p>
      ) : (
        <ul className="space-y-1">
          {q.data.map((p) => (
            <li key={p.id}>
              <Link href={routes.athlete(p.id)} onClick={onClose} className="flex min-h-12 items-center gap-3 rounded-xl px-2 hover:bg-surface-2">
                <Avatar src={p.avatar_url} name={p.display_name} size="sm" />
                <span className="min-w-0 flex-1 truncate text-sm font-semibold">{p.display_name ?? 'Runner'}{p.is_me && ' (bạn)'}</span>
                {p.following && !p.is_me && <span className="text-xs text-fg-subtle">Đang theo dõi</span>}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  )
}
