'use client'

import Link from 'next/link'
import { createElement } from 'react'
import { Bookmark, CheckCircle2, Clock, Newspaper } from 'lucide-react'
import { cn } from '@/shared/lib/cn'
import { routes } from '@/shared/config/routes'
import type { ArticleCard as Card } from '../api/knowledgeApi'
import { categoryIcon, formatDate } from '../model/knowledge'

/** Dòng bài viết gọn: ảnh nhỏ, tiêu đề, chuyên mục · thời gian đọc, trạng thái đã đọc / đã lưu */
export function ArticleRow({ a, className }: { a: Card; className?: string }) {
  return (
    <Link href={routes.learnArticle(a.slug)} className={cn('flex gap-3 rounded-2xl p-2 -mx-2 hover:bg-surface-2/60', className)}>
      <Thumb a={a} className="size-20 shrink-0" />
      <div className="min-w-0 flex-1 py-0.5">
        <p className="line-clamp-2 font-semibold leading-snug">{a.title}</p>
        <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-xs text-fg-muted">
          {a.content_type === 'NEWS' ? <span className="inline-flex items-center gap-1 text-xp"><Newspaper className="size-3" aria-hidden />Tin tức</span> : <span>{a.category_name}</span>}
          <span aria-hidden>·</span>
          {a.content_type === 'NEWS' ? <span>{formatDate(a.published_at)}</span> : <span className="inline-flex items-center gap-1"><Clock className="size-3" aria-hidden />{a.reading_time_minutes} phút đọc</span>}
        </p>
        <div className="mt-1 flex items-center gap-2 text-[11px]">
          {a.completed && <span className="inline-flex items-center gap-1 font-semibold text-brand"><CheckCircle2 className="size-3" aria-hidden />Đã đọc</span>}
          {!a.completed && a.progress >= 5 && (
            <span className="flex items-center gap-1.5 text-fg-subtle">
              <span className="h-1 w-12 overflow-hidden rounded-full bg-surface-2"><span className="block h-full bg-brand" style={{ width: `${a.progress}%` }} /></span>
              {a.progress}%
            </span>
          )}
          {a.saved && <span className="inline-flex items-center gap-1 text-coin"><Bookmark className="size-3 fill-current" aria-hidden />Đã lưu</span>}
        </div>
      </div>
    </Link>
  )
}

/** Thẻ lớn (bài nổi bật): ảnh bìa + tiêu đề */
export function FeatureCard({ a }: { a: Card }) {
  return (
    <Link href={routes.learnArticle(a.slug)} className="block w-64 shrink-0 overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface hover:border-fg-subtle">
      <Thumb a={a} className="h-32 w-full rounded-none" />
      <div className="space-y-1 p-3">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-brand">{a.category_name}</p>
        <p className="line-clamp-2 font-semibold leading-snug">{a.title}</p>
        <p className="text-xs text-fg-muted">{a.author_name ?? 'RaceHub'} · {a.reading_time_minutes} phút đọc</p>
      </div>
    </Link>
  )
}

const TONES = ['from-brand/35 to-xp/20', 'from-xp/35 to-coin/15', 'from-coin/30 to-live/15', 'from-live/25 to-brand/20']
function Thumb({ a, className }: { a: Card; className?: string }) {
  if (a.cover_image_url) {
    // eslint-disable-next-line @next/next/no-img-element -- ảnh bìa từ kho nội dung
    return <img src={a.cover_image_url} alt="" loading="lazy" className={cn('rounded-xl object-cover', className)} />
  }
  const tone = TONES[a.title.length % TONES.length]
  return (
    <span aria-hidden className={cn('grid place-items-center rounded-xl bg-gradient-to-br text-2xl font-black text-fg/70', tone, className)}>
      {a.title.replace(/[^\p{L}\p{N}]/gu, '').slice(0, 1).toUpperCase()}
    </span>
  )
}

/** Biểu tượng chuyên mục theo tên lưu trong DB */
export function CategoryIcon({ name, className }: { name: string | null | undefined; className?: string }) {
  return createElement(categoryIcon(name), { className, 'aria-hidden': true })
}
