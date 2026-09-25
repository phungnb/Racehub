'use client'

import Link from 'next/link'
import { useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft, Bold, Eye, Heading2, Heading3, ImagePlus, Italic, Link2, List, ListOrdered, Plus, Quote, ShieldCheck, Trash2, Upload, X,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button, Card, ConfirmSheet, ErrorState, Field, Input, SegmentedControl, Sheet, Skeleton, SwitchRow, Textarea } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { routes } from '@/shared/config/routes'
import {
  cmsDelete, cmsExpertReview, cmsGet, cmsSave, cmsSetStatus, knowledgeErrorMessage, uploadContentImage,
  type ArticleStatus, type CmsArticle, type CmsInput, type CmsMeta, type ContentType, type Cta, type CtaKind,
} from '../../api/knowledgeApi'
import { CTA_KINDS, STATUS_LABEL, STATUS_TONE } from '../../model/knowledge'
import { parseMarkdown, slugify } from '../../model/markdown'
import { Markdown } from '../Markdown'

const EMPTY: CmsInput = { title: '', body: '', category_id: 'BEGINNER', content_type: 'ARTICLE', summary: '', tags: [], sources: [], ctas: [] }

/** Trang soạn bài: nội dung Markdown + xem trước, ảnh, tag, nguồn, hành động cuối bài, lịch đăng, duyệt chuyên môn */
export function ArticleEditor({ id, meta, onClose }: { id: string | null; meta: CmsMeta; onClose: () => void }) {
  const q = useQuery({ queryKey: ['cms', 'article', id], queryFn: () => cmsGet(id!), enabled: !!id })
  if (id && q.isPending) return <div className="space-y-3"><Skeleton className="h-12" /><Skeleton className="h-96" /></div>
  if (id && q.isError) return <ErrorState message={knowledgeErrorMessage(q.error)} error={q.error} onRetry={() => void q.refetch()} />
  return <Editor key={q.data?.id ?? 'new'} initial={q.data ?? null} meta={meta} onClose={onClose} />
}

const TOOLS = [
  { key: 'h2', icon: Heading2, label: 'Tiêu đề mục' }, { key: 'h3', icon: Heading3, label: 'Tiêu đề nhỏ' },
  { key: 'b', icon: Bold, label: 'Đậm' }, { key: 'i', icon: Italic, label: 'Nghiêng' },
  { key: 'ul', icon: List, label: 'Danh sách' }, { key: 'ol', icon: ListOrdered, label: 'Danh sách số' },
  { key: 'q', icon: Quote, label: 'Ghi chú nổi bật' }, { key: 'a', icon: Link2, label: 'Link' },
] as const

const fromVn = (v: string) => (v ? new Date(`${v}:00+07:00`).toISOString() : null)

function Editor({ initial, meta, onClose }: { initial: CmsArticle | null; meta: CmsMeta; onClose: () => void }) {
  const qc = useQueryClient()
  const [f, setF] = useState<CmsInput>(() => (initial ? { ...initial } : { ...EMPTY, author_id: meta.authors[0]?.id ?? null }))
  const [id, setId] = useState<string | null>(initial?.id ?? null)
  const [slugTouched, setSlugTouched] = useState(!!initial)
  const [mode, setMode] = useState<'edit' | 'preview'>('edit')
  const [sheet, setSheet] = useState<'schedule' | 'return' | 'reject' | 'delete' | null>(null)
  const [note, setNote] = useState('')
  const [when, setWhen] = useState('')
  const body = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const coverRef = useRef<HTMLInputElement>(null)
  const status: ArticleStatus = initial?.status ?? 'DRAFT'
  const editor = meta.role === 'ADMIN' || meta.role === 'EDITOR'
  const expert = meta.role === 'ADMIN' || meta.role === 'EXPERT'
  const cat = meta.categories.find((c) => c.id === f.category_id)
  const needsExpert = !!(cat?.needs_expert || f.needs_expert_review)
  const reviewed = !!initial?.expert_reviewed_at && initial.body === f.body
  const locked = !editor && !!initial && !['DRAFT', 'REVIEW'].includes(status)
  const set = <K extends keyof CmsInput>(k: K, v: CmsInput[K]) => setF((x) => ({ ...x, [k]: v }))
  const blocks = useMemo(() => (mode === 'preview' ? parseMarkdown(f.body) : []), [mode, f.body])
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['cms'] }); void qc.invalidateQueries({ queryKey: ['knowledge'] }) }

  const save = useMutation({
    mutationFn: () => cmsSave({ ...f, id: id ?? undefined, slug: f.slug || undefined }),
    onSuccess: (newId) => { setId(newId); refresh() },
  })
  const saveThen = async (then?: (savedId: string) => Promise<unknown>, msg = 'Đã lưu') => {
    try {
      const newId = await save.mutateAsync()
      if (then) await then(newId)
      toast.success(msg)
      refresh()
      return true
    } catch (e) { toast.error(knowledgeErrorMessage(e)); return false }
  }
  const setStatus = (s: ArticleStatus, at: string | null = null, n: string | null = null, msg?: string) =>
    saveThen((sid) => cmsSetStatus(sid, s, at, n), msg ?? `Đã chuyển: ${STATUS_LABEL[s]}`)
      .then((ok) => { if (!ok) return; setSheet(null); if (s !== 'DRAFT') onClose() })

  const wrap = (before: string, after = before, placeholder = 'chữ') => {
    const el = body.current
    if (!el) return
    const { selectionStart: a, selectionEnd: b, value } = el
    const sel = value.slice(a, b) || placeholder
    const next = value.slice(0, a) + before + sel + after + value.slice(b)
    set('body', next)
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(a + before.length, a + before.length + sel.length) })
  }
  const line = (prefix: string) => {
    const el = body.current
    if (!el) return
    const { selectionStart: a, value } = el
    const start = value.lastIndexOf('\n', a - 1) + 1
    set('body', value.slice(0, start) + prefix + value.slice(start))
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(a + prefix.length, a + prefix.length) })
  }
  const tool = (k: (typeof TOOLS)[number]['key']) => {
    if (k === 'h2') line('## '); else if (k === 'h3') line('### '); else if (k === 'b') wrap('**'); else if (k === 'i') wrap('*')
    else if (k === 'ul') line('- '); else if (k === 'ol') line('1. '); else if (k === 'q') line('> '); else wrap('[', '](https://)', 'chữ hiển thị')
  }
  const upload = async (file: File, cover: boolean) => {
    const t = toast.loading('Đang tải ảnh…')
    try {
      const url = await uploadContentImage(file)
      if (cover) set('cover_image_url', url)
      else {
        const el = body.current
        const pos = el?.selectionStart ?? f.body.length
        set('body', `${f.body.slice(0, pos)}\n\n![Mô tả ảnh](${url})\n\n${f.body.slice(pos)}`)
      }
      toast.success('Đã tải ảnh', { id: t })
    } catch (e) { toast.error(knowledgeErrorMessage(e), { id: t }) }
  }

  const ctas = (f.ctas ?? []) as Cta[]
  const sources = f.sources ?? []

  return (
    <div className="space-y-4 pb-28">
      <div className="flex items-center gap-2">
        <button type="button" onClick={onClose} className="-ml-1 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-fg-muted hover:text-fg">
          <ArrowLeft className="size-4" aria-hidden />Danh sách bài
        </button>
        <span className={cn('ml-auto rounded-full px-2.5 py-1 text-xs font-semibold', STATUS_TONE[status])}>{STATUS_LABEL[status]}</span>
        {id && f.slug && <Link href={routes.learnArticle(f.slug)} target="_blank" className="inline-flex h-9 items-center gap-1 rounded-lg border border-border px-2.5 text-xs font-semibold"><Eye className="size-3.5" aria-hidden />Xem như người đọc</Link>}
      </div>

      {initial?.review_note && <p className="rounded-xl bg-warning/15 p-3 text-sm text-warning">{initial.review_note}</p>}
      {needsExpert && (
        <p className={cn('flex gap-2 rounded-xl p-3 text-sm', reviewed ? 'bg-brand/10 text-fg' : 'bg-surface-2 text-fg-muted')}>
          <ShieldCheck className={cn('size-4 shrink-0', reviewed ? 'text-brand' : 'text-fg-subtle')} aria-hidden />
          {reviewed ? `Đã duyệt chuyên môn bởi ${initial?.expert_name ?? 'chuyên gia'}${initial?.expert_note ? ` — “${initial.expert_note}”` : ''}`
            : 'Chủ đề sức khoẻ / dinh dưỡng / chấn thương / giáo án: cần chuyên gia duyệt chuyên môn trước khi đăng. Sửa nội dung sau khi duyệt sẽ phải duyệt lại.'}
        </p>
      )}

      <Card className="space-y-4">
        <SegmentedControl value={f.content_type ?? 'ARTICLE'} onChange={(v: ContentType) => set('content_type', v)}
          options={[{ value: 'ARTICLE', label: '📚 Kiến thức' }, { value: 'NEWS', label: '📰 Tin tức' }]} />
        <Field label="Chuyên mục" htmlFor="cms-cat">
          <select id="cms-cat" value={f.category_id} onChange={(e) => set('category_id', e.target.value)} className="h-11 w-full rounded-xl border border-border bg-bg px-3 text-[15px]">
            {meta.categories.map((c) => <option key={c.id} value={c.id}>{c.name}{c.needs_expert ? ' (cần duyệt chuyên môn)' : ''}</option>)}
          </select>
        </Field>
        <Field label="Tiêu đề" htmlFor="cms-title" hint={`${f.title.length}/140`}>
          <Input id="cms-title" value={f.title} maxLength={140} disabled={locked}
            onChange={(e) => { set('title', e.target.value); if (!slugTouched) set('slug', slugify(e.target.value)) }} placeholder="Bắt đầu chạy bộ: lộ trình từ 0 đến 5 km" />
        </Field>
        <Field label="Đường dẫn" htmlFor="cms-slug" hint={`racehub…/learn/${f.slug || slugify(f.title) || '…'}`}>
          <Input id="cms-slug" value={f.slug ?? ''} maxLength={80} onChange={(e) => { setSlugTouched(true); set('slug', slugify(e.target.value)) }} />
        </Field>
        <Field label="Tóm tắt (hiện ở danh sách & khi chia sẻ)" htmlFor="cms-sum" hint={`${(f.summary ?? '').length}/300`}>
          <Textarea id="cms-sum" rows={2} maxLength={300} value={f.summary ?? ''} onChange={(e) => set('summary', e.target.value)} />
        </Field>
        <Field label="Ảnh bìa">
          <div className="flex items-center gap-3">
            {f.cover_image_url
              // eslint-disable-next-line @next/next/no-img-element -- xem trước ảnh bìa
              ? <img src={f.cover_image_url} alt="" className="h-20 w-32 rounded-xl border border-border object-cover" />
              : <span className="grid h-20 w-32 place-items-center rounded-xl border border-dashed border-border text-xs text-fg-subtle">16:9</span>}
            <div className="flex flex-col gap-1.5">
              <Button size="sm" variant="secondary" onClick={() => coverRef.current?.click()}><Upload className="size-4" aria-hidden />Tải ảnh</Button>
              {f.cover_image_url && <Button size="sm" variant="ghost" onClick={() => set('cover_image_url', null)}>Bỏ ảnh</Button>}
            </div>
            <input ref={coverRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => { const x = e.target.files?.[0]; if (x) void upload(x, true); e.target.value = '' }} />
          </div>
        </Field>
      </Card>

      <Card className="space-y-2">
        <div className="flex items-center gap-2">
          <p className="shrink-0 font-semibold">Nội dung</p>
          <span className="whitespace-nowrap text-xs text-fg-subtle">~{Math.max(1, Math.round(f.body.trim().split(/\s+/).filter(Boolean).length / 200))} phút đọc</span>
          <SegmentedControl className="ml-auto w-40 shrink-0" value={mode} onChange={setMode} options={[{ value: 'edit', label: 'Soạn' }, { value: 'preview', label: 'Xem trước' }]} />
        </div>
        {mode === 'edit' ? (
          <>
            <div className="-mx-1 flex flex-wrap gap-0.5" role="toolbar" aria-label="Định dạng">
              {TOOLS.map((b) => (
                <button key={b.label} type="button" onClick={() => tool(b.key)} aria-label={b.label} title={b.label}
                  className="grid size-10 place-items-center rounded-lg text-fg-muted hover:bg-surface-2 hover:text-fg"><b.icon className="size-4" aria-hidden /></button>
              ))}
              <button type="button" onClick={() => fileRef.current?.click()} aria-label="Chèn ảnh" title="Chèn ảnh"
                className="grid size-10 place-items-center rounded-lg text-fg-muted hover:bg-surface-2 hover:text-fg"><ImagePlus className="size-4" aria-hidden /></button>
              <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => { const x = e.target.files?.[0]; if (x) void upload(x, false); e.target.value = '' }} />
            </div>
            <Textarea ref={body} value={f.body} onChange={(e) => set('body', e.target.value)} rows={18} disabled={locked}
              className="min-h-[24rem] font-mono text-[13px] leading-relaxed"
              placeholder={'## Mục đầu tiên\n\nĐoạn văn… **đậm**, *nghiêng*, [link](https://…)\n\n- ý 1\n- ý 2\n\n> Ghi chú quan trọng\n\nDán link YouTube một dòng riêng để nhúng video.'} />
            <p className="text-[11px] text-fg-subtle">Markdown: ## tiêu đề · **đậm** · - danh sách · &gt; ghi chú · | bảng | · link YouTube một dòng = video. Không nhận HTML.</p>
          </>
        ) : (
          <div className="rounded-xl border border-border p-4">{f.body.trim() ? <Markdown blocks={blocks} /> : <p className="text-sm text-fg-muted">Chưa có nội dung.</p>}</div>
        )}
      </Card>

      {f.content_type === 'NEWS' && (
        <Card className="space-y-3">
          <p className="font-semibold">Nguồn tin</p>
          <p className="text-xs text-fg-muted">Tin tổng hợp: tự viết tóm tắt bằng lời của RaceHub, dẫn link bài gốc, không sao chép nguyên văn / ảnh khi chưa có quyền.</p>
          <div className="grid grid-cols-[1fr_8rem] gap-2">
            <Input value={f.source_url ?? ''} onChange={(e) => set('source_url', e.target.value)} placeholder="https://… link bài gốc" aria-label="Link bài gốc" />
            <Input value={f.source_name ?? ''} onChange={(e) => set('source_name', e.target.value)} placeholder="Tên trang" aria-label="Tên trang nguồn" maxLength={80} />
          </div>
        </Card>
      )}

      <Card className="space-y-3">
        <div className="flex items-center justify-between"><p className="font-semibold">Nguồn tham khảo</p>
          <Button size="sm" variant="ghost" onClick={() => set('sources', [...sources, { title: '', url: null, publisher: null }])}><Plus className="size-4" aria-hidden />Thêm</Button></div>
        {sources.length === 0 && <p className="text-xs text-fg-muted">Bài sức khoẻ / dinh dưỡng / giáo án nên ghi nguồn và ngày cập nhật.</p>}
        {sources.map((s, i) => (
          <div key={i} className="grid grid-cols-[1fr_auto] gap-2 rounded-xl border border-border p-2">
            <div className="space-y-1.5">
              <Input value={s.title} onChange={(e) => set('sources', sources.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} placeholder="Tên tài liệu / bài viết" aria-label="Tên nguồn" />
              <div className="grid grid-cols-[1fr_7rem] gap-1.5">
                <Input value={s.url ?? ''} onChange={(e) => set('sources', sources.map((x, j) => (j === i ? { ...x, url: e.target.value || null } : x)))} placeholder="https://…" aria-label="Link nguồn" />
                <Input value={s.publisher ?? ''} onChange={(e) => set('sources', sources.map((x, j) => (j === i ? { ...x, publisher: e.target.value || null } : x)))} placeholder="Nơi xuất bản" aria-label="Nơi xuất bản" />
              </div>
            </div>
            <Button size="sm" variant="ghost" aria-label="Xoá nguồn" onClick={() => set('sources', sources.filter((_, j) => j !== i))}><X className="size-4" aria-hidden /></Button>
          </div>
        ))}
      </Card>

      <Card className="space-y-3">
        <div className="flex items-center justify-between">
          <div><p className="font-semibold">Tiếp tục hành trình (tối đa 3)</p><p className="text-xs text-fg-muted">Dẫn người đọc tới tính năng trong app. Để trống = gợi ý theo chuyên mục.</p></div>
          {ctas.length < 3 && <Button size="sm" variant="ghost" onClick={() => set('ctas', [...ctas, { kind: 'CHALLENGES', target: null, label: null }])}><Plus className="size-4" aria-hidden />Thêm</Button>}
        </div>
        {ctas.map((c, i) => (
          <div key={i} className="grid grid-cols-[1fr_auto] gap-2 rounded-xl border border-border p-2">
            <div className="space-y-1.5">
              <select value={c.kind} aria-label="Loại hành động" onChange={(e) => set('ctas', ctas.map((x, j) => (j === i ? { kind: e.target.value as CtaKind, target: null, label: null } : x)))}
                className="h-10 w-full rounded-lg border border-border bg-bg px-2 text-sm">
                {(Object.keys(CTA_KINDS) as CtaKind[]).map((k) => <option key={k} value={k}>{CTA_KINDS[k].label}</option>)}
              </select>
              {CTA_KINDS[c.kind].target && (
                <Input value={c.target ?? ''} onChange={(e) => set('ctas', ctas.map((x, j) => (j === i ? { ...x, target: e.target.value || null } : x)))} placeholder={CTA_KINDS[c.kind].target} aria-label="Đích" />
              )}
              <Input value={c.label ?? ''} maxLength={40} onChange={(e) => set('ctas', ctas.map((x, j) => (j === i ? { ...x, label: e.target.value || null } : x)))} placeholder={`Chữ trên nút (mặc định: ${CTA_KINDS[c.kind].label})`} aria-label="Chữ trên nút" />
            </div>
            <Button size="sm" variant="ghost" aria-label="Xoá hành động" onClick={() => set('ctas', ctas.filter((_, j) => j !== i))}><X className="size-4" aria-hidden /></Button>
          </div>
        ))}
      </Card>

      <Card className="space-y-4">
        <Field label="Tag (cách nhau bởi dấu phẩy)" htmlFor="cms-tags">
          <Input id="cms-tags" value={(f.tags ?? []).join(', ')} onChange={(e) => set('tags', e.target.value.split(',').map((x) => x.trimStart()).slice(0, 10))}
            onBlur={() => set('tags', (f.tags ?? []).map((x) => x.trim()).filter(Boolean))} placeholder="10K, giày, người mới" list="cms-tag-list" />
          <datalist id="cms-tag-list">{meta.tags.map((t) => <option key={t.slug} value={t.name} />)}</datalist>
        </Field>
        <Field label="Tác giả" htmlFor="cms-author">
          <select id="cms-author" value={f.author_id ?? ''} onChange={(e) => set('author_id', e.target.value || null)} className="h-11 w-full rounded-xl border border-border bg-bg px-3 text-[15px]">
            <option value="">— Chưa chọn —</option>
            {meta.authors.map((au) => <option key={au.id} value={au.id}>{au.name}{au.title ? ` · ${au.title}` : ''}</option>)}
          </select>
        </Field>
        <div className="grid grid-cols-[1fr_6rem] gap-2">
          <Field label="Chuỗi bài" htmlFor="cms-series">
            <select id="cms-series" value={f.series_id ?? ''} onChange={(e) => set('series_id', e.target.value || null)} className="h-11 w-full rounded-xl border border-border bg-bg px-3 text-[15px]">
              <option value="">— Không —</option>
              {meta.series.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
            </select>
          </Field>
          <Field label="Thứ tự" htmlFor="cms-order">
            <Input id="cms-order" inputMode="numeric" value={f.series_order ?? ''} disabled={!f.series_id}
              onChange={(e) => set('series_order', e.target.value ? Number(e.target.value.replace(/\D/g, '')) : null)} />
          </Field>
        </div>
        {editor && <SwitchRow checked={!!f.is_featured} onChange={(v) => set('is_featured', v)} label="Bài nổi bật" description="Ưu tiên hiện ở Trang chủ và đầu trang Kiến thức" />}
        {!cat?.needs_expert && <SwitchRow checked={!!f.needs_expert_review} onChange={(v) => set('needs_expert_review', v)} label="Cần duyệt chuyên môn" description="Bật cho bài có lời khuyên sức khoẻ / tập luyện" />}
      </Card>

      {initial && (initial.feedback.length > 0 || initial.views > 0) && (
        <Card className="space-y-2">
          <p className="font-semibold">Phản hồi người đọc</p>
          <p className="text-xs text-fg-muted">{initial.views} lượt xem · {initial.reads} đọc xong · {initial.saves} lưu · {initial.shares} chia sẻ · {initial.cta_clicks} bấm hành động · 👍 {initial.helpful_yes} · 👎 {initial.helpful_no}</p>
          {initial.feedback.slice(0, 10).map((x, i) => <p key={i} className="rounded-lg bg-surface-2 p-2 text-sm">{x.helpful ? '👍' : '👎'} {x.comment}</p>)}
        </Card>
      )}

      {/* Thanh thao tác */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-bg/95 px-4 pb-[max(env(safe-area-inset-bottom),0.75rem)] pt-3 backdrop-blur">
        <div className="mx-auto flex max-w-2xl flex-wrap gap-2">
          <Button variant="secondary" loading={save.isPending && !sheet} disabled={locked} onClick={() => void saveThen()}>Lưu</Button>
          {expert && needsExpert && !reviewed && id && (
            <>
              <Button variant="secondary" onClick={() => saveThen((sid) => cmsExpertReview(sid, true, null), 'Đã duyệt chuyên môn').then((ok) => ok && onClose())}><ShieldCheck className="size-4" aria-hidden />Duyệt chuyên môn</Button>
              <Button variant="ghost" onClick={() => { setNote(''); setSheet('reject') }}>Góp ý</Button>
            </>
          )}
          {!editor && (status === 'DRAFT' || !initial) && <Button onClick={() => void setStatus('REVIEW', null, null, 'Đã gửi duyệt')}>Gửi duyệt</Button>}
          {editor && status !== 'PUBLISHED' && (
            <>
              <Button disabled={needsExpert && !reviewed} onClick={() => void setStatus('PUBLISHED', null, null, 'Đã đăng bài')}>Đăng ngay</Button>
              <Button variant="secondary" disabled={needsExpert && !reviewed} onClick={() => setSheet('schedule')}>Hẹn giờ</Button>
            </>
          )}
          {editor && status === 'REVIEW' && initial?.created_by && <Button variant="ghost" onClick={() => { setNote(''); setSheet('return') }}>Trả về</Button>}
          {editor && status === 'PUBLISHED' && <Button variant="ghost" onClick={() => void setStatus('ARCHIVED', null, null, 'Đã lưu trữ — bài không còn hiện')}>Lưu trữ</Button>}
          {editor && status === 'ARCHIVED' && <Button variant="secondary" onClick={() => void setStatus('PUBLISHED', null, null, 'Đã đăng lại')}>Đăng lại</Button>}
          {id && !initial?.published_at && <Button variant="ghost" className="ml-auto text-danger" aria-label="Xoá bài" onClick={() => setSheet('delete')}><Trash2 className="size-4" aria-hidden /></Button>}
        </div>
      </div>

      <Sheet open={sheet === 'schedule'} onClose={() => setSheet(null)} title="Hẹn giờ đăng" description="Giờ Việt Nam. Bài tự hiện khi tới giờ."
        footer={<Button block disabled={!when} onClick={() => void setStatus('SCHEDULED', fromVn(when), null, 'Đã hẹn giờ đăng')}>Hẹn giờ</Button>}>
        <Input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} aria-label="Giờ đăng" />
      </Sheet>
      <Sheet open={sheet === 'return' || sheet === 'reject'} onClose={() => setSheet(null)}
        title={sheet === 'reject' ? 'Góp ý chuyên môn' : 'Trả bài về người viết'} description="Người viết nhận thông báo kèm ghi chú."
        footer={<Button block disabled={note.trim().length < 5} onClick={() => {
          if (sheet === 'reject') void cmsExpertReview(id!, false, note.trim()).then(() => { toast.success('Đã gửi góp ý'); refresh(); onClose() }, (e) => toast.error(knowledgeErrorMessage(e)))
          else void setStatus('DRAFT', null, note.trim(), 'Đã trả bài')
        }}>Gửi</Button>}>
        <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={4} maxLength={300} placeholder="Cần sửa gì, vì sao…" />
      </Sheet>
      <ConfirmSheet open={sheet === 'delete'} onClose={() => setSheet(null)} title="Xoá bài nháp?" confirmLabel="Xoá"
        description="Chỉ xoá được bài chưa từng đăng. Không hoàn tác."
        onConfirm={() => void cmsDelete(id!).then(() => { toast.success('Đã xoá'); refresh(); onClose() }, (e) => toast.error(knowledgeErrorMessage(e)))} />
    </div>
  )
}
