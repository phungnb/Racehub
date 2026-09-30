'use client'

import Link from 'next/link'
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BookOpen, Coins, FileText, ImagePlus, PenLine, Plus, Send, Trash2, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { Button, Card, ConfirmSheet, EmptyState, ErrorState, Field, Input, PageHeader, SegmentedControl, Sheet, Skeleton, Textarea } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { routes } from '@/shared/config/routes'
import { FileButton } from '@/shared/design/studio/bits'
import {
  deleteSubmission, knowledgeErrorMessage, mySubmissions, submitArticle, uploadContentImage, uploadContentPdf, writerCategories,
  type Submission, type SubmissionInput,
} from '../api/knowledgeApi'
import { parseMarkdown } from '../model/markdown'
import { Markdown } from './Markdown'

const STATUS: Record<string, { label: string; tone: string }> = {
  DRAFT: { label: 'Nháp', tone: 'bg-surface-2 text-fg-muted' },
  REVIEW: { label: 'Chờ duyệt', tone: 'bg-warning/15 text-warning' },
  SCHEDULED: { label: 'Hẹn đăng', tone: 'bg-sky-500/15 text-sky-400' },
  PUBLISHED: { label: 'Đã đăng', tone: 'bg-brand/15 text-brand' },
  ARCHIVED: { label: 'Đã gỡ', tone: 'bg-surface-2 text-fg-subtle' },
}
const keys = { mine: ['knowledge', 'mine'] as const, cats: ['knowledge', 'writer-cats'] as const }

/**
 * Runner soạn bài / chia sẻ ebook chạy bộ (migration 011700): lưu nháp → gửi duyệt → ban biên tập duyệt và đăng
 * → tác giả tự được cộng Xu. Bài đã đăng không sửa được (liên hệ ban biên tập).
 */
export function WriteScreen() {
  const q = useQuery({ queryKey: keys.mine, queryFn: mySubmissions })
  const [edit, setEdit] = useState<Submission | 'new' | null>(null)
  return (
    <div className="space-y-4 animate-fade-in">
      <PageHeader title="Viết bài cho cộng đồng" subtitle="Chia sẻ kinh nghiệm, giáo án, ebook chạy bộ" fallback={routes.learn}
        action={<Button size="sm" onClick={() => setEdit('new')}><Plus className="size-4" aria-hidden />Bài mới</Button>} />
      <Card className="flex gap-3 border-coin/30 bg-coin/5 p-3 text-sm">
        <Coins className="size-5 shrink-0 text-coin" aria-hidden />
        <p>Bài được ban biên tập duyệt và đăng lên mục Kiến thức, bạn được <b>cộng Xu tự động</b>. Viết từ trải nghiệm thật, ghi nguồn khi trích dẫn; chủ đề sức khoẻ / chấn thương cần thêm duyệt chuyên môn.</p>
      </Card>
      {q.isPending ? <div className="space-y-2">{Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-16" />)}</div>
        : q.isError ? <ErrorState message={knowledgeErrorMessage(q.error)} error={q.error} onRetry={() => void q.refetch()} />
        : !q.data.length ? (
          <EmptyState icon={PenLine} title="Chưa có bài nào" description="Bắt đầu với một câu chuyện chạy bộ của bạn: lần đầu chạy 10K, cách chọn giày, giáo án tự tập…"
            action={<Button size="sm" onClick={() => setEdit('new')}><Plus className="size-4" aria-hidden />Viết bài đầu tiên</Button>} />
        ) : (
          <Card className="divide-y divide-border overflow-hidden p-0">
            {q.data.map((a) => (
              <div key={a.id} className="flex items-start gap-3 px-3 py-2.5">
                {a.content_type === 'EBOOK' ? <BookOpen className="mt-0.5 size-5 shrink-0 text-xp" aria-hidden /> : <FileText className="mt-0.5 size-5 shrink-0 text-fg-muted" aria-hidden />}
                <div className="min-w-0 flex-1">
                  <p className="font-semibold leading-snug">{a.title}</p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-fg-muted">
                    <span className={cn('rounded-full px-2 py-0.5 font-bold', STATUS[a.status]?.tone)}>{STATUS[a.status]?.label ?? a.status}</span>
                    {a.reward_xu > 0 && <span className="font-semibold text-coin">+{a.reward_xu} Xu</span>}
                    {a.review_note && a.status === 'DRAFT' && <span className="text-warning">Góp ý: {a.review_note}</span>}
                  </p>
                </div>
                {a.status === 'DRAFT' || a.status === 'REVIEW'
                  ? <Button size="sm" variant="secondary" onClick={() => setEdit(a)}>Sửa</Button>
                  : <Link href={routes.learnArticle(a.slug)} className="text-sm font-semibold text-brand">Xem</Link>}
              </div>
            ))}
          </Card>
        )}
      {edit && <Editor initial={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
    </div>
  )
}

function Editor({ initial, onClose }: { initial: Submission | null; onClose: () => void }) {
  const qc = useQueryClient()
  const cats = useQuery({ queryKey: keys.cats, queryFn: writerCategories, staleTime: 10 * 60_000 })
  const [f, setF] = useState<SubmissionInput>(() => ({
    id: initial?.id, title: initial?.title ?? '', summary: initial?.summary ?? '', body: initial?.body ?? '',
    category_id: initial?.category_id ?? 'BEGINNER', content_type: initial?.content_type ?? 'ARTICLE',
    cover_image_url: initial?.cover_image_url ?? null, attachment_url: initial?.attachment_url ?? null, submit: false,
  }))
  const set = (p: Partial<SubmissionInput>) => setF((x) => ({ ...x, ...p }))
  const [tab, setTab] = useState<'WRITE' | 'PREVIEW'>('WRITE')
  const [busy, setBusy] = useState<'cover' | 'pdf' | null>(null)
  const [del, setDel] = useState(false)
  const refresh = () => void qc.invalidateQueries({ queryKey: keys.mine })
  const save = useMutation({
    mutationFn: (submit: boolean) => submitArticle({ ...f, submit }),
    onSuccess: (r, submit) => {
      toast.success(submit ? 'Đã gửi bài cho ban biên tập duyệt' : 'Đã lưu nháp')
      set({ id: r.id }); refresh()
      if (submit) onClose()
    },
    onError: (e) => toast.error(knowledgeErrorMessage(e)),
  })
  const remove = useMutation({
    mutationFn: () => deleteSubmission(f.id!),
    onSuccess: () => { toast.success('Đã xóa bài'); refresh(); onClose() },
    onError: (e) => toast.error(knowledgeErrorMessage(e)),
  })
  const upload = async (kind: 'cover' | 'pdf', file: File | undefined) => {
    if (!file) return
    setBusy(kind)
    try {
      const url = kind === 'cover' ? await uploadContentImage(file) : await uploadContentPdf(file)
      set(kind === 'cover' ? { cover_image_url: url } : { attachment_url: url })
    } catch (e) { toast.error(knowledgeErrorMessage(e)) } finally { setBusy(null) }
  }
  const ebook = f.content_type === 'EBOOK'
  const min = ebook ? 50 : 300

  return (
    <Sheet open onClose={onClose} title={initial ? 'Sửa bài' : 'Bài mới'} className="max-w-2xl"
      footer={
        <div className="flex gap-2">
          {f.id && <Button variant="ghost" onClick={() => setDel(true)} aria-label="Xóa bài"><Trash2 className="size-4" aria-hidden /></Button>}
          <Button variant="secondary" block onClick={() => save.mutate(false)} loading={save.isPending && !save.variables} disabled={f.title.trim().length < 5}>Lưu nháp</Button>
          <Button block onClick={() => save.mutate(true)} loading={save.isPending && !!save.variables}
            disabled={f.title.trim().length < 5 || f.body.trim().length < min || (ebook && !f.attachment_url)}>
            <Send className="size-4" aria-hidden />Gửi duyệt
          </Button>
        </div>
      }>
      <div className="space-y-3">
        <SegmentedControl value={f.content_type} onChange={(v) => set({ content_type: v })}
          options={[{ value: 'ARTICLE', label: 'Bài viết' }, { value: 'EBOOK', label: 'Ebook (PDF)' }]} />
        <Field label="Tiêu đề" htmlFor="w-title">
          <Input id="w-title" value={f.title} maxLength={140} onChange={(e) => set({ title: e.target.value })} placeholder="VD: 5 điều mình học được sau lần đầu chạy 21K" />
        </Field>
        <Field label="Chuyên mục" htmlFor="w-cat" hint={cats.data?.find((c) => c.id === f.category_id)?.needs_expert ? 'Chủ đề sức khoẻ: cần thêm chuyên gia duyệt, có thể lâu hơn.' : undefined}>
          <select id="w-cat" value={f.category_id} onChange={(e) => set({ category_id: e.target.value })}
            className="h-11 w-full rounded-xl border border-border bg-bg px-3 text-[15px]">
            {(cats.data ?? [{ id: 'BEGINNER', name: 'Bắt đầu chạy bộ', needs_expert: false }]).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="Tóm tắt (không bắt buộc)" htmlFor="w-sum">
          <Input id="w-sum" value={f.summary} maxLength={300} onChange={(e) => set({ summary: e.target.value })} placeholder="1–2 câu giới thiệu bài" />
        </Field>
        <div className="flex flex-wrap gap-2">
          <FileButton label="Ảnh bìa" onPick={(file) => void upload('cover', file)} disabled={busy !== null}
            className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-border px-3 text-sm font-semibold hover:bg-surface-2">
            <ImagePlus className="size-4" aria-hidden />{busy === 'cover' ? 'Đang tải…' : f.cover_image_url ? 'Đổi ảnh bìa' : 'Ảnh bìa'}
          </FileButton>
          {ebook && <PdfButton busy={busy === 'pdf'} has={!!f.attachment_url} onPick={(file) => void upload('pdf', file)} />}
        </div>
        {f.cover_image_url && (
          // eslint-disable-next-line @next/next/no-img-element -- ảnh bìa vừa tải lên
          <img src={f.cover_image_url} alt="" className="aspect-[16/9] w-full rounded-xl object-cover" />
        )}
        {ebook && f.attachment_url && <a href={f.attachment_url} target="_blank" rel="noopener noreferrer" className="block truncate text-sm text-brand">📘 Đã đính kèm ebook PDF</a>}
        <SegmentedControl value={tab} onChange={setTab} options={[{ value: 'WRITE', label: 'Soạn' }, { value: 'PREVIEW', label: 'Xem trước' }]} />
        {tab === 'WRITE' ? (
          <Field label={ebook ? 'Giới thiệu ebook' : 'Nội dung'} htmlFor="w-body"
            hint={`${f.body.trim().length}/${min} ký tự tối thiểu · hỗ trợ Markdown: ## Tiêu đề, **đậm**, - gạch đầu dòng`}>
            <Textarea id="w-body" value={f.body} onChange={(e) => set({ body: e.target.value })} rows={14} maxLength={60000}
              placeholder={ebook ? 'Ebook nói về gì, dành cho ai, gồm những phần nào…' : 'Viết câu chuyện / kinh nghiệm của bạn…'} />
          </Field>
        ) : (
          <div className="min-h-40 rounded-xl border border-border p-3">
            {f.body.trim() ? <Markdown blocks={parseMarkdown(f.body)} /> : <p className="text-sm text-fg-subtle">Chưa có nội dung.</p>}
          </div>
        )}
      </div>
      <ConfirmSheet open={del} onClose={() => setDel(false)} title="Xóa bài này?" confirmLabel="Xóa" loading={remove.isPending}
        description="Bài nháp / đang chờ duyệt sẽ bị xóa hẳn." onConfirm={() => remove.mutate()} />
    </Sheet>
  )
}

function PdfButton({ busy, has, onPick }: { busy: boolean; has: boolean; onPick: (f: File | undefined) => void }) {
  return (
    <label className={cn('inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border border-border px-3 text-sm font-semibold hover:bg-surface-2', busy && 'opacity-60')}>
      <Upload className="size-4" aria-hidden />{busy ? 'Đang tải…' : has ? 'Đổi tệp PDF' : 'Tải ebook PDF (≤ 10 MB)'}
      <input type="file" accept="application/pdf" hidden disabled={busy} onChange={(e) => { onPick(e.target.files?.[0]); e.target.value = '' }} />
    </label>
  )
}
