'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { ChevronRight, Newspaper, TrendingUp } from 'lucide-react'
import { useMyProfile } from '@/features/auth'
import { Button, EmptyState, ErrorState, Skeleton } from '@/shared/ui'
import { formatKm } from '@/shared/lib/format'
import { routes } from '@/shared/config/routes'
import type { ClubPost } from '../../api/postsApi'
import { useClub } from '../../hooks/useClub'
import { useClubFeed } from '../../hooks/useClubFeed'
import { useClubLeaderboard } from '../../hooks/useLeaderboard'
import { CommentsSheet } from './CommentsSheet'
import { Composer } from './Composer'
import { PostCard } from './PostCard'

export function ClubFeedScreen({ clubId }: { clubId: string }) {
  const { uid, isStaff } = useClub(clubId)
  const { profile } = useMyProfile()
  const { pinned, posts, items } = useClubFeed(clubId, uid)
  const [commentsFor, setCommentsFor] = useState<ClubPost | null>(null)
  const focus = useSearchParams().get('post')
  const more = useRef<HTMLDivElement>(null)

  // Mở từ thông báo (?post=…): cuộn tới bài
  useEffect(() => {
    if (!focus || posts.isLoading) return
    document.getElementById(`post-${focus}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [focus, posts.isLoading])

  // Tự tải trang tiếp khi cuộn gần cuối
  useEffect(() => {
    const el = more.current
    if (!el || !posts.hasNextPage) return
    const io = new IntersectionObserver((e) => { if (e[0].isIntersecting && !posts.isFetchingNextPage) void posts.fetchNextPage() }, { rootMargin: '400px' })
    io.observe(el)
    return () => io.disconnect()
  }, [posts])

  if (!uid) return null
  const me = { id: uid, name: profile?.display_name ?? null, avatar: profile?.avatar_url ?? null }
  const loading = pinned.isLoading || posts.isLoading

  return (
    <div className="space-y-3">
      <WeekStrip clubId={clubId} meId={uid} />
      <Composer clubId={clubId} me={me} canAnnounce={isStaff} />

      {loading ? (
        <div className="space-y-3">{Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-40" />)}</div>
      ) : posts.isError || pinned.isError ? (
        <ErrorState message="Không tải được bảng tin." onRetry={() => { void posts.refetch(); void pinned.refetch() }} />
      ) : (
        <>
          {(pinned.data ?? []).map((p) => (
            <PostCard key={p.id} post={p} meId={uid} isStaff={isStaff} onComments={setCommentsFor} highlight={p.id === focus} />
          ))}
          {items.length === 0 && !pinned.data?.length ? (
            <EmptyState icon={Newspaper} title="Bảng tin còn trống"
              description="Khi thành viên chạy xong, bài chạy sẽ tự hiện ở đây. Bạn cũng có thể đăng bài rủ mọi người đi chạy." />
          ) : (
            items.map((p) => (
              <PostCard key={p.id} post={p} meId={uid} isStaff={isStaff} onComments={setCommentsFor} highlight={p.id === focus} />
            ))
          )}
          <div ref={more} />
          {posts.hasNextPage && (
            <Button variant="ghost" block onClick={() => posts.fetchNextPage()} loading={posts.isFetchingNextPage}>Xem bài cũ hơn</Button>
          )}
        </>
      )}

      <CommentsSheet post={commentsFor} meId={uid} isStaff={isStaff} onClose={() => setCommentsFor(null)} />
    </div>
  )
}

/** Dải "Tuần này": tổng km cả CLB + hạng của tôi → dẫn sang BXH */
function WeekStrip({ clubId, meId }: { clubId: string; meId: string }) {
  const lb = useClubLeaderboard(clubId, 'WEEK')
  if (lb.isLoading) return <Skeleton className="h-16" />
  if (!lb.data) return null
  const total = lb.data.reduce((s, r) => s + r.distance_m, 0)
  const me = lb.data.find((r) => r.user_id === meId)
  const active = lb.data.filter((r) => r.run_count > 0).length
  return (
    <Link href={routes.clubTab(clubId, 'leaderboard')}
      className="flex items-center gap-3 rounded-[var(--radius-card)] border border-border bg-surface px-4 py-3 transition-colors hover:border-fg-subtle">
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand/10 text-brand"><TrendingUp className="size-5" aria-hidden /></span>
      <span className="min-w-0 flex-1">
        <span className="block text-xs text-fg-subtle">Tuần này · {active} người chạy</span>
        <span className="block font-mono tabular text-lg font-bold leading-tight">{formatKm(total)} <span className="text-xs font-medium text-fg-muted">km cả CLB</span></span>
      </span>
      <span className="shrink-0 text-right">
        <span className="block text-xs text-fg-subtle">Hạng của bạn</span>
        <span className="block font-mono text-lg font-bold leading-tight text-brand">{me && me.run_count > 0 ? `#${me.rank}` : '—'}</span>
      </span>
      <ChevronRight className="size-5 text-fg-subtle" aria-hidden />
    </Link>
  )
}
