'use client'

import Link from 'next/link'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Footprints, UserPlus } from 'lucide-react'
import { toast } from 'sonner'
import { Avatar, Button, Card, EmptyState, ErrorState, SegmentedControl, Skeleton } from '@/shared/ui'
import { routes } from '@/shared/config/routes'
import { formatDuration, formatKm, formatPace, formatRelative, paceFrom } from '@/shared/lib/format'
import { followingFeed, followRunner, followSuggestions, socialErrorMessage, type FeedActivity } from '../api/socialApi'
import { socialKeys } from '../hooks/keys'

const PAGE = 20

/**
 * Trang chủ: hai bảng tin — "Cộng đồng" (CLB, như cũ) và "Đang theo dõi" (hoạt động của runner mình theo dõi + của mình).
 * Nhớ lựa chọn trên máy.
 */
export function HomeFeeds({ community }: { community: ReactNode }) {
  const [tab, setTab] = useState<'COMMUNITY' | 'FOLLOWING'>(() => {
    try { return localStorage.getItem('rh.homeFeed') === 'FOLLOWING' ? 'FOLLOWING' : 'COMMUNITY' } catch { return 'COMMUNITY' }
  })
  const pick = (v: 'COMMUNITY' | 'FOLLOWING') => {
    setTab(v)
    try { localStorage.setItem('rh.homeFeed', v) } catch { /* chế độ riêng tư */ }
  }
  return (
    <div className="space-y-3">
      <SegmentedControl value={tab} onChange={pick} options={[{ value: 'COMMUNITY', label: 'Cộng đồng' }, { value: 'FOLLOWING', label: 'Đang theo dõi' }]} />
      {tab === 'COMMUNITY' ? community : <FollowingFeed />}
    </div>
  )
}

export function FollowingFeed() {
  const q = useInfiniteQuery({
    queryKey: socialKeys.feed,
    queryFn: ({ pageParam }) => followingFeed(pageParam, PAGE),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => (last.length === PAGE ? last[last.length - 1].started_at : undefined),
  })
  const more = useRef<HTMLDivElement>(null)
  const items = q.data?.pages.flat() ?? []
  const others = items.some((a) => !a.is_me)

  useEffect(() => {
    const el = more.current
    if (!el || !q.hasNextPage) return
    const io = new IntersectionObserver((e) => { if (e[0].isIntersecting && !q.isFetchingNextPage) void q.fetchNextPage() }, { rootMargin: '400px' })
    io.observe(el)
    return () => io.disconnect()
  }, [q])

  return (
    <section className="space-y-3" aria-label="Hoạt động của người bạn theo dõi">
      {!others && !q.isPending && <Suggestions />}
      {q.isPending ? (
        <div className="space-y-3">{Array.from({ length: 2 }, (_, i) => <Skeleton key={i} className="h-28" />)}</div>
      ) : q.isError ? (
        <ErrorState message="Không tải được hoạt động." error={q.error} onRetry={() => void q.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState icon={Footprints} title="Chưa có hoạt động"
          description="Theo dõi các runner khác (bấm vào tên / ảnh ở bảng xếp hạng, CLB…) để thấy bài chạy của họ ở đây." />
      ) : (
        <>
          {items.map((a) => <ActivityCard key={a.id} a={a} />)}
          <div ref={more} />
          {q.isFetchingNextPage && <Skeleton className="h-28" />}
        </>
      )}
      {others && <Suggestions compact />}
    </section>
  )
}

function ActivityCard({ a }: { a: FeedActivity }) {
  const pace = a.avg_pace_s || paceFrom(a.distance_m, a.moving_time_s)
  return (
    <Card className="space-y-3 p-4">
      <Link href={routes.athlete(a.user.id)} className="flex items-center gap-2.5">
        <Avatar src={a.user.avatar_url} name={a.user.display_name} size="md" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-bold">{a.is_me ? 'Bạn' : a.user.display_name ?? 'Runner'}</span>
          <span className="block text-xs text-fg-subtle">{formatRelative(a.started_at)}{a.source === 'STRAVA' ? ' · Strava' : ''}</span>
        </span>
      </Link>
      <Link href={routes.activity(a.id)} className="block space-y-2">
        <p className="font-semibold">{a.title || 'Chạy bộ'}</p>
        <dl className="grid grid-cols-3 gap-2">
          {[['Quãng đường', `${formatKm(a.distance_m)} km`], ['Pace', `${formatPace(pace)}/km`], ['Thời gian', formatDuration(a.moving_time_s)]].map(([k, v]) => (
            <div key={k}>
              <dt className="text-xs text-fg-subtle">{k}</dt>
              <dd className="font-mono text-lg font-bold leading-tight">{v}</dd>
            </div>
          ))}
        </dl>
      </Link>
    </Card>
  )
}

/** Gợi ý người để theo dõi: người đang theo dõi mình, bạn kết nối, cùng CLB */
function Suggestions({ compact = false }: { compact?: boolean }) {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: socialKeys.suggestions, queryFn: followSuggestions, staleTime: 5 * 60_000 })
  const follow = useMutation({
    mutationFn: followRunner,
    onSuccess: () => { void qc.invalidateQueries({ queryKey: socialKeys.suggestions }); void qc.invalidateQueries({ queryKey: socialKeys.feed }) },
    onError: (e) => toast.error(socialErrorMessage(e)),
  })
  const list = (q.data ?? []).slice(0, compact ? 6 : 12)
  if (!list.length) return null
  return (
    <Card className="space-y-2 p-3">
      <p className="px-1 text-sm font-bold">Gợi ý theo dõi</p>
      <ul className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none]">
        {list.map((p) => (
          <li key={p.id} className="flex w-32 shrink-0 flex-col items-center gap-1.5 rounded-2xl border border-border p-3 text-center">
            <Link href={routes.athlete(p.id)} className="flex flex-col items-center gap-1">
              <Avatar src={p.avatar_url} name={p.display_name} size="lg" />
              <span className="line-clamp-1 text-sm font-semibold">{p.display_name ?? 'Runner'}</span>
            </Link>
            <span className="line-clamp-1 text-[11px] text-fg-subtle">{p.reason}</span>
            <Button size="sm" block onClick={() => follow.mutate(p.id)} loading={follow.isPending && follow.variables === p.id}>
              <UserPlus className="size-4" aria-hidden />Theo dõi
            </Button>
          </li>
        ))}
      </ul>
    </Card>
  )
}
