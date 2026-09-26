'use client'

import Link from 'next/link'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft, ArrowRight, Award, BadgeCheck, Bookmark, CheckCircle2, ChevronDown, Clock, ExternalLink, ListTree, Share2, ShieldCheck,
  ThumbsDown, ThumbsUp,
} from 'lucide-react'
import { toast } from 'sonner'
import { Avatar, Button, Card, ErrorState, Skeleton, Textarea } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { routes } from '@/shared/config/routes'
import { knowledgeErrorMessage, knowledgeFeedback, knowledgeProgress, knowledgeTrack, type Article } from '../api/knowledgeApi'
import { knowledgeKeys, useArticle, useBookmark } from '../hooks/useKnowledge'
import { AUTHOR_KIND, ctaHref, ctaLabel, DEFAULT_CTAS, formatDate } from '../model/knowledge'
import { parseMarkdown, tocOf } from '../model/markdown'
import { ArticleRow, CategoryIcon } from './ArticleCard'
import { Markdown } from './Markdown'

export function ArticleScreen({ slug }: { slug: string }) {
  const q = useArticle(slug)
  return (
    <div className="space-y-4">
      <Link href={routes.learn} className="-ml-1 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-fg-muted hover:text-fg">
        <ArrowLeft className="size-4" aria-hidden />Kiến thức Runner
      </Link>
      {q.isPending ? <div className="space-y-3"><Skeleton className="h-10" /><Skeleton className="h-48" /><Skeleton className="h-96" /></div>
        : q.isError ? <ErrorState message={knowledgeErrorMessage(q.error)} error={q.error} onRetry={() => void q.refetch()} />
        : <Reader key={q.data.id} a={q.data} />}
    </div>
  )
}

/** Theo dõi tiến độ đọc: % cuộn qua thân bài + số giây thật sự đọc (tab đang mở). Gửi định kỳ, khi đọc xong và khi rời trang. */
function useReadingProgress(a: Article, body: React.RefObject<HTMLElement | null>) {
  const qc = useQueryClient()
  const [pct, setPct] = useState(a.completed ? 100 : a.progress)
  const state = useRef({ max: a.progress, sent: a.progress, secs: 0, done: a.completed })

  useEffect(() => {
    if (a.preview) return
    const s = state.current
    const flush = (final = false) => {
      if (s.done && !final) return
      if (s.max <= s.sent && s.secs < 5 && !final) return
      const secs = s.secs
      s.secs = 0
      s.sent = s.max
      void knowledgeProgress(a.id, s.max, secs).then((r) => {
        if (r.just_completed) {
          s.done = true
          if (r.badge) toast.success('Huy hiệu mới: Runner ham học 🎓', { description: 'Bạn đã đọc hết chuỗi Bắt đầu chạy bộ.' })
          else toast.success('Đã đọc xong bài', { description: 'Tiến độ đã được lưu.' })
          void qc.invalidateQueries({ queryKey: knowledgeKeys.home })
        }
      }).catch(() => { /* bỏ qua: gửi lại lần sau */ })
    }
    const onScroll = () => {
      const el = body.current
      if (!el) return
      const r = el.getBoundingClientRect()
      const seen = Math.min(1, Math.max(0, (window.innerHeight - r.top) / Math.max(1, r.height)))
      const p = Math.round(seen * 100)
      setPct(p)
      if (p > s.max) { s.max = p; if (p >= 90 && !s.done) flush() }
    }
    const tick = window.setInterval(() => { if (document.visibilityState === 'visible') s.secs += 1 }, 1000)
    const periodic = window.setInterval(() => flush(), 15_000)
    const onHide = () => { if (document.visibilityState === 'hidden') flush(true) }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    document.addEventListener('visibilitychange', onHide)
    return () => {
      window.clearInterval(tick); window.clearInterval(periodic)
      window.removeEventListener('scroll', onScroll)
      document.removeEventListener('visibilitychange', onHide)
      flush(true)
    }
  }, [a.id, a.preview, body, qc])
  return pct
}

function Reader({ a }: { a: Article }) {
  const blocks = useMemo(() => parseMarkdown(a.body), [a.body])
  const toc = tocOf(blocks)
  const body = useRef<HTMLDivElement>(null)
  const pct = useReadingProgress(a, body)
  const bookmark = useBookmark()
  const [saved, setSaved] = useState(a.saved)
  const [tocOpen, setTocOpen] = useState(false)
  const ctas = a.ctas.length ? a.ctas : DEFAULT_CTAS[a.category.id] ?? []
  const nextInSeries = a.series ? a.series.items[a.series.items.findIndex((x) => x.slug === a.slug) + 1] : undefined

  const share = async () => {
    const url = `${window.location.origin}${routes.learnArticle(a.slug)}`
    try {
      if (navigator.share) await navigator.share({ title: a.title, text: a.summary ?? a.title, url })
      else { await navigator.clipboard.writeText(url); toast.success('Đã sao chép link bài viết') }
      void knowledgeTrack(a.id, 'SHARE')
    } catch { /* người dùng huỷ */ }
  }
  const toggleSave = () => {
    const on = !saved
    setSaved(on)
    bookmark.mutate({ id: a.id, on }, { onError: (e) => { setSaved(!on); toast.error(knowledgeErrorMessage(e)) } })
  }

  return (
    <article className="space-y-5">
      <div className="fixed inset-x-0 top-0 z-40 h-0.5 bg-transparent" aria-hidden><div className="h-full bg-brand transition-[width]" style={{ width: `${pct}%` }} /></div>
      {a.preview && <p className="rounded-xl bg-warning/15 p-3 text-sm text-warning">Xem trước — bài chưa đăng ({a.status}). Người đọc chưa thấy bài này.</p>}

      <header className="space-y-3">
        <Link href={`${routes.learn}?c=${a.category.id}`} className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-brand">
          <CategoryIcon name={a.category.icon} className="size-3.5" />{a.content_type === 'NEWS' ? 'Tin tức · ' : ''}{a.category.name}
        </Link>
        <h1 className="text-2xl font-bold leading-tight">{a.title}</h1>
        {a.summary && <p className="text-[15px] text-fg-muted">{a.summary}</p>}
        <div className="flex items-center gap-2.5">
          <Avatar src={a.author?.avatar_url} name={a.author?.name ?? 'RaceHub'} size="sm" />
          <div className="min-w-0 flex-1 text-xs text-fg-muted">
            <p className="flex items-center gap-1 font-semibold text-fg">{a.author?.name ?? 'RaceHub'}{a.author?.verified && <BadgeCheck className="size-3.5 text-brand" aria-label="Đã xác minh" />}</p>
            <p className="flex flex-wrap gap-x-1.5">
              <span>{formatDate(a.published_at)}</span><span aria-hidden>·</span>
              <span className="inline-flex items-center gap-1"><Clock className="size-3" aria-hidden />{a.reading_time_minutes} phút đọc</span>
              {a.updated_at && a.published_at && new Date(a.updated_at).getTime() - new Date(a.published_at).getTime() > 86_400_000 && <><span aria-hidden>·</span><span>Cập nhật {formatDate(a.updated_at)}</span></>}
            </p>
          </div>
          <Button size="sm" variant="ghost" aria-pressed={saved} aria-label={saved ? 'Bỏ lưu' : 'Lưu bài'} onClick={toggleSave}>
            <Bookmark className={cn('size-5', saved && 'fill-coin text-coin')} aria-hidden />
          </Button>
          <Button size="sm" variant="ghost" aria-label="Chia sẻ" onClick={share}><Share2 className="size-5" aria-hidden /></Button>
        </div>
      </header>

      {a.cover_image_url && (
        // eslint-disable-next-line @next/next/no-img-element -- ảnh bìa từ kho nội dung
        <img src={a.cover_image_url} alt="" className="aspect-[16/9] w-full rounded-2xl border border-border object-cover" />
      )}

      {a.needs_expert_review && a.expert_reviewed_at && (
        <p className="flex gap-2 rounded-xl border border-brand/30 bg-brand/5 p-3 text-xs text-fg-muted">
          <ShieldCheck className="size-4 shrink-0 text-brand" aria-hidden />
          <span>Nội dung đã được {a.expert_name ? <b className="text-fg">{a.expert_name}</b> : 'chuyên gia'} duyệt chuyên môn. Thông tin mang tính tham khảo chung, không thay cho chẩn đoán hay tư vấn cá nhân của nhân viên y tế.</span>
        </p>
      )}

      {toc.length >= 3 && (
        <nav aria-label="Mục lục" className="rounded-2xl border border-border bg-surface">
          <button type="button" onClick={() => setTocOpen((v) => !v)} aria-expanded={tocOpen} className="flex min-h-11 w-full items-center gap-2 px-4 text-sm font-semibold">
            <ListTree className="size-4 text-brand" aria-hidden />Mục lục<ChevronDown className={cn('ml-auto size-4 transition-transform', tocOpen && 'rotate-180')} aria-hidden />
          </button>
          {tocOpen && (
            <ol className="space-y-1 px-4 pb-3 text-sm">
              {toc.map((t) => <li key={t.id} className={cn(t.level === 3 && 'pl-4')}><a href={`#${t.id}`} className="block py-1 text-fg-muted hover:text-fg">{t.text}</a></li>)}
            </ol>
          )}
        </nav>
      )}

      <div ref={body}><Markdown blocks={blocks} /></div>

      {a.content_type === 'NEWS' && a.source_url && (
        <a href={a.source_url} target="_blank" rel="noopener noreferrer nofollow" className="flex items-center gap-2 rounded-xl border border-border p-3 text-sm hover:border-fg-subtle">
          <ExternalLink className="size-4 text-fg-muted" aria-hidden /><span className="min-w-0 flex-1">Đọc bài gốc{a.source_name ? ` trên ${a.source_name}` : ''}</span>
        </a>
      )}

      {a.sources.length > 0 && (
        <section className="space-y-1.5">
          <h2 className="text-sm font-semibold">Nguồn tham khảo</h2>
          <ol className="list-decimal space-y-1 pl-5 text-xs text-fg-muted">
            {a.sources.map((s, i) => (
              <li key={i}>{s.url ? <a href={s.url} target="_blank" rel="noopener noreferrer nofollow" className="underline underline-offset-2 hover:text-fg">{s.title}</a> : s.title}{s.publisher ? ` — ${s.publisher}` : ''}</li>
            ))}
          </ol>
        </section>
      )}

      {a.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {a.tags.map((t) => <Link key={t.slug} href={`${routes.learn}?q=${encodeURIComponent(t.name)}`} className="rounded-full bg-surface-2 px-2.5 py-1 text-xs text-fg-muted hover:text-fg">#{t.name}</Link>)}
        </div>
      )}

      {a.series && (
        <Card className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-fg-subtle">Chuỗi bài · {a.series.title}</p>
          <ol className="space-y-1">
            {a.series.items.map((x, i) => (
              <li key={x.slug}>
                <Link href={routes.learnArticle(x.slug)} className={cn('flex items-center gap-2 rounded-lg px-1 py-1.5 text-sm', x.slug === a.slug ? 'font-semibold text-fg' : 'text-fg-muted hover:text-fg')}>
                  {x.completed || (x.slug === a.slug && pct >= 90) ? <CheckCircle2 className="size-4 shrink-0 text-brand" aria-hidden />
                    : <span className="grid size-4 shrink-0 place-items-center rounded-full border border-border text-[10px]">{i + 1}</span>}
                  <span className="min-w-0 flex-1">{x.title}</span>
                </Link>
              </li>
            ))}
          </ol>
          <p className="flex items-center gap-1.5 text-xs text-fg-muted"><Award className="size-3.5 text-coin" aria-hidden />Đọc hết chuỗi để nhận huy hiệu.</p>
        </Card>
      )}

      {(ctas.length > 0 || nextInSeries) && (
        <Card className="space-y-3 bg-gradient-to-br from-brand/12 to-surface">
          <div>
            <h2 className="font-bold">Tiếp tục hành trình của bạn</h2>
            <p className="text-sm text-fg-muted">Bạn đã tìm hiểu về {a.category.name.toLowerCase()}. Hãy chọn bước tiếp theo.</p>
          </div>
          <div className="grid gap-2">
            {nextInSeries && (
              <Link href={routes.learnArticle(nextInSeries.slug)} className="flex h-11 items-center justify-between rounded-xl bg-brand px-4 text-[15px] font-semibold text-brand-fg">
                Bài tiếp: {nextInSeries.title.length > 34 ? `${nextInSeries.title.slice(0, 34)}…` : nextInSeries.title}<ArrowRight className="size-4 shrink-0" aria-hidden />
              </Link>
            )}
            {ctas.map((c, i) => (
              <Link key={i} href={ctaHref(c)} onClick={() => void knowledgeTrack(a.id, 'CTA')}
                className={cn('flex h-11 items-center justify-between rounded-xl px-4 text-[15px] font-semibold',
                  i === 0 && !nextInSeries ? 'bg-brand text-brand-fg' : 'border border-border bg-surface-2 text-fg hover:border-fg-subtle')}>
                {ctaLabel(c)}<ArrowRight className="size-4 shrink-0" aria-hidden />
              </Link>
            ))}
          </div>
        </Card>
      )}

      {!a.preview && <Feedback a={a} />}

      {a.author && (a.author.bio || a.author.partner_id) && (
        <Card className="flex gap-3">
          <Avatar src={a.author.avatar_url} name={a.author.name} size="lg" />
          <div className="min-w-0 flex-1 space-y-1">
            <p className="flex items-center gap-1 font-semibold">{a.author.name}{a.author.verified && <BadgeCheck className="size-4 text-brand" aria-label="Đã xác minh" />}</p>
            <p className="text-xs text-fg-muted">{a.author.title ?? AUTHOR_KIND[a.author.kind as keyof typeof AUTHOR_KIND]}</p>
            {a.author.bio && <p className="text-sm">{a.author.bio}</p>}
            {a.author.partner_id && <Link href={routes.partner(a.author.partner_id)} className="inline-flex items-center gap-1 text-sm font-semibold text-brand">Xem hồ sơ & dịch vụ<ArrowRight className="size-3.5" aria-hidden /></Link>}
          </div>
        </Card>
      )}

      {a.related.length > 0 && (
        <section>
          <h2 className="mb-1 font-semibold">Đọc thêm</h2>
          <div className="space-y-1">{a.related.map((r) => <ArticleRow key={r.id} a={r} />)}</div>
        </section>
      )}
    </article>
  )
}

function Feedback({ a }: { a: Article }) {
  const [vote, setVote] = useState<boolean | null>(a.my_feedback?.helpful ?? null)
  const [comment, setComment] = useState('')
  const [sent, setSent] = useState(!!a.my_feedback?.comment)
  const send = (helpful: boolean, note: string | null) =>
    knowledgeFeedback(a.id, helpful, note).catch((e) => { toast.error(knowledgeErrorMessage(e)) })
  return (
    <div className="space-y-2 rounded-2xl border border-border p-4">
      <p className="text-sm font-semibold">Bài viết có hữu ích không?</p>
      <div className="flex gap-2">
        {([true, false] as const).map((h) => (
          <Button key={String(h)} size="sm" variant={vote === h ? 'primary' : 'secondary'} onClick={() => { setVote(h); void send(h, null) }}>
            {h ? <ThumbsUp className="size-4" aria-hidden /> : <ThumbsDown className="size-4" aria-hidden />}{h ? 'Hữu ích' : 'Chưa hữu ích'}
          </Button>
        ))}
      </div>
      {vote !== null && !sent && (
        <div className="space-y-2">
          <Textarea value={comment} onChange={(e) => setComment(e.target.value)} maxLength={500} rows={2}
            placeholder={vote ? 'Bạn thích điều gì? (không bắt buộc)' : 'Cần bổ sung / sửa gì? Góp ý giúp ban biên tập.'} />
          {comment.trim() && <Button size="sm" onClick={() => void send(vote, comment.trim()).then(() => { setSent(true); toast.success('Cảm ơn góp ý của bạn!') })}>Gửi góp ý</Button>}
        </div>
      )}
      {sent && <p className="text-xs text-fg-muted">Đã nhận góp ý — cảm ơn bạn!</p>}
    </div>
  )
}
