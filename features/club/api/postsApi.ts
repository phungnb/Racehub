// Bảng tin CLB: bài đăng, thông báo ghim, bài tự sinh, cổ vũ, bình luận.
import { supabase } from '@/shared/lib/supabase'
import { errorKind } from '@/shared/lib/errors'
import type { ThreadComment } from '@/shared/ui'
import type { MemberProfile } from './clubApi'

export type PostKind = 'POST' | 'ANNOUNCEMENT' | 'AUTO_RUN' | 'AUTO_JOIN' | 'RECAP' | 'CHALLENGE' | 'NEWS' | 'MILESTONE'
/** Tin CLB (migration 006300): chuyên mục + link kèm theo */
export type NewsCategory = 'NOTICE' | 'EVENT' | 'RACE' | 'RESULT' | 'TRAINING' | 'OTHER'
export interface NewsMeta { category: NewsCategory; link: string | null; edited_at?: string }

export interface RunMeta { distance_m: number; moving_s: number; avg_pace_s: number; elevation_gain_m?: number; source?: string; started_at?: string }
export interface RecapMeta {
  week: string; distance_m: number; run_count: number; active_members: number; new_members: number
  top: { user_id: string; name: string; distance_m: number }[]
  /** 009600: tổng kết tháng, top điểm CLB, buổi chạy nhóm, lượt điểm danh, cột mốc */
  period?: 'WEEK' | 'MONTH'; points_top?: { user_id: string; name: string; points: number }[]
  events?: number; checkins?: number; milestones?: number
}

export interface ChallengeMeta {
  challenge_id: string; format: string; objective?: string; target_value?: number; start_date?: string; end_date?: string
  reward_xu?: number; result?: boolean
}

export interface ClubPost {
  id: string
  club_id: string
  author_id: string | null
  kind: PostKind
  title: string | null
  body: string
  image_paths: string[]
  activity_id: string | null
  meta: Partial<RunMeta & RecapMeta & ChallengeMeta & NewsMeta>
  is_pinned: boolean
  reaction_count: number
  comment_count: number
  cheer_xu?: number
  /** Số lượt quà được tặng trên bài (migration 010500) */
  gift_count?: number
  created_at: string
  author: MemberProfile | null
  reacted: boolean
  /** Bảng tin cộng đồng (Trang chủ): bài thuộc CLB nào */
  club?: { id: string; name: string; avatar_url: string | null; accent_color: string | null }
}

/** Ai đã thích, ai đã tặng quà trên một bài (migration 010500) */
export interface EngagementPerson { user_id: string; display_name: string | null; avatar_url: string | null; level: number; at: string; me: boolean }
export interface EngagementGift extends EngagementPerson { id: string; emoji: string; name: string; tier: string; qty: number; message: string | null }
export interface PostEngagement {
  like_count: number
  gift_count: number
  gift_senders: number
  likes: EngagementPerson[]
  gifts: EngagementGift[]
  gift_summary: { emoji: string; name: string; qty: number }[]
}

export interface PostComment {
  id: string
  post_id: string
  author_id: string | null
  body: string
  created_at: string
  author: MemberProfile | null
}

export const POST_MEDIA_BUCKET = 'club-media'
export const MAX_POST_IMAGES = 4
const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const POST_SELECT = '*, author:profiles!club_posts_author_id_fkey ( id, display_name, level, avatar_url )'

type Row = Omit<ClubPost, 'author' | 'reacted'> & { author: MemberProfile | MemberProfile[] | null; mine?: { post_id: string }[] }
const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? v[0] ?? null : v)
// "Mình đã thích bài này chưa" lấy kèm trong cùng lượt tải bài (lọc theo user ở bảng nhúng), không cần lượt gọi thứ hai
const SELECT_WITH_MINE = `${POST_SELECT}, mine:club_post_reactions ( post_id )`

/** Đường lui: máy chủ không nhận truy vấn nhúng (PGRST1xx/2xx) → lấy bài như cũ rồi hỏi riêng lượt thích */
const isEmbedError = (e: { code?: string } | null) => !!e?.code && /^PGRST[12]\d\d$/.test(e.code)
async function postsFallback(build: (sel: string) => PromiseLike<{ data: unknown; error: unknown }>, userId: string): Promise<ClubPost[]> {
  const { data, error } = await build(POST_SELECT)
  if (error) throw error
  const rows = (data ?? []) as Row[]
  const ids = rows.map((r) => r.id)
  let mine = new Set<string>()
  if (ids.length) {
    const r = await supabase.from('club_post_reactions').select('post_id').eq('user_id', userId).in('post_id', ids)
    if (r.error) throw r.error
    mine = new Set((r.data ?? []).map((x) => x.post_id as string))
  }
  return toPosts(rows.map((r) => ({ ...r, mine: mine.has(r.id) ? [{ post_id: r.id }] : [] })))
}

const toPosts = (rows: Row[]): ClubPost[] =>
  rows.map(({ mine, ...r }) => ({ ...r, author: one(r.author), image_paths: r.image_paths ?? [], meta: r.meta ?? {}, reacted: (mine ?? []).length > 0 }))

export const postImageUrl = (path: string) => supabase.storage.from(POST_MEDIA_BUCKET).getPublicUrl(path).data.publicUrl

export async function listPinnedPosts(clubId: string, userId: string): Promise<ClubPost[]> {
  const build = (sel: string, withMine = sel !== POST_SELECT) => {
    const q = supabase.from('club_posts').select(sel).eq('club_id', clubId).eq('is_pinned', true)
    return (withMine ? q.eq('mine.user_id', userId) : q).order('created_at', { ascending: false }).limit(5)
  }
  const { data, error } = await build(SELECT_WITH_MINE)
  if (isEmbedError(error)) return postsFallback(build, userId)
  if (error) throw error
  return toPosts((data ?? []) as unknown as Row[])
}

/** Một trang bảng tin (không gồm bài ghim), mới nhất trước. `before` = created_at của bài cuối trang trước. */
export async function listPosts(clubId: string, userId: string, before?: string, limit = 15): Promise<ClubPost[]> {
  const build = (sel: string, withMine = sel !== POST_SELECT) => {
    let q = supabase.from('club_posts').select(sel).eq('club_id', clubId).eq('is_pinned', false)
    if (withMine) q = q.eq('mine.user_id', userId)
    if (before) q = q.lt('created_at', before)
    return q.order('created_at', { ascending: false }).limit(limit)
  }
  const { data, error } = await build(SELECT_WITH_MINE)
  if (isEmbedError(error)) return postsFallback(build, userId)
  if (error) throw error
  return toPosts((data ?? []) as unknown as Row[])
}

export async function uploadPostImage(clubId: string, userId: string, file: File): Promise<string> {
  if (!IMAGE_TYPES.includes(file.type)) throw new Error('IMAGE_TYPE')
  if (file.size > MAX_IMAGE_BYTES) throw new Error('IMAGE_SIZE')
  const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg'
  const path = `${clubId}/${userId}/${crypto.randomUUID()}.${ext}`
  const { error } = await supabase.storage.from(POST_MEDIA_BUCKET)
    .upload(path, file, { cacheControl: '31536000', upsert: false, contentType: file.type })
  if (error) throw error
  return path
}

export async function createPost(input: {
  clubId: string; body: string; title?: string | null; announcement?: boolean; imagePaths?: string[]
}) {
  const { data, error } = await supabase.rpc('create_club_post', {
    p_club_id: input.clubId, p_body: input.body, p_title: input.title ?? null,
    p_kind: input.announcement ? 'ANNOUNCEMENT' : 'POST', p_image_paths: input.imagePaths ?? [], p_pin: false,
  })
  if (error) throw error
  return data as Omit<ClubPost, 'author' | 'reacted'>
}

export async function deletePost(postId: string) {
  const { error } = await supabase.rpc('delete_club_post', { p_post_id: postId })
  if (error) throw error
}

export async function pinPost(postId: string, pinned: boolean) {
  const { error } = await supabase.rpc('pin_club_post', { p_post_id: postId, p_pinned: pinned })
  if (error) throw error
}

export async function getPostEngagement(postId: string): Promise<PostEngagement> {
  const { data, error } = await supabase.rpc('post_engagement', { p_post_id: postId })
  if (error) throw error
  return data as PostEngagement
}

/** Bảng tin cộng đồng: bài chạy, cột mốc, bài viết từ mọi CLB mình tham gia (một bài chạy nhiều CLB chỉ hiện một lần) */
export async function listCommunityFeed(before?: string, limit = 15): Promise<ClubPost[]> {
  const { data, error } = await supabase.rpc('community_feed', { p_before: before ?? null, p_limit: limit })
  if (error) throw error
  return ((data ?? []) as ClubPost[]).map((p) => ({ ...p, image_paths: p.image_paths ?? [], meta: p.meta ?? {} }))
}

export async function toggleReaction(postId: string): Promise<{ reacted: boolean; count: number }> {
  const { data, error } = await supabase.rpc('toggle_post_reaction', { p_post_id: postId })
  if (error) throw error
  return data as { reacted: boolean; count: number }
}

/** Bình luận của một bài, kèm lượt thích + trả lời (migration 010400); máy chủ chưa cập nhật thì đọc kiểu cũ */
export async function listComments(postId: string, meId: string, isStaff: boolean): Promise<ThreadComment[]> {
  const { data, error } = await supabase.rpc('club_post_comment_thread', { p_post_id: postId })
  if (!error) {
    return ((data ?? []) as { id: string; parent_id: string | null; author_id: string | null; author_name: string | null; author_avatar: string | null
      body: string; created_at: string; like_count: number; liked: boolean; can_delete: boolean; can_edit?: boolean; edited_at?: string | null }[]).map((c) => ({
      id: c.id, parentId: c.parent_id, authorName: c.author_name, authorAvatar: c.author_avatar, body: c.body, createdAt: c.created_at,
      likeCount: c.like_count ?? 0, liked: !!c.liked, canDelete: c.can_delete, mine: c.author_id === meId,
      canEdit: c.can_edit ?? false, editedAt: c.edited_at ?? null,
    }))
  }
  if (errorKind(error) !== 'NOT_DEPLOYED') throw error
  const old = await supabase.from('club_post_comments')
    .select('id, post_id, author_id, body, created_at, author:profiles!club_post_comments_author_id_fkey ( id, display_name, level, avatar_url )')
    .eq('post_id', postId).order('created_at', { ascending: true }).limit(200)
  if (old.error) throw old.error
  return ((old.data ?? []) as unknown as (Omit<PostComment, 'author'> & { author: MemberProfile | MemberProfile[] | null })[]).map((c) => {
    const a = one(c.author)
    return { id: c.id, parentId: null, authorName: a?.display_name ?? null, authorAvatar: a?.avatar_url ?? null, body: c.body, createdAt: c.created_at,
      likeCount: 0, liked: false, canDelete: c.author_id === meId || isStaff, mine: c.author_id === meId }
  })
}

export async function addComment(postId: string, body: string, parentId: string | null = null) {
  const { error } = parentId
    ? await supabase.rpc('add_post_comment', { p_post_id: postId, p_body: body, p_parent_id: parentId })
    : await supabase.rpc('add_post_comment', { p_post_id: postId, p_body: body })
  if (error) throw error
}

export async function toggleCommentLike(commentId: string) {
  const { data, error } = await supabase.rpc('toggle_post_comment_like', { p_comment_id: commentId })
  if (error) throw error
  return data as { liked: boolean; count: number }
}

/** Sửa bình luận của mình (migration 011500) */
export async function editComment(commentId: string, body: string) {
  const { error } = await supabase.rpc('edit_post_comment', { p_comment_id: commentId, p_body: body })
  if (error) throw error
}

export async function deleteComment(commentId: string) {
  const { error } = await supabase.rpc('delete_post_comment', { p_comment_id: commentId })
  if (error) throw error
}

/** Tin CLB + thông báo (bộ lọc "Tin CLB" trên bảng tin), mới nhất trước */
export async function listNews(clubId: string, userId: string, limit = 40): Promise<ClubPost[]> {
  const build = (sel: string, withMine = sel !== POST_SELECT) => {
    const q = supabase.from('club_posts').select(sel).eq('club_id', clubId).in('kind', ['NEWS', 'ANNOUNCEMENT'])
    return (withMine ? q.eq('mine.user_id', userId) : q).order('created_at', { ascending: false }).limit(limit)
  }
  const { data, error } = await build(SELECT_WITH_MINE)
  if (isEmbedError(error)) return postsFallback(build, userId)
  if (error) throw error
  return toPosts((data ?? []) as unknown as Row[])
}

export interface NewsInput { id?: string; title: string; body: string; category: NewsCategory; link: string | null; image_paths: string[]; pin: boolean; notify?: boolean }
/** Ban chủ nhiệm đăng / sửa Tin CLB */
export async function publishNews(clubId: string, input: NewsInput): Promise<string> {
  const { data, error } = await supabase.rpc('publish_club_news', { p_club_id: clubId, p: input })
  if (error) throw error
  return data as string
}
