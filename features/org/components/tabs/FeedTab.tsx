'use client'

import Link from 'next/link'
import { useRef, useState } from 'react'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Flag, Gift, Heart, ImagePlus, Megaphone, MessageCircle, Pin, Send, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import { Avatar, Button, Card, EmptyState, ErrorState, Input, Skeleton, Textarea } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { formatRelative } from '@/shared/lib/format'
import { routes } from '@/shared/config/routes'
import { useSession } from '@/features/auth'
import {
  addOrgComment, createOrgPost, deleteOrgComment, deleteOrgPost, getOrgFeed, listOrgComments, orgErrorMessage, pinOrgPost, toggleOrgPostLike,
  uploadOrgImage, type OrgDetail, type OrgPost,
} from '../../api/orgApi'

const KIND = {
  ANNOUNCEMENT: { icon: Megaphone, label: 'Thông báo', cls: 'text-coin' },
  CAMPAIGN: { icon: Flag, label: 'Chiến dịch', cls: 'text-brand' },
  DRAW: { icon: Gift, label: 'Quay thưởng', cls: 'text-coin' },
  POST: null,
} as const

/** Bảng tin tổ chức: như bảng tin CLB — bài viết, ảnh, thích, bình luận, ghim thông báo */
export function FeedTab({ org }: { org: OrgDetail }) {
  const key = ['org', org.id, 'feed'] as const
  const q = useInfiniteQuery({
    queryKey: key,
    queryFn: ({ pageParam }) => getOrgFeed(org.id, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => (last.length >= 20 ? last[last.length - 1].created_at : undefined),
  })
  const canPost = org.member_posts || org.is_admin || org.is_unit_admin
  const posts = (q.data?.pages ?? []).flat().filter((p, i, a) => a.findIndex((x) => x.id === p.id) === i)
  return (
    <div className="space-y-3">
      {canPost && <Composer org={org} />}
      {q.isPending ? <div className="space-y-2"><Skeleton className="h-28" /><Skeleton className="h-28" /></div>
        : q.isError ? <ErrorState message={orgErrorMessage(q.error)} error={q.error} onRetry={() => void q.refetch()} />
        : !posts.length ? <EmptyState icon={Megaphone} title="Bảng tin còn trống" description="Chiến dịch mới, kết quả quay thưởng và bài của thành viên sẽ hiện ở đây." />
        : (
          <ul className="space-y-3">
            {posts.map((p) => <li key={p.id}><PostCard org={org} p={p} /></li>)}
          </ul>
        )}
      {q.hasNextPage && <Button block variant="ghost" loading={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()}>Xem thêm</Button>}
    </div>
  )
}

function Composer({ org }: { org: OrgDetail }) {
  const qc = useQueryClient()
  const { session } = useSession()
  const file = useRef<HTMLInputElement>(null)
  const [body, setBody] = useState('')
  const [image, setImage] = useState<string | null>(null)
  const [announce, setAnnounce] = useState(false)
  const manager = org.is_admin || org.is_unit_admin
  const upload = useMutation({
    mutationFn: (f: File) => uploadOrgImage(org.id, f, 'post', session?.user.id),
    onSuccess: setImage,
    onError: (e) => toast.error(orgErrorMessage(e)),
  })
  const post = useMutation({
    mutationFn: () => createOrgPost(org.id, body.trim(), image, announce),
    onSuccess: () => { setBody(''); setImage(null); setAnnounce(false); void qc.invalidateQueries({ queryKey: ['org', org.id, 'feed'] }) },
    onError: (e) => toast.error(orgErrorMessage(e)),
  })
  return (
    <Card className="space-y-2">
      <Textarea value={body} maxLength={2000} onChange={(e) => setBody(e.target.value)} rows={2}
        placeholder={manager ? 'Viết thông báo hoặc chia sẻ với mọi người…' : 'Chia sẻ buổi chạy, lời cổ vũ…'} aria-label="Nội dung bài viết" />
      {image && (
        <div className="relative">
          {/* eslint-disable-next-line @next/next/no-img-element -- ảnh xem trước */}
          <img src={image} alt="" className="max-h-60 w-full rounded-xl object-cover" />
          <button type="button" onClick={() => setImage(null)} aria-label="Bỏ ảnh" className="absolute right-2 top-2 grid size-8 place-items-center rounded-full bg-black/60 text-white"><X className="size-4" aria-hidden /></button>
        </div>
      )}
      <div className="flex items-center gap-2">
        <input ref={file} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) upload.mutate(f) }} />
        <Button size="sm" variant="ghost" loading={upload.isPending} onClick={() => file.current?.click()} aria-label="Thêm ảnh"><ImagePlus className="size-4" aria-hidden /></Button>
        {manager && (
          <label className="flex items-center gap-1.5 text-xs text-fg-muted">
            <input type="checkbox" checked={announce} onChange={(e) => setAnnounce(e.target.checked)} className="accent-brand" />Thông báo (ghim)
          </label>
        )}
        <Button size="sm" className="ml-auto" loading={post.isPending} disabled={!body.trim() || upload.isPending} onClick={() => post.mutate()}>
          <Send className="size-4" aria-hidden />Đăng
        </Button>
      </div>
    </Card>
  )
}

function PostCard({ org, p }: { org: OrgDetail; p: OrgPost }) {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [liked, setLiked] = useState({ on: p.liked, n: p.likes })
  const refresh = () => void qc.invalidateQueries({ queryKey: ['org', org.id, 'feed'] })
  const like = useMutation({
    mutationFn: () => toggleOrgPostLike(p.id),
    onMutate: () => setLiked((x) => ({ on: !x.on, n: x.n + (x.on ? -1 : 1) })),
    onError: (e) => { setLiked({ on: p.liked, n: p.likes }); toast.error(orgErrorMessage(e)) },
  })
  const del = useMutation({ mutationFn: () => deleteOrgPost(p.id), onSuccess: refresh, onError: (e) => toast.error(orgErrorMessage(e)) })
  const pin = useMutation({ mutationFn: () => pinOrgPost(p.id, !p.is_pinned), onSuccess: refresh, onError: (e) => toast.error(orgErrorMessage(e)) })
  const kind = KIND[p.kind]
  return (
    <Card className={cn('space-y-2', p.is_pinned && 'border-coin/40')}>
      <div className="flex items-center gap-2.5">
        <Avatar src={p.author_avatar} name={p.author_name ?? 'RaceHub'} size="sm" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{p.author_name ?? 'RaceHub'}</p>
          <p className="flex items-center gap-1 text-xs text-fg-subtle">
            {p.is_pinned && <Pin className="size-3 text-coin" aria-label="Đã ghim" />}
            {kind && <span className={cn('flex items-center gap-1 font-semibold', kind.cls)}><kind.icon className="size-3" aria-hidden />{kind.label} ·</span>}
            {formatRelative(p.created_at)}
          </p>
        </div>
        {org.is_admin && <Button size="sm" variant="ghost" aria-label={p.is_pinned ? 'Bỏ ghim' : 'Ghim'} onClick={() => pin.mutate()}><Pin className={cn('size-4', p.is_pinned && 'text-coin')} aria-hidden /></Button>}
        {p.can_delete && <Button size="sm" variant="ghost" aria-label="Xoá bài" onClick={() => del.mutate()}><Trash2 className="size-4" aria-hidden /></Button>}
      </div>
      <p className="whitespace-pre-line text-[15px]">{p.body}</p>
      {p.meta?.campaign_id && <Link href={routes.orgCampaign(org.id, p.meta.campaign_id)} className="inline-block text-sm font-semibold text-brand">Xem chiến dịch →</Link>}
      {p.image_url && (
        // eslint-disable-next-line @next/next/no-img-element -- ảnh bài đăng từ Supabase Storage
        <img src={p.image_url} alt="" className="max-h-96 w-full rounded-xl object-cover" loading="lazy" />
      )}
      <div className="flex gap-1 border-t border-border pt-1.5">
        <Button size="sm" variant="ghost" onClick={() => like.mutate()} aria-pressed={liked.on}>
          <Heart className={cn('size-4', liked.on && 'fill-danger text-danger')} aria-hidden />{liked.n || ''}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen((x) => !x)} aria-expanded={open}><MessageCircle className="size-4" aria-hidden />{p.comments || ''}</Button>
      </div>
      {open && <Comments postId={p.id} onChange={refresh} />}
    </Card>
  )
}

function Comments({ postId, onChange }: { postId: string; onChange: () => void }) {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['org-comments', postId], queryFn: () => listOrgComments(postId) })
  const [text, setText] = useState('')
  const after = () => { void qc.invalidateQueries({ queryKey: ['org-comments', postId] }); onChange() }
  const add = useMutation({ mutationFn: () => addOrgComment(postId, text.trim()), onSuccess: () => { setText(''); after() }, onError: (e) => toast.error(orgErrorMessage(e)) })
  const del = useMutation({ mutationFn: (id: string) => deleteOrgComment(id), onSuccess: after, onError: (e) => toast.error(orgErrorMessage(e)) })
  return (
    <div className="space-y-2">
      {(q.data ?? []).map((c) => (
        <div key={c.id} className="flex gap-2">
          <Avatar src={c.author_avatar} name={c.author_name ?? '?'} size="xs" />
          <div className="min-w-0 flex-1 rounded-xl bg-surface-2 px-3 py-1.5 text-sm">
            <p className="text-xs font-semibold">{c.author_name}</p>
            <p className="whitespace-pre-line">{c.body}</p>
          </div>
          {c.can_delete && <button type="button" onClick={() => del.mutate(c.id)} aria-label="Xoá bình luận" className="text-fg-subtle"><Trash2 className="size-3.5" aria-hidden /></button>}
        </div>
      ))}
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (text.trim()) add.mutate() }}>
        <Input value={text} maxLength={1000} onChange={(e) => setText(e.target.value)} placeholder="Viết bình luận…" aria-label="Bình luận" />
        <Button type="submit" size="sm" className="h-11 shrink-0" loading={add.isPending} disabled={!text.trim()} aria-label="Gửi"><Send className="size-4" aria-hidden /></Button>
      </form>
    </div>
  )
}
