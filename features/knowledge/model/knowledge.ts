// Nhãn, biểu tượng chuyên mục, hành động cuối bài (CTA) → đường dẫn trong app
import {
  Apple, BookOpen, ClipboardList, Footprints, HeartPulse, Medal, Smartphone, Sparkles, Sprout, type LucideIcon,
} from 'lucide-react'
import { routes } from '@/shared/config/routes'
import type { ArticleStatus, Cta, CtaKind } from '../api/knowledgeApi'

export const CATEGORY_ICONS: Record<string, LucideIcon> = { Sprout, ClipboardList, Apple, HeartPulse, Footprints, Medal, Sparkles, Smartphone, BookOpen }
export const categoryIcon = (name: string | null | undefined) => CATEGORY_ICONS[name ?? ''] ?? BookOpen

/** Chuyên mục hiện nhanh trên Trang chủ (theo gợi ý: người mới, giáo án, dinh dưỡng, thiết bị) */
export const HOME_CHIPS = ['BEGINNER', 'TRAINING', 'NUTRITION', 'GEAR'] as const

export const STATUS_LABEL: Record<ArticleStatus, string> = {
  DRAFT: 'Nháp', REVIEW: 'Chờ duyệt', SCHEDULED: 'Hẹn giờ', PUBLISHED: 'Đã đăng', ARCHIVED: 'Lưu trữ',
}
export const STATUS_TONE: Record<ArticleStatus, string> = {
  DRAFT: 'bg-surface-2 text-fg-muted', REVIEW: 'bg-warning/15 text-warning', SCHEDULED: 'bg-xp/15 text-xp',
  PUBLISHED: 'bg-brand/15 text-brand', ARCHIVED: 'bg-surface-2 text-fg-subtle',
}
export const ROLE_LABEL = { ADMIN: 'Quản trị', EDITOR: 'Biên tập viên', WRITER: 'Cộng tác viết', EXPERT: 'Chuyên gia duyệt' } as const
export const AUTHOR_KIND = { TEAM: 'Đội ngũ RaceHub', EDITOR: 'Biên tập viên', COACH: 'Huấn luyện viên', EXPERT: 'Chuyên gia', COMMUNITY: 'Runner cộng đồng' } as const

/** Loại hành động: nhãn mặc định + có cần đích (id / mã) không */
export const CTA_KINDS: Record<CtaKind, { label: string; target?: string }> = {
  GOAL: { label: 'Đặt mục tiêu tuần' },
  CHALLENGES: { label: 'Khám phá thử thách' },
  CHALLENGE: { label: 'Mở thử thách', target: 'Mã thử thách' },
  RACES: { label: 'Giải chạy ảo' },
  RACE: { label: 'Mở giải chạy', target: 'Mã giải chạy' },
  MARKET: { label: 'Chợ Runner', target: 'COACH / SHOP / SERVICE (tuỳ chọn)' },
  PARTNER: { label: 'Xem hồ sơ HLV / cửa hàng', target: 'Mã hồ sơ đối tác' },
  CLUBS: { label: 'Tìm CLB' },
  CLUB: { label: 'Mở CLB', target: 'Mã CLB' },
  NEARBY: { label: 'Tìm bạn chạy quanh đây' },
  CHARACTER: { label: 'Mở tủ đồ nhân vật' },
  ONBOARDING: { label: 'Tiếp tục hướng dẫn RaceHub' },
  WALLET: { label: 'Mở ví Xu' },
  ARTICLE: { label: 'Đọc bài tiếp theo', target: 'Đường dẫn bài (slug)' },
  LINK: { label: 'Mở', target: 'Đường dẫn trong app, vd /races' },
}

export function ctaHref(c: Cta): string {
  const t = c.target ?? ''
  switch (c.kind) {
    case 'GOAL': return `${routes.home}?goal=1`
    case 'CHALLENGES': return routes.challenges
    case 'CHALLENGE': return t ? routes.challenge(t) : routes.challenges
    case 'RACES': return routes.races
    case 'RACE': return t ? routes.race(t) : routes.races
    case 'MARKET': return ['COACH', 'SHOP', 'SERVICE'].includes(t) ? `${routes.market}?kind=${t}` : routes.market
    case 'PARTNER': return t ? routes.partner(t) : routes.market
    case 'CLUBS': return routes.clubs
    case 'CLUB': return t ? routes.club(t) : routes.clubs
    case 'NEARBY': return routes.nearby
    case 'CHARACTER': return routes.character
    case 'ONBOARDING': return routes.welcome
    case 'WALLET': return routes.wallet
    case 'ARTICLE': return t ? routes.learnArticle(t) : routes.learn
    case 'LINK': return t.startsWith('/') && !t.startsWith('//') ? t : routes.learn
  }
}
export const ctaLabel = (c: Cta) => c.label || CTA_KINDS[c.kind]?.label || 'Mở'

/** Gợi ý hành động theo chuyên mục khi bài chưa đặt CTA */
export const DEFAULT_CTAS: Record<string, Cta[]> = {
  BEGINNER: [{ kind: 'GOAL', target: null, label: null }, { kind: 'CLUBS', target: null, label: 'Tìm CLB để chạy cùng' }],
  TRAINING: [{ kind: 'CHALLENGES', target: null, label: null }, { kind: 'MARKET', target: 'COACH', label: 'Tìm HLV' }],
  NUTRITION: [{ kind: 'MARKET', target: 'SERVICE', label: 'Chuyên gia dinh dưỡng' }],
  INJURY: [{ kind: 'MARKET', target: 'SERVICE', label: 'Tìm chuyên gia' }],
  GEAR: [{ kind: 'MARKET', target: 'SHOP', label: 'Cửa hàng đối tác' }],
  RACES: [{ kind: 'RACES', target: null, label: null }],
  STORIES: [{ kind: 'CLUBS', target: null, label: null }, { kind: 'NEARBY', target: null, label: null }],
  APP: [{ kind: 'CHALLENGES', target: null, label: null }],
}

/** "12/09/2026" (giờ VN) */
export const formatDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', year: 'numeric' }) : ''
