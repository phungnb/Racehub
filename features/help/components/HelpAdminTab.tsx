'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Building2, Eye, FileText, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button, Card, ConfirmSheet, EmptyState, ErrorState, Field, Input, SegmentedControl, Skeleton, SwitchRow, Textarea } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { Markdown, parseMarkdown } from '@/features/knowledge'
import { adminHelpDelete, adminHelpList, adminHelpSave, adminSiteInfoSave, helpErrorMessage, type HelpInput } from '../api/helpApi'
import { fillSiteInfo, SECTION_LABEL, SITE_KEYS, type HelpAdminPage, type HelpSection, type SiteInfo } from '../model/help'

const KEY = ['admin', 'help'] as const
const EMPTY: HelpInput = { slug: '', section: 'GUIDE', title: '', icon: '', summary: '', body: '', version: '1.0', effective_at: null, sort: 100, is_published: true, needs_review: false }

/** Quản trị → Cộng đồng → Hướng dẫn & chính sách: soạn trang menu ☰ + thông tin pháp nhân */
export function HelpAdminTab() {
  const q = useQuery({ queryKey: KEY, queryFn: adminHelpList })
  const [editing, setEditing] = useState<HelpAdminPage | 'new' | null>(null)
  if (q.isPending) return <div className="space-y-2"><Skeleton className="h-24" /><Skeleton className="h-64" /></div>
  if (q.isError) return <ErrorState message={helpErrorMessage(q.error)} error={q.error} onRetry={() => void q.refetch()} />
  if (editing) return <Editor initial={editing === 'new' ? null : editing} site={q.data.site} onClose={() => setEditing(null)} />
  const sections: HelpSection[] = ['GUIDE', 'POLICY', 'SUPPORT']
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <p className="min-w-0 flex-1 text-sm text-fg-muted">
          Nội dung menu ☰ (xem được cả khi chưa đăng nhập). Điều khoản & Quyền riêng tư nằm ở trang cố định <Link href="/terms" className="text-brand underline">/terms</Link>, <Link href="/privacy" className="text-brand underline">/privacy</Link>.
        </p>
        <Button size="sm" onClick={() => setEditing('new')}><Plus className="size-4" aria-hidden />Trang mới</Button>
      </div>
      <SiteInfoCard site={q.data.site} />
      {q.data.pages.length === 0 && <EmptyState icon={FileText} title="Chưa có trang" description="Chạy migration 007300 để có nội dung mẫu, hoặc tạo trang mới." />}
      {sections.map((s) => {
        const rows = q.data.pages.filter((p) => p.section === s)
        if (!rows.length) return null
        return (
          <section key={s}>
            <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-fg-subtle">{SECTION_LABEL[s]}</h3>
            <ul className="space-y-2">
              {rows.map((p) => (
                <li key={p.slug}>
                  <button type="button" onClick={() => setEditing(p)}
                    className="flex w-full items-center gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-3 text-left hover:border-fg-subtle">
                    <span className="text-xl" aria-hidden>{p.icon ?? '📄'}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold">{p.title}</span>
                      <span className="block text-xs text-fg-muted">/help/{p.slug} · v{p.version} · sửa {new Date(p.updated_at).toLocaleDateString('vi-VN')}{p.updated_by_name ? ` bởi ${p.updated_by_name}` : ''}</span>
                    </span>
                    {p.needs_review && <span className="shrink-0 rounded-full bg-warning/15 px-2 py-0.5 text-[11px] font-semibold text-warning">Cần rà</span>}
                    {!p.is_published && <span className="shrink-0 rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-semibold text-fg-muted">Ẩn</span>}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )
      })}
    </div>
  )
}

function SiteInfoCard({ site }: { site: SiteInfo }) {
  const qc = useQueryClient()
  const [f, setF] = useState<SiteInfo>(site)
  const [open, setOpen] = useState(false)
  const missing = SITE_KEYS.filter((k) => !site[k.key]).length
  const save = useMutation({
    mutationFn: () => adminSiteInfoSave(f),
    onSuccess: (d) => { setF(d); toast.success('Đã lưu thông tin pháp nhân'); void qc.invalidateQueries({ queryKey: KEY }); void qc.invalidateQueries({ queryKey: ['help'] }) },
    onError: (e) => toast.error(helpErrorMessage(e)),
  })
  return (
    <Card className="space-y-3">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-2 text-left">
        <Building2 className="size-5 text-brand" aria-hidden />
        <span className="flex-1 font-semibold">Thông tin pháp nhân (chân menu, trang chính sách)</span>
        {missing > 0 && <span className="rounded-full bg-warning/15 px-2 py-0.5 text-[11px] font-semibold text-warning">Thiếu {missing}</span>}
      </button>
      {open && (
        <>
          <p className="text-xs text-fg-muted">Dùng trong nội dung trang bằng <code>{'{{company_name}}'}</code>, <code>{'{{support_email}}'}</code>… Chưa nhập → hiện “đang cập nhật”.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {SITE_KEYS.map((k) => (
              <Field key={k.key} label={`${k.label} · {{${k.key}}}`} htmlFor={`si-${k.key}`}>
                <Input id={`si-${k.key}`} value={f[k.key] ?? ''} maxLength={300} placeholder={k.placeholder}
                  onChange={(e) => setF((x) => ({ ...x, [k.key]: e.target.value }))} />
              </Field>
            ))}
          </div>
          <Button loading={save.isPending} onClick={() => save.mutate()}>Lưu thông tin</Button>
        </>
      )}
    </Card>
  )
}

function Editor({ initial, site, onClose }: { initial: HelpAdminPage | null; site: SiteInfo; onClose: () => void }) {
  const qc = useQueryClient()
  const [f, setF] = useState<HelpInput>(() => (initial ? {
    slug: initial.slug, section: initial.section, title: initial.title, icon: initial.icon ?? '', summary: initial.summary ?? '', body: initial.body,
    version: initial.version, effective_at: initial.effective_at, sort: initial.sort, is_published: initial.is_published, needs_review: initial.needs_review,
  } : EMPTY))
  const [mode, setMode] = useState<'edit' | 'preview'>('edit')
  const [confirmDel, setConfirmDel] = useState(false)
  const set = <K extends keyof HelpInput>(k: K, v: HelpInput[K]) => setF((x) => ({ ...x, [k]: v }))
  const blocks = useMemo(() => (mode === 'preview' ? parseMarkdown(fillSiteInfo(f.body, site)) : []), [mode, f.body, site])
  const refresh = () => { void qc.invalidateQueries({ queryKey: KEY }); void qc.invalidateQueries({ queryKey: ['help'] }) }
  const save = useMutation({
    mutationFn: () => adminHelpSave({ ...f, slug: f.slug.trim().toLowerCase(), icon: f.icon || null, summary: f.summary || null }),
    onSuccess: () => { toast.success('Đã lưu trang'); refresh(); onClose() },
    onError: (e) => toast.error(helpErrorMessage(e)),
  })
  const del = useMutation({
    mutationFn: () => adminHelpDelete(initial!.slug),
    onSuccess: () => { toast.success('Đã xoá trang (nội dung cũ lưu trong nhật ký quản trị)'); refresh(); onClose() },
    onError: (e) => toast.error(helpErrorMessage(e)),
  })
  return (
    <div className="space-y-4 pb-48">
      <div className="flex items-center gap-2">
        <button type="button" onClick={onClose} className="-ml-1 inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-fg-muted hover:text-fg">
          <ArrowLeft className="size-4" aria-hidden />Danh sách trang
        </button>
        {initial && <Link href={`/help/${initial.slug}`} target="_blank" className="ml-auto inline-flex h-9 items-center gap-1 rounded-lg border border-border px-2.5 text-xs font-semibold"><Eye className="size-3.5" aria-hidden />Xem trang</Link>}
      </div>
      <Card className="space-y-4">
        <SegmentedControl value={f.section} onChange={(v: HelpSection) => set('section', v)}
          options={[{ value: 'GUIDE', label: 'Hướng dẫn' }, { value: 'POLICY', label: 'Chính sách' }, { value: 'SUPPORT', label: 'Hỗ trợ' }]} />
        <div className="grid grid-cols-[4.5rem_1fr] gap-3">
          <Field label="Biểu tượng" htmlFor="hp-icon"><Input id="hp-icon" value={f.icon ?? ''} maxLength={8} placeholder="🚀" onChange={(e) => set('icon', e.target.value)} /></Field>
          <Field label="Tiêu đề" htmlFor="hp-title"><Input id="hp-title" value={f.title} maxLength={120} onChange={(e) => set('title', e.target.value)} /></Field>
        </div>
        <Field label="Đường dẫn (/help/…)" htmlFor="hp-slug">
          <Input id="hp-slug" value={f.slug} maxLength={60} disabled={!!initial} placeholder="vd: quy-dinh-moi" onChange={(e) => set('slug', e.target.value)} />
        </Field>
        <Field label="Mô tả ngắn (hiện dưới tiêu đề trong danh sách)" htmlFor="hp-sum">
          <Input id="hp-sum" value={f.summary ?? ''} maxLength={200} onChange={(e) => set('summary', e.target.value)} />
        </Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Phiên bản" htmlFor="hp-ver"><Input id="hp-ver" value={f.version} maxLength={20} onChange={(e) => set('version', e.target.value)} /></Field>
          <Field label="Hiệu lực từ" htmlFor="hp-eff"><Input id="hp-eff" type="date" value={f.effective_at ?? ''} onChange={(e) => set('effective_at', e.target.value || null)} /></Field>
          <Field label="Thứ tự" htmlFor="hp-sort"><Input id="hp-sort" inputMode="numeric" value={String(f.sort)} onChange={(e) => set('sort', Number(e.target.value.replace(/\D/g, '')) || 0)} /></Field>
        </div>
        <SwitchRow checked={f.is_published} onChange={(v) => set('is_published', v)} label="Hiện trong menu" description="Tắt = chỉ admin xem được" />
        <SwitchRow checked={f.needs_review} onChange={(v) => set('needs_review', v)} label="Cần luật sư / admin rà" description="Đánh dấu bản nháp, chưa phải bản chính thức" />
      </Card>
      <Card className="space-y-3">
        <SegmentedControl value={mode} onChange={setMode} options={[{ value: 'edit', label: 'Soạn' }, { value: 'preview', label: 'Xem trước' }]} />
        {mode === 'edit' ? (
          <>
            <p className="text-xs text-fg-muted">Markdown: <code>## Tiêu đề</code>, <code>- danh sách</code>, <code>**đậm**</code>, <code>[chữ](/help/…)</code>, <code>&gt; ghi chú</code>. Thông tin pháp nhân: <code>{'{{support_email}}'}</code>…</p>
            <Textarea value={f.body} onChange={(e) => set('body', e.target.value)} rows={18} maxLength={60000} className="font-mono text-sm" aria-label="Nội dung trang" />
          </>
        ) : <div className={cn('min-h-40', !f.body && 'text-fg-subtle')}>{f.body ? <Markdown blocks={blocks} /> : 'Chưa có nội dung'}</div>}
      </Card>
      <div className="fixed inset-x-0 bottom-[calc(3.5rem+1px+env(safe-area-inset-bottom))] z-40 border-t border-border bg-bg/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-2xl gap-2">
          <Button loading={save.isPending} disabled={f.title.trim().length < 2 || !f.slug.trim()} onClick={() => save.mutate()}>Lưu trang</Button>
          <Button variant="secondary" onClick={onClose}>Huỷ</Button>
          {initial && <Button variant="ghost" className="ml-auto text-danger" aria-label="Xoá trang" onClick={() => setConfirmDel(true)}><Trash2 className="size-4" aria-hidden /></Button>}
        </div>
      </div>
      <ConfirmSheet open={confirmDel} onClose={() => setConfirmDel(false)} title="Xoá trang này?" confirmLabel="Xoá"
        description="Trang biến mất khỏi menu. Muốn tạm ẩn thì tắt “Hiện trong menu” thay vì xoá." onConfirm={() => del.mutate()} />
    </div>
  )
}
