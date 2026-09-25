'use client'

import Link from 'next/link'
import { ChevronRight, GraduationCap, Newspaper } from 'lucide-react'
import { Card, Skeleton } from '@/shared/ui'
import { routes } from '@/shared/config/routes'
import { useKnowledgeHome } from '../hooks/useKnowledge'
import { categoryIcon, HOME_CHIPS } from '../model/knowledge'
import { ArticleRow } from './ArticleCard'

/** Khu "Kiến thức Runner" trên Trang chủ: lối vào chuyên mục, đọc tiếp, chuỗi người mới, bài nổi bật, tin mới */
export function KnowledgeHomeSection() {
  const q = useKnowledgeHome()
  if (q.isPending) return <Skeleton className="h-72" />
  if (q.isError || !q.data) return null
  const d = q.data
  if (d.featured.length + d.news.length === 0) return null
  const chips = HOME_CHIPS.map((id) => d.categories.find((c) => c.id === id)).filter((c) => !!c)
  const series = d.series.find((s) => s.done < s.total)
  const reading = d.continue[0]
  const featured = d.featured.filter((a) => a.id !== reading?.id).slice(0, 4)

  return (
    <Card className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">RaceHub Knowledge</h2>
          <p className="text-sm text-fg-muted">Kiến thức để chạy tốt hơn mỗi ngày.</p>
        </div>
        <Link href={routes.learn} className="inline-flex min-h-11 shrink-0 items-center gap-0.5 text-sm font-semibold text-brand">Tất cả<ChevronRight className="size-4" aria-hidden /></Link>
      </div>

      <nav aria-label="Chuyên mục" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
        {chips.map((c) => {
          const Icon = categoryIcon(c.icon)
          return (
            <Link key={c.id} href={`${routes.learn}?c=${c.id}`}
              className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-border bg-surface-2 px-3 text-xs font-semibold hover:border-fg-subtle">
              <Icon className="size-3.5 text-brand" aria-hidden />{c.id === 'BEGINNER' ? 'Dành cho người mới' : c.name.split(' & ')[0]}
            </Link>
          )
        })}
      </nav>

      {series && (
        <Link href={series.next_slug ? routes.learnArticle(series.next_slug) : routes.learn}
          className="flex items-center gap-3 rounded-2xl border border-brand/30 bg-brand/8 p-3 hover:border-brand/60">
          <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-brand/20 text-brand"><GraduationCap className="size-5" aria-hidden /></span>
          <span className="min-w-0 flex-1">
            <span className="block font-semibold">{series.title}</span>
            <span className="block text-xs text-fg-muted">{series.done}/{series.total} bài · đọc hết nhận huy hiệu “Runner ham học”</span>
            <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-surface-2">
              <span className="block h-full rounded-full bg-brand" style={{ width: `${(100 * series.done) / Math.max(1, series.total)}%` }} />
            </span>
          </span>
          <ChevronRight className="size-4 shrink-0 text-fg-subtle" aria-hidden />
        </Link>
      )}

      {reading && (
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-fg-subtle">Đọc tiếp</p>
          <ArticleRow a={reading} />
        </div>
      )}

      {featured.length > 0 && (
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-fg-subtle">Bài viết nổi bật</p>
          <div className="space-y-1">{featured.map((a) => <ArticleRow key={a.id} a={a} />)}</div>
        </div>
      )}

      {d.news.length > 0 && (
        <div>
          <p className="mb-1 flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-fg-subtle"><Newspaper className="size-3.5" aria-hidden />Tin mới</p>
          <div className="space-y-1">{d.news.slice(0, 2).map((a) => <ArticleRow key={a.id} a={a} />)}</div>
        </div>
      )}
    </Card>
  )
}
