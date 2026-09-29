'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { Users } from 'lucide-react'
import { Button, EmptyState, ErrorState, SectionTitle, Skeleton } from '@/shared/ui'
import { routes } from '@/shared/config/routes'
import type { ClubPost } from '../../api/postsApi'
import { useCommunityFeed } from '../../hooks/useClubFeed'
import { CommentsSheet } from './CommentsSheet'
import { PostCard } from './PostCard'

/**
 * Bảng tin cộng đồng (Trang chủ): bài chạy, cột mốc, bài viết của bạn bè từ mọi CLB mình tham gia.
 * Thích · bình luận · tặng quà ngay tại đây; ai cũng thấy số lượt thích / quà và ai đã thích, ai đã tặng.
 */
export function CommunityFeed({ meId }: { meId: string }) {
  const q = useCommunityFeed()
  const [commentsFor, setCommentsFor] = useState<ClubPost | null>(null)
  const more = useRef<HTMLDivElement>(null)
  const items = q.data?.pages.flat() ?? []

  useEffect(() => {
    const el = more.current
    if (!el || !q.hasNextPage) return
    const io = new IntersectionObserver((e) => { if (e[0].isIntersecting && !q.isFetchingNextPage) void q.fetchNextPage() }, { rootMargin: '400px' })
    io.observe(el)
    return () => io.disconnect()
  }, [q])

  return (
    <section className="space-y-3">
      <SectionTitle>Bảng tin cộng đồng</SectionTitle>
      {q.isPending ? (
        <div className="space-y-3">{Array.from({ length: 2 }, (_, i) => <Skeleton key={i} className="h-40" />)}</div>
      ) : q.isError ? (
        <ErrorState message="Không tải được bảng tin." error={q.error} onRetry={() => void q.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState icon={Users} title="Chưa có gì mới"
          description="Tham gia CLB để thấy bài chạy, kỷ lục của bạn bè — thích, bình luận và tặng quà cổ vũ."
          action={<Link href={routes.clubs}><Button size="sm">Tìm CLB</Button></Link>} />
      ) : (
        <>
          {items.map((p) => <PostCard key={p.id} post={p} meId={meId} isStaff={false} onComments={setCommentsFor} />)}
          <div ref={more} />
          {q.isFetchingNextPage && <Skeleton className="h-40" />}
        </>
      )}
      <CommentsSheet post={commentsFor} meId={meId} isStaff={false} onClose={() => setCommentsFor(null)} />
    </section>
  )
}
