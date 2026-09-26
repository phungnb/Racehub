// Bảng tin CLB: bài đăng, thông báo ghim, bài tự sinh, cổ vũ, bình luận.
import { supabase } from '@/shared/lib/supabase'
import type { MemberProfile } from './clubApi'

export type PostKind = 'POST' | 'ANNOUNCEMENT' | 'AUTO_RUN' | 'AUTO_JOIN' | 'RECAP' | 'CHALLENGE' | 'NEWS' | 'MILESTONE'
/** Tin CLB (migration 006300): chuyên mục + link kèm theo */
export type NewsCategory = 'NOTICE' | 'EVENT' | 'RACE' | 'RESULT' | 'TRAINING' | 'OTHER'
export interface NewsMeta { category: NewsCategory; link: string | null; edited_at?: string }

export interface RunMeta { distance_m: number; moving_s: number; avg_pace_s: number; elevation_gain_m?: number; source?: string; started_at?: string }
export interface RecapMeta {
  week: string; distance_m: number; run_count: number; active_members: number; new_members: number
  top: { user_id: string; name: string; distance_m: number }[]
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
  created_at: string
  author: MemberProfile | null
  reacted: boolean
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

type Row = Omit<ClubPost, 'author' | 'reacted'> & { author: MemberProfile | MemberProfile[] | null }
const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? v[0] ?? null : v)

async function withMyReactions(rows: Row[], userId: string): Promise<ClubPost[]> {
  const ids = rows.map((r) => r.id)
  let mine = new Set<string>()
  if (ids.length) {
    const { data, error } = await supabase.from('club_post_reactions').select('post_id').eq('user_id', userId).in('post_id', ids)
    if (error) throw error
    mine = new Set((data ?? []).map((r) => r.post_id as string))
  }
  return rows.map((r) => ({ ...r, author: one(r.author), image_paths: r.image_paths ?? [], meta: r.meta ?? {}, reacted: mine.has(r.id) }))
}

export const postImageUrl = (path: string) => supabase.storage.from(POST_MEDIA_BUCKET).getPublicUrl(path).data.publicUrl

export async function listPinnedPosts(clubId: string, userId: string): Promise<ClubPost[]> {
  const { data, error } = await supabase.from('club_posts').select(POST_SELECT)
    .eq('club_id', clubId).eq('is_pinned', true).order('created_at', { ascending: false }).limit(5)
  if (error) throw error
  return withMyReactions((data ?? []) as unknown as Row[], userId)
}

/** Một trang bảng tin (không gồm bài ghim), mới nhất trước. `before` = created_at của bài cuối trang trước. */
export async function listPosts(clubId: string, userId: string, before?: string, limit = 15): Promise<ClubPost[]> {
  let q = supabase.from('club_posts').select(POST_SELECT)
    .eq('club_id', clubId).eq('is_pinned', false).order('created_at', { ascending: false }).limit(limit)
  if (before) q = q.lt('created_at', before)
  const { data, error } = await q
  if (error) throw error
  return withMyReactions((data ?? []) as unknown as Row[], userId)
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

export async function toggleReaction(postId: string): Promise<{ reacted: boolean; count: number }> {
  const { data, error } = await supabase.rpc('toggle_post_reaction', { p_post_id: postId })
  if (error) throw error
  return data as { reacted: boolean; count: number }
}

export async function listComments(postId: string): Promise<PostComment[]> {
  const { data, error } = await supabase.from('club_post_comments')
    .select('id, post_id, author_id, body, created_at, author:profiles!club_post_comments_author_id_fkey ( id, display_name, level, avatar_url )')
    .eq('post_id', postId).order('created_at', { ascending: true }).limit(200)
  if (error) throw error
  return ((data ?? []) as unknown as (Omit<PostComment, 'author'> & { author: MemberProfile | MemberProfile[] | null })[])
    .map((c) => ({ ...c, author: one(c.author) }))
}

export async function addComment(postId: string, body: string) {
  const { error } = await supabase.rpc('add_post_comment', { p_post_id: postId, p_body: body })
  if (error) throw error
}

export async function deleteComment(commentId: string) {
  const { error } = await supabase.rpc('delete_post_comment', { p_comment_id: commentId })
  if (error) throw error
}

/** Tin CLB + thông báo (bộ lọc "Tin CLB" trên bảng tin), mới nhất trước */
export async function listNews(clubId: string, userId: string, limit = 40): Promise<ClubPost[]> {
  const { data, error } = await supabase.from('club_posts').select(POST_SELECT)
    .eq('club_id', clubId).in('kind', ['NEWS', 'ANNOUNCEMENT']).order('created_at', { ascending: false }).limit(limit)
  if (error) throw error
  return withMyReactions((data ?? []) as unknown as Row[], userId)
}

export interface NewsInput { id?: string; title: string; body: string; category: NewsCategory; link: string | null; image_paths: string[]; pin: boolean; notify?: boolean }
/** Ban chủ nhiệm đăng / sửa Tin CLB */
export async function publishNews(clubId: string, input: NewsInput): Promise<string> {
  const { data, error } = await supabase.rpc('publish_club_news', { p_club_id: clubId, p: input })
  if (error) throw error
  return data as string
}
