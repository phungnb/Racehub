'use client'

import Link from 'next/link'
import { Gift, ThumbsUp } from 'lucide-react'
import { Avatar, EmptyState, ErrorState, LevelBadge, SegmentedControl, Sheet, Skeleton } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { formatNumber, formatRelative } from '@/shared/lib/format'
import { routes } from '@/shared/config/routes'
import { clubErrorMessage } from '../../api/clubApi'
import type { ClubPost, EngagementGift, EngagementPerson } from '../../api/postsApi'
import { usePostEngagement } from '../../hooks/useClubFeed'

export type EngagementTab = 'LIKES' | 'GIFTS'

/**
 * Dòng tóm tắt dưới bài (kiểu Facebook / Strava kudos): 👍 12 · 🎁 6 lượt quà ······ 3 bình luận.
 * Ai cũng thấy con số; bấm vào để xem ai đã thích, ai đã tặng quà gì.
 */
export function EngagementSummary({ post, onOpen, onComments }: {
  post: ClubPost; onOpen: (tab: EngagementTab) => void; onComments: () => void
}) {
  const likes = post.reaction_count
  const gifts = Number(post.gift_count ?? 0)
  if (!likes && !gifts && !post.comment_count) return null
  return (
    <div className="flex items-center gap-3 text-sm text-fg-muted">
      {likes > 0 && (
        <button type="button" onClick={() => onOpen('LIKES')} aria-label={`${likes} lượt thích — xem ai đã thích`}
          className="flex min-h-9 items-center gap-1.5 hover:text-fg hover:underline">
          <span className="grid size-5 place-items-center rounded-full bg-brand text-brand-fg"><ThumbsUp className="size-3 fill-current" aria-hidden /></span>
          <span className="font-mono tabular">{formatNumber(likes)}</span>
        </button>
      )}
      {gifts > 0 && (
        <button type="button" onClick={() => onOpen('GIFTS')} aria-label={`${gifts} lượt tặng quà — xem ai đã tặng`}
          className="flex min-h-9 items-center gap-1.5 hover:text-fg hover:underline">
          <span className="grid size-5 place-items-center rounded-full bg-coin text-bg"><Gift className="size-3" aria-hidden /></span>
          <span><span className="font-mono tabular">{formatNumber(gifts)}</span> lượt quà</span>
        </button>
      )}
      {post.comment_count > 0 && (
        <button type="button" onClick={onComments} className="ml-auto flex min-h-9 items-center hover:text-fg hover:underline">
          {formatNumber(post.comment_count)} bình luận
        </button>
      )}
    </div>
  )
}

/** Ai đã thích / ai đã tặng quà (lời nhắn kèm quà chỉ người tặng và người nhận thấy) */
export function EngagementSheet({ post, tab, onTab, onClose }: {
  post: ClubPost | null; tab: EngagementTab; onTab: (t: EngagementTab) => void; onClose: () => void
}) {
  const q = usePostEngagement(post?.id ?? null)
  const d = q.data
  const likeCount = d?.like_count ?? post?.reaction_count ?? 0
  const giftCount = d?.gift_count ?? Number(post?.gift_count ?? 0)
  return (
    <Sheet open={!!post} onClose={onClose} title="Lượt tương tác"
      description={post?.author?.display_name ? `Bài của ${post.author.display_name}` : undefined}>
      <div className="space-y-4">
        <SegmentedControl value={tab} onChange={onTab} options={[
          { value: 'LIKES', label: 'Thích', count: likeCount },
          { value: 'GIFTS', label: 'Quà tặng', count: giftCount },
        ]} />
        {q.isPending ? (
          <div className="space-y-2">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-12" />)}</div>
        ) : q.isError || !d ? (
          <ErrorState message={clubErrorMessage(q.error)} error={q.error} onRetry={() => void q.refetch()} />
        ) : tab === 'LIKES' ? (
          d.likes.length ? <ul className="divide-y divide-border">{d.likes.map((p) => <PersonRow key={p.user_id} p={p} />)}</ul>
            : <EmptyState icon={ThumbsUp} title="Chưa ai thích bài này" description="Bấm Thích để là người đầu tiên." />
        ) : d.gifts.length ? (
          <div className="space-y-3">
            <p className="text-sm text-fg-muted">
              <b className="text-fg">{formatNumber(d.gift_count)}</b> lượt quà từ <b className="text-fg">{formatNumber(d.gift_senders)}</b> người
            </p>
            <div className="flex flex-wrap gap-1.5">
              {d.gift_summary.map((g) => (
                <span key={g.name} className="inline-flex items-center gap-1 rounded-full border border-border bg-surface-2 px-2.5 py-1 text-xs font-semibold">
                  <span className="text-base leading-none" aria-hidden>{g.emoji}</span>{g.name}<span className="font-mono text-coin">×{formatNumber(g.qty)}</span>
                </span>
              ))}
            </div>
            <ul className="divide-y divide-border">{d.gifts.map((g) => <GiftRow key={g.id} g={g} />)}</ul>
          </div>
        ) : (
          <EmptyState icon={Gift} title="Chưa có ai tặng quà" description="Quà dùng Xu của người tặng; người nhận có thêm điểm Tỏa sáng." />
        )}
      </div>
    </Sheet>
  )
}

function Who({ p }: { p: EngagementPerson }) {
  return (
    <Link href={routes.athlete(p.user_id)} className="flex min-w-0 flex-1 items-center gap-3">
      <Avatar src={p.avatar_url} name={p.display_name} size="md" />
      <span className="min-w-0">
        <span className="flex items-center gap-1.5">
          <span className="truncate font-semibold">{p.me ? 'Bạn' : p.display_name ?? 'Thành viên'}</span>
          <LevelBadge level={p.level} />
        </span>
        <span className="block text-xs text-fg-subtle">{formatRelative(p.at)}</span>
      </span>
    </Link>
  )
}

function PersonRow({ p }: { p: EngagementPerson }) {
  return (
    <li className="flex items-center gap-3 py-2.5">
      <Who p={p} />
      <ThumbsUp className="size-4 shrink-0 fill-brand text-brand" aria-hidden />
    </li>
  )
}

function GiftRow({ g }: { g: EngagementGift }) {
  return (
    <li className="space-y-1 py-2.5">
      <div className="flex items-center gap-3">
        <Who p={g} />
        <span className={cn('flex shrink-0 items-center gap-1 rounded-full bg-coin/10 px-2 py-1 text-sm font-semibold')}>
          <span className="text-lg leading-none" aria-hidden>{g.emoji}</span>
          <span className="max-w-24 truncate text-xs text-fg-muted">{g.name}</span>
          {g.qty > 1 && <span className="font-mono text-coin">×{g.qty}</span>}
        </span>
      </div>
      {g.message && <p className="ml-13 rounded-xl bg-surface-2 px-3 py-1.5 text-sm italic text-fg-muted">“{g.message}”</p>}
    </li>
  )
}
