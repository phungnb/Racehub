// RaceHub Knowledge (migration 006200, docs/KNOWLEDGE.md): đọc bài, tiến độ, lưu, phản hồi + CMS cho ban nội dung. Mọi thao tác qua RPC.
import { supabase } from '@/shared/lib/supabase'
import { must, systemErrorMessage } from '@/shared/lib/errors'

export type ContentType = 'ARTICLE' | 'NEWS'
export type ArticleStatus = 'DRAFT' | 'REVIEW' | 'SCHEDULED' | 'PUBLISHED' | 'ARCHIVED'
export type ContentRole = 'ADMIN' | 'EDITOR' | 'WRITER' | 'EXPERT'
export type CtaKind = 'GOAL' | 'CHALLENGES' | 'CHALLENGE' | 'RACES' | 'RACE' | 'MARKET' | 'PARTNER' | 'CLUBS' | 'CLUB' | 'NEARBY'
  | 'CHARACTER' | 'ONBOARDING' | 'WALLET' | 'ARTICLE' | 'LINK'
export interface Cta { kind: CtaKind; target: string | null; label: string | null }

export interface Category { id: string; name: string; description: string | null; icon: string; count: number }
export interface ArticleCard {
  id: string; slug: string; title: string; summary: string | null; cover_image_url: string | null
  category_id: string; category_name: string; content_type: ContentType; reading_time_minutes: number; published_at: string | null
  author_name: string | null; is_featured: boolean; source_name: string | null; saved: boolean; progress: number; completed: boolean
}
export interface SeriesProgress { id: string; title: string; description: string | null; badge_code: string | null; total: number; done: number; next_slug: string | null }
export interface KnowledgeHome { categories: Category[]; featured: ArticleCard[]; news: ArticleCard[]; continue: ArticleCard[]; series: SeriesProgress[]; saved_count: number }
export interface Article extends ArticleCard {
  body: string; preview: boolean; status: ArticleStatus; updated_at: string; source_url: string | null; ctas: Cta[]
  needs_expert_review: boolean; expert_reviewed_at: string | null; expert_name: string | null
  category: { id: string; name: string; icon: string; market_kind: 'COACH' | 'SHOP' | 'SERVICE' | null }
  author: { id: string; name: string; title: string | null; bio: string | null; avatar_url: string | null; kind: string; verified: boolean; partner_id: string | null } | null
  tags: { slug: string; name: string }[]
  sources: { title: string; url: string | null; publisher: string | null }[]
  my_feedback: { helpful: boolean; comment: string | null } | null
  series: { id: string; title: string; items: { slug: string; title: string; completed: boolean }[] } | null
  related: ArticleCard[]
}
export interface ListFilters { category?: string | null; type?: ContentType | null; tag?: string | null; q?: string; saved?: boolean }

async function call<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw error
  return data as T
}

export const knowledgeHome = () => call<KnowledgeHome>('knowledge_home').then(must<KnowledgeHome>('NOT_DEPLOYED'))
export const knowledgeList = (f: ListFilters, offset = 0) => call<{ items: ArticleCard[]; total: number } | null>('knowledge_list', { p: { ...f, offset } }).then((x) => x ?? { items: [], total: 0 })
export const knowledgeArticle = (slug: string) => call<Article>('knowledge_article', { p_slug: slug }).then(must<Article>('ARTICLE_NOT_FOUND'))
export const knowledgeProgress = (id: string, progress: number, seconds: number) =>
  call<{ progress: number; completed: boolean; just_completed: boolean; badge: string | null }>('knowledge_progress', { p_id: id, p_progress: progress, p_seconds: seconds })
export const knowledgeBookmark = (id: string, on: boolean) => call<boolean>('knowledge_bookmark', { p_id: id, p_on: on })
export const knowledgeFeedback = (id: string, helpful: boolean, comment: string | null) =>
  call<void>('knowledge_feedback', { p_id: id, p_helpful: helpful, p_comment: comment })
export const knowledgeTrack = (id: string, kind: 'SHARE' | 'CTA') => call<void>('knowledge_track', { p_id: id, p_kind: kind })
export const myContentRole = () => call<ContentRole | null>('my_content_role')

// ---------------- CMS ----------------
export interface CmsAuthor { id: string; name: string; title: string | null; bio: string | null; avatar_url: string | null; kind: string; user_id: string | null; user_name: string | null; partner_id: string | null; verified: boolean }
export interface CmsMeta {
  role: ContentRole
  categories: { id: string; name: string; icon: string; needs_expert: boolean; market_kind: string | null }[]
  authors: CmsAuthor[]
  series: { id: string; title: string; badge_code: string | null }[]
  tags: { slug: string; name: string }[]
  staff: { user_id: string; name: string; role: 'EDITOR' | 'WRITER' | 'EXPERT'; at: string }[]
  counts: Partial<Record<ArticleStatus, number>> | null
}
export interface CmsRow {
  id: string; slug: string; title: string; status: ArticleStatus; content_type: ContentType; category_id: string
  published_at: string | null; updated_at: string; is_featured: boolean; cover_image_url: string | null; author_name: string | null
  created_by_name: string | null; mine: boolean; needs_expert_review: boolean; expert_reviewed_at: string | null; review_note: string | null; live: boolean
  views: number; reads: number; saves: number; cta_clicks: number; helpful_yes: number; helpful_no: number
}
export interface CmsArticle {
  id: string; slug: string; title: string; summary: string | null; body: string; cover_image_url: string | null; category_id: string
  author_id: string | null; content_type: ContentType; status: ArticleStatus; published_at: string | null; source_url: string | null
  source_name: string | null; is_featured: boolean; series_id: string | null; series_order: number | null; ctas: Cta[]
  needs_expert_review: boolean; expert_reviewed_at: string | null; expert_name: string | null; expert_note: string | null; review_note: string | null
  created_by: string | null; created_by_name: string | null; reading_time_minutes: number
  tags: string[]; sources: { title: string; url: string | null; publisher: string | null }[]
  feedback: { helpful: boolean; comment: string; at: string }[]
  views: number; reads: number; saves: number; shares: number; cta_clicks: number; helpful_yes: number; helpful_no: number
}
export type CmsInput = Partial<Omit<CmsArticle, 'feedback' | 'expert_name' | 'created_by_name'>> & { title: string; body: string; category_id: string }
export interface CmsStats {
  totals: { views: number; reads: number; shares: number; cta_clicks: number }
  saves: number; readers: number; avg_read_seconds: number; published: number
  days: { day: string; views: number; reads: number }[]
  top: { id: string; slug: string; title: string; category_id: string; views: number; reads: number; shares: number; cta_clicks: number; read_rate: number; cta_rate: number }[]
}

export const cmsMeta = () => call<CmsMeta>('cms_meta')
export const cmsList = (p: { status?: string; category?: string; type?: string; q?: string; mine?: boolean }, offset = 0) =>
  call<{ items: CmsRow[]; total: number }>('cms_list', { p: { ...p, offset } })
export const cmsGet = (id: string) => call<CmsArticle>('cms_get', { p_id: id })
export const cmsSave = (p: CmsInput) => call<string>('cms_save', { p })
export const cmsSetStatus = (id: string, status: ArticleStatus, at: string | null = null, note: string | null = null) =>
  call<{ status: ArticleStatus }>('cms_set_status', { p_id: id, p_status: status, p_at: at, p_note: note })
export const cmsExpertReview = (id: string, approve: boolean, note: string | null) => call<void>('cms_expert_review', { p_id: id, p_approve: approve, p_note: note })
export const cmsDelete = (id: string) => call<void>('cms_delete', { p_id: id })
export const cmsSaveAuthor = (p: Partial<CmsAuthor> & { name: string }) => call<string>('cms_save_author', { p })
export const cmsSetStaff = (user: string, role: string | null) => call<void>('cms_set_staff', { p_user: user, p_role: role })
export const cmsStats = (days: number) => call<CmsStats>('cms_stats', { p_days: days })

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp']
/** Ảnh bìa / ảnh trong bài → content-media/<uid>/<thời gian>.<đuôi>, trả URL công khai */
export async function uploadContentImage(file: File): Promise<string> {
  if (!IMAGE_TYPES.includes(file.type)) throw new Error('IMAGE_TYPE')
  if (file.size > 5 * 1024 * 1024) throw new Error('IMAGE_SIZE')
  const { data: u } = await supabase.auth.getUser()
  if (!u.user) throw new Error('FORBIDDEN')
  const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg'
  const path = `${u.user.id}/${Date.now()}.${ext}`
  const { error } = await supabase.storage.from('content-media').upload(path, file, { cacheControl: '31536000', upsert: false, contentType: file.type })
  if (error) throw error
  return supabase.storage.from('content-media').getPublicUrl(path).data.publicUrl
}

const MESSAGES: Record<string, string> = {
  ARTICLE_NOT_FOUND: 'Không tìm thấy bài viết (có thể đã gỡ hoặc chưa đăng).',
  EXPERT_REVIEW_REQUIRED: 'Bài thuộc chủ đề sức khoẻ / giáo án — cần chuyên gia duyệt chuyên môn trước khi đăng.',
  TITLE_TOO_SHORT: 'Tiêu đề cần ít nhất 5 ký tự.',
  INVALID_SLUG: 'Đường dẫn bài không hợp lệ.',
  SLUG_TAKEN: 'Đường dẫn này đã có bài khác dùng — đổi tiêu đề hoặc đường dẫn.',
  INVALID_CATEGORY: 'Chọn chuyên mục.',
  INVALID_URL: 'Link ảnh / nguồn phải bắt đầu bằng https://',
  BODY_TOO_SHORT: 'Nội dung quá ngắn để đăng.',
  INVALID_SCHEDULE: 'Giờ hẹn đăng phải ở tương lai.',
  CANNOT_REVIEW_OWN: 'Không tự duyệt chuyên môn bài của mình.',
  NOTE_REQUIRED: 'Ghi rõ góp ý để người viết sửa.',
  ARCHIVE_INSTEAD: 'Bài đã từng đăng — hãy Lưu trữ thay vì xoá (giữ link và thống kê).',
  IMAGE_TYPE: 'Chỉ nhận ảnh JPG, PNG, WEBP.',
  IMAGE_SIZE: 'Ảnh tối đa 5 MB.',
  FORBIDDEN: 'Bạn không có quyền làm việc này.',
}

export function knowledgeErrorMessage(e: unknown): string {
  const msg = (e as { message?: string } | null)?.message ?? ''
  const key = Object.keys(MESSAGES).find((k) => msg.includes(k))
  return key ? MESSAGES[key] : systemErrorMessage(e, 'Không thực hiện được. Hãy thử lại.')
}
