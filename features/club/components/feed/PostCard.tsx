'use client'

import Link from 'next/link'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/shared/lib/supabase'
import { routes } from '@/shared/config/routes'
import { Check, ChevronRight, Crown, ExternalLink, Megaphone, MessageCircle, MoreHorizontal, Newspaper, Pencil, Pin, PinOff, Shield, ThumbsUp, Trash2, Trophy, UserPlus } from 'lucide-react'
import { toast } from 'sonner'
import { Avatar, Card, ConfirmSheet, LevelBadge, Sheet } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { formatDuration, formatKm, formatNumber, formatPace, formatRelative } from '@/shared/lib/format'
import { GiftButton } from '@/features/game'
import { clubErrorMessage } from '../../api/clubApi'
import { postImageUrl, type ClubPost } from '../../api/postsApi'
import { usePostActions } from '../../hooks/useClubFeed'
import { NEWS_CATEGORIES } from '../../model/media'
import { NewsSheet } from './NewsSheet'
import { EngagementSheet, EngagementSummary, type EngagementTab } from './Engagement'

export function PostCard({ post, meId, isStaff, onComments, highlight }: {
  post: ClubPost; meId: string; isStaff: boolean; onComments: (p: ClubPost) => void; highlight?: boolean
}) {
  if (post.kind === 'AUTO_JOIN') return <JoinRow post={post} meId={meId} />
  if (post.kind === 'RECAP') return <RecapCard post={post} />
  if (post.kind === 'CHALLENGE') return <ChallengePost post={post} meId={meId} onComments={onComments} />

  const isRun = post.kind === 'AUTO_RUN'
  const isAnnouncement = post.kind === 'ANNOUNCEMENT'
  const isNews = post.kind === 'NEWS'
  const milestone = post.kind === 'MILESTONE' ? milestoneOf(post) : null
  const cat = isNews ? NEWS_CATEGORIES[post.meta.category ?? 'OTHER'] ?? NEWS_CATEGORIES.OTHER : null
  return (
    <Card id={`post-${post.id}`} className={cn('space-y-3 scroll-mt-40', (isAnnouncement || isNews) && post.is_pinned && 'border-coin/40 bg-coin/5',
      milestone && 'border-coin/40 bg-gradient-to-br from-coin/15 to-transparent',
      isNews && !post.is_pinned && 'border-brand/25',
      highlight && 'ring-2 ring-brand')}>
      <header className="flex items-center gap-3">
        {post.author_id ? (
          <Link href={routes.athlete(post.author_id)} aria-label={`Hồ sơ ${post.author?.display_name ?? 'thành viên'}`}>
            <Avatar src={post.author?.avatar_url} name={post.author?.display_name} size="md" />
          </Link>
        ) : <Avatar src={post.author?.avatar_url} name={post.author?.display_name} size="md" />}
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2">
            {post.author_id
              ? <Link href={routes.athlete(post.author_id)} className="truncate font-semibold hover:underline">{post.author?.display_name ?? 'Thành viên cũ'}</Link>
              : <span className="truncate font-semibold">{post.author?.display_name ?? 'Thành viên cũ'}</span>}
            {post.author && <LevelBadge level={post.author.level} />}
          </p>
          <p className="text-xs text-fg-subtle">
            {isRun ? 'đã hoàn thành một buổi chạy · ' : milestone ? 'chạm cột mốc mới · ' : ''}{formatRelative(post.created_at)}
          </p>
          {post.club && <ClubTag club={post.club} />}
        </div>
        {post.is_pinned && <Pin className="size-4 text-coin" aria-label="Đã ghim" />}
        <PostMenu post={post} meId={meId} isStaff={isStaff} />
      </header>

      {isAnnouncement && (
        <p className="flex items-center gap-2 text-sm font-semibold text-coin">
          <Megaphone className="size-4" aria-hidden />Thông báo
        </p>
      )}
      {cat && (
        <p className="flex items-center gap-2 text-xs font-semibold">
          <span className="inline-flex items-center gap-1 text-fg-muted"><Newspaper className="size-3.5" aria-hidden />Tin CLB</span>
          <span className={cn('rounded-full px-2 py-0.5', cat.tone)}>{cat.label}</span>
        </p>
      )}
      {milestone ? (
        <div className="flex items-center gap-3 rounded-xl bg-bg/60 p-3">
          <span className="text-4xl" aria-hidden>{milestone.emoji}</span>
          <div className="min-w-0">
            <p className="text-lg font-bold leading-snug">{post.title}</p>
            <p className="text-sm text-fg-muted">{milestone.detail}</p>
          </div>
        </div>
      ) : post.title && <h3 className="text-lg font-bold leading-snug">{post.title}</h3>}
      {isRun ? (post.activity_id
        ? <Link href={routes.activity(post.activity_id)} aria-label="Xem chi tiết bài chạy" className="block rounded-xl hover:opacity-90"><RunStats post={post} /></Link>
        : <RunStats post={post} />) : null}
      {post.body && !isRun && <p className="whitespace-pre-line break-words text-[15px] leading-relaxed">{post.body}</p>}
      {post.image_paths.length > 0 && <Images paths={post.image_paths} />}
      {isNews && post.meta.link && (
        <a href={post.meta.link} target="_blank" rel="noopener noreferrer nofollow"
          className="flex min-h-11 items-center gap-2 rounded-xl border border-border bg-surface-2 px-3 text-sm font-semibold hover:border-fg-subtle">
          <ExternalLink className="size-4 shrink-0 text-brand" aria-hidden /><span className="min-w-0 flex-1 truncate">{post.meta.link.replace(/^https?:\/\/(www\.)?/, '')}</span>
        </a>
      )}

      <PostActions post={post} onComments={onComments} />
    </Card>
  )
}

/** Bài cột mốc (migration 007800): 100 / 500 / 1.000 km…, Half / Full Marathon, Ultra đầu tiên */
function milestoneOf(post: ClubPost) {
  const m = post.meta as { code?: string; total_km?: number; distance_m?: number; moving_s?: number }
  const code = m.code ?? ''
  const single = code === 'FIRST_HM' || code === 'FIRST_FM' || code === 'FIRST_ULTRA'
  return {
    emoji: code === 'FIRST_FM' ? '🏅' : code === 'FIRST_HM' ? '🥈' : code === 'FIRST_ULTRA' ? '🦾' : '🎉',
    detail: single
      ? `${formatKm(Number(m.distance_m ?? 0))} km${m.moving_s ? ` trong ${formatDuration(Number(m.moving_s))}` : ''} — vào Đại sảnh CLB!`
      : `Tổng ${formatNumber(Number(m.total_km ?? 0))} km cùng RaceHub. Cổ vũ một câu nào!`,
  }
}

function RunStats({ post }: { post: ClubPost }) {
  const m = post.meta
  return (
    <div className="rounded-xl border border-border bg-bg/60 p-3">
      {post.body && <p className="mb-2 truncate text-sm font-medium text-fg-muted">{post.body}</p>}
      <div className="grid grid-cols-3 gap-2">
        <Stat label="Quãng đường" value={formatKm(m.distance_m)} unit="km" big />
        <Stat label="Pace" value={formatPace(m.avg_pace_s)} unit="/km" />
        <Stat label="Thời gian" value={formatDuration(m.moving_s)} />
      </div>
    </div>
  )
}

function Stat({ label, value, unit, big }: { label: string; value: string; unit?: string; big?: boolean }) {
  return (
    <div>
      <p className="text-xs text-fg-subtle">{label}</p>
      <p className={cn('font-mono tabular font-bold leading-tight', big ? 'text-2xl text-brand' : 'text-lg')}>
        {value}{unit && <span className="ml-0.5 text-xs font-medium text-fg-muted">{unit}</span>}
      </p>
    </div>
  )
}

function Images({ paths }: { paths: string[] }) {
  const [open, setOpen] = useState<string | null>(null)
  return (
    <>
      <div className={cn('grid gap-1.5 overflow-hidden rounded-xl', paths.length === 1 ? 'grid-cols-1' : 'grid-cols-2')}>
        {paths.map((p, i) => (
          <button key={p} onClick={() => setOpen(p)} aria-label={`Xem ảnh ${i + 1}`}
            className={cn('overflow-hidden bg-surface-2', paths.length === 1 ? 'max-h-96' : 'aspect-square', paths.length === 3 && i === 0 && 'row-span-2 aspect-auto')}>
            {/* eslint-disable-next-line @next/next/no-img-element -- ảnh từ Supabase Storage */}
            <img src={postImageUrl(p)} alt="" loading="lazy" className="size-full object-cover" />
          </button>
        ))}
      </div>
      <Sheet open={!!open} onClose={() => setOpen(null)} title="Ảnh">
        {/* eslint-disable-next-line @next/next/no-img-element -- ảnh từ Supabase Storage */}
        {open && <img src={postImageUrl(open)} alt="" className="w-full rounded-xl" />}
      </Sheet>
    </>
  )
}

/** Thanh tương tác: tóm tắt (👍 · 🎁 · bình luận) + Thích · Bình luận · Tặng quà */
function PostActions({ post, onComments }: { post: ClubPost; onComments: (p: ClubPost) => void }) {
  const { react } = usePostActions(post.club_id)
  const [sheet, setSheet] = useState<EngagementTab | null>(null)
  const giftable = !!post.author_id && (post.kind === 'AUTO_RUN' || post.kind === 'POST' || post.kind === 'MILESTONE')
  return (
    <div className="space-y-1">
      <EngagementSummary post={post} onOpen={setSheet} onComments={() => onComments(post)} />
      <footer className="-mx-2 flex items-center border-t border-border pt-1.5">
        <button onClick={() => react.mutate(post)} aria-pressed={post.reacted}
          className={cn('flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl px-2 text-sm font-semibold transition-colors hover:bg-surface-2',
            post.reacted ? 'text-brand' : 'text-fg-muted')}>
          <ThumbsUp className={cn('size-5', post.reacted && 'fill-current animate-pop')} aria-hidden />Thích
        </button>
        <button onClick={() => onComments(post)}
          className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl px-2 text-sm font-semibold text-fg-muted transition-colors hover:bg-surface-2">
          <MessageCircle className="size-5" aria-hidden />Bình luận
        </button>
        {giftable && (
          <GiftButton className="flex-1 justify-center" toUser={post.author_id!} toName={post.author?.display_name ?? 'Thành viên'}
            toAvatar={post.author?.avatar_url} postId={post.id} activityId={post.activity_id} />
        )}
      </footer>
      <EngagementSheet post={sheet ? post : null} tab={sheet ?? 'LIKES'} onTab={setSheet} onClose={() => setSheet(null)} />
    </div>
  )
}

/** Bài trên bảng tin cộng đồng: thuộc CLB nào (bấm để vào CLB) */
function ClubTag({ club }: { club: NonNullable<ClubPost['club']> }) {
  return (
    <Link href={routes.club(club.id)} className="mt-0.5 inline-flex max-w-full items-center gap-1 text-xs font-medium text-fg-muted hover:text-fg">
      <Shield className="size-3 shrink-0" style={{ color: club.accent_color ?? undefined }} aria-hidden /><span className="truncate">{club.name}</span>
    </Link>
  )
}

function PostMenu({ post, meId, isStaff }: { post: ClubPost; meId: string; isStaff: boolean }) {
  const { remove, pin } = usePostActions(post.club_id)
  const [open, setOpen] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [editing, setEditing] = useState(false)
  const canDelete = post.author_id === meId || isStaff
  if (!canDelete && !isStaff) return null
  return (
    <>
      <button onClick={() => setOpen(true)} aria-label="Tùy chọn bài đăng"
        className="-mr-2 grid size-11 place-items-center rounded-full text-fg-subtle hover:bg-surface-2 hover:text-fg">
        <MoreHorizontal className="size-5" aria-hidden />
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Bài đăng">
        <div className="space-y-1">
          {isStaff && post.kind === 'NEWS' && <MenuItem icon={Pencil} label="Sửa tin" onClick={() => { setOpen(false); setEditing(true) }} />}
          {isStaff && (
            <MenuItem icon={post.is_pinned ? PinOff : Pin} label={post.is_pinned ? 'Bỏ ghim' : 'Ghim lên đầu bảng tin'}
              onClick={() => pin.mutate({ id: post.id, pinned: !post.is_pinned }, {
                onSuccess: () => { toast.success(post.is_pinned ? 'Đã bỏ ghim' : 'Đã ghim'); setOpen(false) },
                onError: (e) => toast.error(clubErrorMessage(e)),
              })} />
          )}
          {canDelete && <MenuItem icon={Trash2} label="Xóa bài" danger onClick={() => { setOpen(false); setConfirm(true) }} />}
        </div>
      </Sheet>
      {editing && <NewsSheet clubId={post.club_id} meId={meId} post={post} onClose={() => setEditing(false)} />}
      <ConfirmSheet open={confirm} onClose={() => setConfirm(false)} title="Xóa bài đăng này?" confirmLabel="Xóa bài"
        description="Bài và bình luận sẽ bị ẩn khỏi bảng tin CLB." loading={remove.isPending}
        onConfirm={() => remove.mutate(post.id, {
          onSuccess: () => { toast.success('Đã xóa bài'); setConfirm(false) },
          onError: (e) => toast.error(clubErrorMessage(e)),
        })} />
    </>
  )
}

export function MenuItem({ icon: Icon, label, onClick, danger }: { icon: typeof Pin; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button onClick={onClick}
      className={cn('flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left text-[15px] font-medium hover:bg-surface-2', danger && 'text-danger')}>
      <Icon className="size-5" aria-hidden />{label}
    </button>
  )
}

function JoinRow({ post, meId }: { post: ClubPost; meId: string }) {
  const { react } = usePostActions(post.club_id)
  const self = post.author_id === meId
  return (
    <div id={`post-${post.id}`} className="flex items-center gap-3 rounded-[var(--radius-card)] border border-dashed border-border px-3 py-2.5">
      <span className="grid size-9 place-items-center rounded-full bg-brand/15 text-brand"><UserPlus className="size-4" aria-hidden /></span>
      <p className="min-w-0 flex-1 text-sm">
        <span className="font-semibold">{post.author?.display_name ?? 'Thành viên mới'}</span>
        <span className="text-fg-muted"> vừa gia nhập CLB · {formatRelative(post.created_at)}</span>
      </p>
      {!self && (
        <button onClick={() => react.mutate(post)} aria-pressed={post.reacted}
          className={cn('min-h-9 shrink-0 rounded-full border px-3 text-sm font-semibold transition-colors',
            post.reacted ? 'border-brand/40 bg-brand/15 text-brand' : 'border-border text-fg-muted hover:text-fg')}>
          {post.reacted ? 'Đã chào' : 'Chào mừng'}{post.reaction_count > 0 ? ` · ${post.reaction_count}` : ''}
        </button>
      )}
    </div>
  )
}

function RecapCard({ post }: { post: ClubPost }) {
  const m = post.meta
  const medals = ['text-medal-gold', 'text-medal-silver', 'text-medal-bronze']
  return (
    <Card id={`post-${post.id}`} className="space-y-4 border-xp/30 bg-gradient-to-br from-xp/10 to-transparent">
      <header className="flex items-center gap-2">
        <Trophy className="size-5 text-xp" aria-hidden />
        <h3 className="font-bold">{post.title ?? (m.period === 'MONTH' ? 'Tổng kết tháng' : 'Tổng kết tuần')}</h3>
        <span className="ml-auto text-xs text-fg-subtle">{formatRelative(post.created_at)}</span>
      </header>
      <div className="grid grid-cols-3 gap-2 text-center">
        <Stat label="Cả CLB chạy" value={formatKm(m.distance_m)} unit="km" big />
        <Stat label="Buổi chạy" value={formatNumber(m.run_count)} />
        <Stat label="Người chạy" value={formatNumber(m.active_members)} />
      </div>
      {!!m.top?.length && (
        <ol className="space-y-1.5">
          {m.top.map((t, i) => (
            <li key={t.user_id} className="flex items-center gap-3 rounded-xl bg-bg/60 px-3 py-2">
              <Crown className={cn('size-4', medals[i])} aria-hidden />
              <span className="flex-1 truncate text-sm font-medium">{t.name}</span>
              <span className="font-mono tabular text-sm font-bold">{formatKm(t.distance_m)} km</span>
            </li>
          ))}
        </ol>
      )}
      {!!m.points_top?.length && (
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-coin">Top điểm CLB</p>
          <p className="text-sm">{m.points_top.map((t, i) => `${i + 1}. ${t.name} · ${formatNumber(Math.round(Number(t.points)))} điểm`).join('   ')}</p>
        </div>
      )}
      {(!!m.events || !!m.milestones) && (
        <p className="text-sm text-fg-muted">
          {m.events ? `${m.events} buổi chạy nhóm · ${formatNumber(m.checkins ?? 0)} lượt điểm danh` : ''}{m.events && m.milestones ? ' · ' : ''}{m.milestones ? `${m.milestones} cột mốc mới` : ''}
        </p>
      )}
      {!!m.new_members && <p className="text-sm text-fg-muted">Chào mừng {m.new_members} thành viên mới trong {m.period === 'MONTH' ? 'tháng' : 'tuần'}.</p>}
    </Card>
  )
}

/** Mình đã tham gia thử thách này chưa (để nút đổi thành "Bạn đã tham gia") */
function useJoinedChallenge(challengeId: string | undefined, meId: string) {
  const q = useQuery({
    queryKey: ['challenge', challengeId, 'joined', meId],
    queryFn: async () => {
      const { data } = await supabase.from('challenge_participants').select('status')
        .eq('challenge_id', challengeId!).eq('profile_id', meId).maybeSingle()
      return !!data && data.status !== 'LEFT'
    },
    enabled: !!challengeId && !!meId, staleTime: 60_000,
  })
  return q.data === true
}

function ChallengePost({ post, meId, onComments }: { post: ClubPost; meId: string; onComments: (p: ClubPost) => void }) {
  const m = post.meta
  const result = !!m.result
  const joined = useJoinedChallenge(result ? undefined : m.challenge_id, meId)
  return (
    <Card id={`post-${post.id}`} className={cn('space-y-3', result ? 'border-coin/40 bg-gradient-to-br from-coin/10 to-transparent' : 'border-brand/30 bg-gradient-to-br from-brand/10 to-transparent')}>
      <header className="flex items-center gap-2">
        <Trophy className={cn('size-5', result ? 'text-coin' : 'text-brand')} aria-hidden />
        <p className="text-sm font-semibold">{result ? 'Kết quả thử thách' : 'Thử thách mới của CLB'}</p>
        <span className="ml-auto text-xs text-fg-subtle">{formatRelative(post.created_at)}</span>
      </header>
      <h3 className="text-lg font-bold leading-snug">{post.title}</h3>
      {post.body && <p className="whitespace-pre-line text-[15px] leading-relaxed text-fg-muted">{post.body}</p>}
      {!result && m.end_date && (
        <p className="text-sm text-fg-muted">
          {new Date(m.start_date ?? post.created_at).toLocaleDateString('vi-VN')} → {new Date(m.end_date).toLocaleDateString('vi-VN')}
          {Number(m.reward_xu) > 0 && <span className="ml-2 font-semibold text-coin">· Thưởng {formatNumber(m.reward_xu)} Xu</span>}
        </p>
      )}
      {m.challenge_id && (
        <Link href={`/challenges/${m.challenge_id}`}
          className={cn('flex min-h-11 items-center justify-center gap-1 rounded-xl text-sm font-semibold',
            result || joined ? 'bg-surface-2 text-fg hover:bg-border' : 'bg-brand text-brand-fg hover:bg-brand-strong')}>
          {result ? 'Xem bảng xếp hạng' : joined ? <><Check className="size-4 text-brand" aria-hidden />Bạn đã tham gia</> : 'Xem và tham gia'}<ChevronRight className="size-4" aria-hidden />
        </Link>
      )}
      <PostActions post={post} onComments={onComments} />
    </Card>
  )
}
