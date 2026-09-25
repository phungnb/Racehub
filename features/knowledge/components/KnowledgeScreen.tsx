'use client'

import Link from 'next/link'
import { useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { BookOpen, Bookmark, PenSquare, Search, X } from 'lucide-react'
import { Button, EmptyState, ErrorState, Input, SegmentedControl, Skeleton } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { routes } from '@/shared/config/routes'
import { knowledgeErrorMessage, type ContentType } from '../api/knowledgeApi'
import { useArticleList, useContentRole, useKnowledgeHome } from '../hooks/useKnowledge'
import { categoryIcon } from '../model/knowledge'
import { ArticleRow, FeatureCard } from './ArticleCard'

type Tab = 'ARTICLE' | 'NEWS' | 'SAVED'

/** Trung tâm kiến thức: Kiến thức / Tin tức / Đã lưu, lọc chuyên mục, tìm không dấu. Bộ lọc giữ trên URL (?c=&t=&q=). */
export function KnowledgeScreen() {
  const router = useRouter()
  const path = usePathname()
  const sp = useSearchParams()
  const tab = (sp.get('t') as Tab) || 'ARTICLE'
  const cat = sp.get('c')
  const [q, setQ] = useState(sp.get('q') ?? '')
  const home = useKnowledgeHome()
  const role = useContentRole()

  const go = (next: Partial<{ t: Tab; c: string | null; q: string }>) => {
    const u = new URLSearchParams(sp.toString())
    for (const [k, v] of Object.entries(next)) { if (v) u.set(k, v); else u.delete(k) }
    if (next.t === 'ARTICLE') u.delete('t')
    router.replace(`${path}${u.size ? `?${u}` : ''}`, { scroll: false })
  }
  const query = sp.get('q') ?? ''
  const browsing = !cat && !query && tab === 'ARTICLE'

  return (
    <div className="space-y-4">
      <header className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold">Kiến thức Runner</h1>
          <p className="text-sm text-fg-muted">Học để chạy tốt hơn · tin tức chạy bộ</p>
        </div>
        {role.data && (
          <Link href={routes.learnStudio} className="inline-flex h-11 items-center gap-1.5 rounded-xl border border-border px-3 text-sm font-semibold hover:border-fg-subtle">
            <PenSquare className="size-4" aria-hidden />Soạn bài
          </Link>
        )}
      </header>

      <form role="search" onSubmit={(e) => { e.preventDefault(); go({ q: q.trim() }) }} className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-subtle" aria-hidden />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm bài: giày, 10K, gel, chấn thương…" aria-label="Tìm bài viết" className="pl-9 pr-10" />
        {q && <button type="button" aria-label="Xoá tìm" onClick={() => { setQ(''); go({ q: '' }) }} className="absolute right-1 top-1/2 grid size-9 -translate-y-1/2 place-items-center text-fg-muted"><X className="size-4" aria-hidden /></button>}
      </form>

      <SegmentedControl value={tab} onChange={(t) => go({ t, c: t === 'ARTICLE' ? cat : null })} options={[
        { value: 'ARTICLE', label: 'Kiến thức' }, { value: 'NEWS', label: 'Tin tức' },
        { value: 'SAVED', label: 'Đã lưu', count: home.data?.saved_count || undefined },
      ]} />

      {tab === 'ARTICLE' && home.data && (
        <nav aria-label="Chuyên mục" className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
          <button type="button" aria-pressed={!cat} onClick={() => go({ c: null })}
            className={cn('h-9 shrink-0 rounded-full border px-3 text-xs font-semibold', !cat ? 'border-brand bg-brand/15 text-fg' : 'border-border text-fg-muted')}>Tất cả</button>
          {home.data.categories.map((c) => {
            const Icon = categoryIcon(c.icon)
            return (
              <button key={c.id} type="button" aria-pressed={cat === c.id} onClick={() => go({ c: c.id })}
                className={cn('inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold',
                  cat === c.id ? 'border-brand bg-brand/15 text-fg' : 'border-border text-fg-muted')}>
                <Icon className="size-3.5" aria-hidden />{c.name}{c.count > 0 && <span className="text-fg-subtle">{c.count}</span>}
              </button>
            )
          })}
        </nav>
      )}

      {browsing && home.data && home.data.featured.length > 0 && (
        <section>
          <h2 className="mb-2 font-semibold">Bài viết nổi bật</h2>
          <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
            {home.data.featured.map((a) => <FeatureCard key={a.id} a={a} />)}
          </div>
        </section>
      )}

      {cat && home.data && <p className="text-sm text-fg-muted">{home.data.categories.find((c) => c.id === cat)?.description}</p>}
      <Results filters={{ category: tab === 'ARTICLE' ? cat : null, type: tab === 'SAVED' ? null : (tab as ContentType), q: query || undefined, saved: tab === 'SAVED' }}
        heading={browsing ? 'Mới nhất' : undefined} saved={tab === 'SAVED'} />
    </div>
  )
}

function Results({ filters, heading, saved }: { filters: Parameters<typeof useArticleList>[0]; heading?: string; saved: boolean }) {
  const q = useArticleList(filters)
  const items = q.data?.pages.flatMap((p) => p.items) ?? []
  if (q.isPending) return <div className="space-y-2"><Skeleton className="h-24" /><Skeleton className="h-24" /><Skeleton className="h-24" /></div>
  if (q.isError) return <ErrorState message={knowledgeErrorMessage(q.error)} error={q.error} onRetry={() => void q.refetch()} />
  if (items.length === 0) {
    return saved
      ? <EmptyState icon={Bookmark} title="Chưa lưu bài nào" description="Bấm biểu tượng lưu ở bài viết để đọc lại sau." />
      : <EmptyState icon={BookOpen} title={filters.q ? 'Không tìm thấy bài phù hợp' : 'Chưa có bài trong mục này'} description={filters.q ? 'Thử từ khoá khác, không cần gõ dấu.' : 'Ban biên tập đang chuẩn bị — quay lại sau nhé.'} />
  }
  return (
    <section>
      {heading && <h2 className="mb-1 font-semibold">{heading}</h2>}
      <div className="space-y-1">{items.map((a) => <ArticleRow key={a.id} a={a} />)}</div>
      {q.hasNextPage && <Button block variant="secondary" className="mt-3" loading={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()}>Xem thêm</Button>}
    </section>
  )
}
