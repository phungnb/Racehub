'use client'

import { useState } from 'react'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BadgeCheck, BarChart3, FileText, PenSquare, Plus, Search, ShieldCheck, UserPlus, Users } from 'lucide-react'
import { toast } from 'sonner'
import { Avatar, BarChart, Button, Card, EmptyState, ErrorState, Field, Input, SegmentedControl, Sheet, Skeleton, StatTile, SwitchRow, Textarea } from '@/shared/ui'
import { cn } from '@/shared/lib/cn'
import { supabase } from '@/shared/lib/supabase'
import {
  cmsList, cmsMeta, cmsSaveAuthor, cmsSetStaff, cmsStats, knowledgeErrorMessage, uploadContentImage,
  type ArticleStatus, type CmsAuthor, type CmsMeta, type CmsRow,
} from '../../api/knowledgeApi'
import { AUTHOR_KIND, formatDate, ROLE_LABEL, STATUS_LABEL, STATUS_TONE } from '../../model/knowledge'
import { ArticleEditor } from './ArticleEditor'

type Tab = 'articles' | 'stats' | 'people'

/** CMS RaceHub Knowledge: dùng trong Quản trị (tab Nội dung) và ở /learn/studio cho ban nội dung không phải admin */
export function CmsScreen() {
  const meta = useQuery({ queryKey: ['cms', 'meta'], queryFn: cmsMeta })
  const [tab, setTab] = useState<Tab>('articles')
  const [editing, setEditing] = useState<string | 'new' | null>(null)
  if (meta.isPending) return <div className="space-y-3"><Skeleton className="h-12" /><Skeleton className="h-64" /></div>
  if (meta.isError) return <ErrorState message={knowledgeErrorMessage(meta.error)} error={meta.error} onRetry={() => void meta.refetch()} />
  const m = meta.data
  if (editing) return <ArticleEditor id={editing === 'new' ? null : editing} meta={m} onClose={() => setEditing(null)} />
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <p className="min-w-0 flex-1 text-sm text-fg-muted">Vai trò của bạn: <b className="text-fg">{ROLE_LABEL[m.role]}</b></p>
        <Button size="sm" onClick={() => setEditing('new')}><Plus className="size-4" aria-hidden />Bài mới</Button>
      </div>
      <SegmentedControl value={tab} onChange={setTab} options={[
        { value: 'articles', label: 'Bài viết' }, { value: 'stats', label: 'Thống kê' }, { value: 'people', label: 'Tác giả & ban' },
      ]} />
      {tab === 'articles' && <Articles meta={m} onOpen={setEditing} />}
      {tab === 'stats' && <Stats onOpen={setEditing} />}
      {tab === 'people' && <People meta={m} />}
    </div>
  )
}

const FILTERS: { value: string; label: string; count?: (m: CmsMeta) => number | undefined }[] = [
  { value: 'ALL', label: 'Tất cả' },
  { value: 'REVIEW', label: 'Chờ duyệt', count: (m) => m.counts?.REVIEW },
  { value: 'EXPERT', label: 'Cần chuyên gia' },
  { value: 'DRAFT', label: 'Nháp', count: (m) => m.counts?.DRAFT },
  { value: 'SCHEDULED', label: 'Hẹn giờ', count: (m) => m.counts?.SCHEDULED },
  { value: 'PUBLISHED', label: 'Đã đăng', count: (m) => m.counts?.PUBLISHED },
  { value: 'ARCHIVED', label: 'Lưu trữ' },
]

function Articles({ meta, onOpen }: { meta: CmsMeta; onOpen: (id: string) => void }) {
  const [status, setStatus] = useState(meta.role === 'EXPERT' ? 'EXPERT' : meta.counts?.REVIEW ? 'REVIEW' : 'ALL')
  const [q, setQ] = useState('')
  const [mine, setMine] = useState(meta.role === 'WRITER')
  const list = useInfiniteQuery({
    queryKey: ['cms', 'list', status, q, mine],
    queryFn: ({ pageParam }) => cmsList({ status, q, mine }, pageParam),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => (pages.length * 30 < last.total ? pages.length * 30 : undefined),
  })
  const rows = list.data?.pages.flatMap((p) => p.items) ?? []
  const catName = (id: string) => meta.categories.find((c) => c.id === id)?.name ?? id
  return (
    <div className="space-y-3">
      <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
        {FILTERS.map((f) => {
          const n = f.count?.(meta)
          return (
            <button key={f.value} type="button" aria-pressed={status === f.value} onClick={() => setStatus(f.value)}
              className={cn('shrink-0 rounded-full border px-3 py-1.5 text-sm font-semibold', status === f.value ? 'border-brand bg-brand text-brand-fg' : 'border-border text-fg-muted')}>
              {f.label}{n ? ` · ${n}` : ''}
            </button>
          )
        })}
      </div>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-subtle" aria-hidden />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm tiêu đề…" aria-label="Tìm bài" className="pl-9" />
        </div>
        <Button variant={mine ? 'primary' : 'secondary'} aria-pressed={mine} onClick={() => setMine((v) => !v)}>Bài của tôi</Button>
      </div>
      {list.isPending ? <div className="space-y-2"><Skeleton className="h-20" /><Skeleton className="h-20" /></div>
        : list.isError ? <ErrorState message={knowledgeErrorMessage(list.error)} error={list.error} onRetry={() => void list.refetch()} />
        : rows.length === 0 ? <EmptyState icon={FileText} title="Không có bài" description="Đổi bộ lọc hoặc tạo bài mới." />
        : (
          <ul className="space-y-2">
            {rows.map((r) => <li key={r.id}><Row r={r} cat={catName(r.category_id)} onOpen={() => onOpen(r.id)} /></li>)}
          </ul>
        )}
      {list.hasNextPage && <Button block variant="secondary" loading={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>Xem thêm</Button>}
    </div>
  )
}

function Row({ r, cat, onOpen }: { r: CmsRow; cat: string; onOpen: () => void }) {
  const waitExpert = r.needs_expert_review && !r.expert_reviewed_at
  return (
    <button type="button" onClick={onOpen} className="w-full rounded-[var(--radius-card)] border border-border bg-surface p-3 text-left hover:border-fg-subtle">
      <div className="flex items-start gap-2">
        <p className="min-w-0 flex-1 font-semibold leading-snug">{r.content_type === 'NEWS' && '📰 '}{r.title}</p>
        <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold', STATUS_TONE[r.status as ArticleStatus])}>{STATUS_LABEL[r.status as ArticleStatus]}</span>
      </div>
      <p className="mt-1 text-xs text-fg-muted">
        {cat} · {r.author_name ?? r.created_by_name ?? '—'} · {r.status === 'SCHEDULED' ? `đăng ${formatDate(r.published_at)}` : `sửa ${formatDate(r.updated_at)}`}
        {r.is_featured && ' · ⭐ nổi bật'}
      </p>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
        {waitExpert && <span className="inline-flex items-center gap-1 font-semibold text-warning"><ShieldCheck className="size-3" aria-hidden />Chờ duyệt chuyên môn</span>}
        {r.needs_expert_review && r.expert_reviewed_at && <span className="inline-flex items-center gap-1 text-brand"><ShieldCheck className="size-3" aria-hidden />Đã duyệt chuyên môn</span>}
        {r.review_note && <span className="text-warning">{r.review_note.slice(0, 60)}</span>}
        {r.live && <span className="text-fg-subtle">{r.views} xem · {r.reads} đọc xong · {r.saves} lưu · {r.cta_clicks} bấm hành động · 👍 {r.helpful_yes}</span>}
      </div>
    </button>
  )
}

function Stats({ onOpen }: { onOpen: (id: string) => void }) {
  const [days, setDays] = useState('30')
  const q = useQuery({ queryKey: ['cms', 'stats', days], queryFn: () => cmsStats(Number(days)) })
  if (q.isPending) return <Skeleton className="h-64" />
  if (q.isError) return <ErrorState message={knowledgeErrorMessage(q.error)} error={q.error} onRetry={() => void q.refetch()} />
  const s = q.data
  const n = (v: number | string) => Number(v).toLocaleString('vi-VN')
  return (
    <div className="space-y-3">
      <SegmentedControl value={days} onChange={setDays} options={[{ value: '7', label: '7 ngày' }, { value: '30', label: '30 ngày' }, { value: '90', label: '90 ngày' }]} />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatTile label="Lượt xem" value={n(s.totals.views)} />
        <StatTile label="Đọc xong" value={n(s.totals.reads)} tone="brand" />
        <StatTile label="Người đọc" value={n(s.readers)} />
        <StatTile label="TB thời gian đọc" value={`${Math.round(s.avg_read_seconds / 60 * 10) / 10}`} unit="phút" />
        <StatTile label="Lưu bài" value={n(s.saves)} tone="coin" />
        <StatTile label="Chia sẻ" value={n(s.totals.shares)} />
        <StatTile label="Bấm hành động" value={n(s.totals.cta_clicks)} tone="xp" />
        <StatTile label="Bài đang hiện" value={n(s.published)} />
      </div>
      <Card>
        <BarChart caption="Lượt xem và đọc xong theo ngày" labels={s.days.map((d) => d.day.slice(8, 10) + '/' + d.day.slice(5, 7))}
          series={[{ name: 'Lượt xem', values: s.days.map((d) => Number(d.views)) }, { name: 'Đọc xong', values: s.days.map((d) => Number(d.reads)) }]}
          tickEvery={Math.ceil(s.days.length / 7)} />
      </Card>
      <Card className="space-y-1">
        <p className="mb-1 flex items-center gap-1.5 font-semibold"><BarChart3 className="size-4 text-brand" aria-hidden />Bài được đọc nhiều</p>
        {s.top.length === 0 && <p className="text-sm text-fg-muted">Chưa có dữ liệu.</p>}
        {s.top.map((t, i) => (
          <button key={t.id} type="button" onClick={() => onOpen(t.id)} className="flex w-full items-center gap-2 rounded-lg px-1 py-2 text-left hover:bg-surface-2">
            <span className="w-5 font-mono text-xs text-fg-subtle">{i + 1}</span>
            <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{t.title}</span>
              <span className="block text-[11px] text-fg-muted">{n(t.views)} xem · đọc xong {t.read_rate}% · chuyển sang tính năng {t.cta_rate}% · {n(t.shares)} chia sẻ</span></span>
          </button>
        ))}
      </Card>
    </div>
  )
}

function People({ meta }: { meta: CmsMeta }) {
  const [author, setAuthor] = useState<Partial<CmsAuthor> | null>(null)
  const [staffOpen, setStaffOpen] = useState(false)
  const canAuthor = meta.role === 'ADMIN' || meta.role === 'EDITOR'
  return (
    <div className="space-y-4">
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">Tác giả</h3>
          {canAuthor && <Button size="sm" variant="secondary" onClick={() => setAuthor({ kind: 'COACH', verified: false })}><Plus className="size-4" aria-hidden />Thêm tác giả</Button>}
        </div>
        <p className="text-xs text-fg-muted">Admin, biên tập viên, HLV cộng tác, chuyên gia đã xác minh. Gắn hồ sơ Chợ Runner để người đọc xem dịch vụ của HLV.</p>
        {meta.authors.map((a) => (
          <button key={a.id} type="button" disabled={!canAuthor} onClick={() => setAuthor(a)}
            className="flex w-full items-center gap-3 rounded-xl border border-border p-3 text-left enabled:hover:border-fg-subtle">
            <Avatar src={a.avatar_url} name={a.name} />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1 font-semibold">{a.name}{a.verified && <BadgeCheck className="size-4 text-brand" aria-label="Đã xác minh" />}</span>
              <span className="block text-xs text-fg-muted">{a.title ?? AUTHOR_KIND[a.kind as keyof typeof AUTHOR_KIND]}{a.user_name ? ` · tài khoản ${a.user_name}` : ''}</span>
            </span>
          </button>
        ))}
      </section>
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">Ban nội dung</h3>
          {meta.role === 'ADMIN' && <Button size="sm" variant="secondary" onClick={() => setStaffOpen(true)}><UserPlus className="size-4" aria-hidden />Thêm người</Button>}
        </div>
        <p className="text-xs text-fg-muted">Biên tập viên: duyệt & đăng. Cộng tác viết: soạn nháp, gửi duyệt. Chuyên gia: duyệt chuyên môn bài sức khoẻ / giáo án. Admin luôn toàn quyền.</p>
        {meta.staff.length === 0 && <EmptyState icon={Users} title="Chưa có ai" description="Hiện chỉ admin soạn và đăng bài." />}
        {meta.staff.map((s) => <StaffRow key={s.user_id} s={s} admin={meta.role === 'ADMIN'} />)}
      </section>
      {author && <AuthorSheet a={author} onClose={() => setAuthor(null)} />}
      {staffOpen && <StaffSheet onClose={() => setStaffOpen(false)} />}
    </div>
  )
}

function useRefreshMeta() {
  const qc = useQueryClient()
  return () => void qc.invalidateQueries({ queryKey: ['cms', 'meta'] })
}

function StaffRow({ s, admin }: { s: CmsMeta['staff'][number]; admin: boolean }) {
  const refresh = useRefreshMeta()
  const set = useMutation({ mutationFn: (role: string | null) => cmsSetStaff(s.user_id, role), onSuccess: refresh, onError: (e) => toast.error(knowledgeErrorMessage(e)) })
  return (
    <div className="flex items-center gap-2 rounded-xl border border-border px-3 py-2">
      <Avatar name={s.name} size="sm" />
      <p className="min-w-0 flex-1 truncate text-sm font-semibold">{s.name}</p>
      {admin ? (
        <select value={s.role} aria-label={`Vai trò của ${s.name}`} disabled={set.isPending} onChange={(e) => set.mutate(e.target.value || null)}
          className="h-9 rounded-lg border border-border bg-bg px-2 text-xs">
          <option value="EDITOR">{ROLE_LABEL.EDITOR}</option><option value="WRITER">{ROLE_LABEL.WRITER}</option><option value="EXPERT">{ROLE_LABEL.EXPERT}</option>
          <option value="">Gỡ khỏi ban</option>
        </select>
      ) : <span className="text-xs text-fg-muted">{ROLE_LABEL[s.role]}</span>}
    </div>
  )
}

function StaffSheet({ onClose }: { onClose: () => void }) {
  const refresh = useRefreshMeta()
  const [q, setQ] = useState('')
  const [role, setRole] = useState<'EDITOR' | 'WRITER' | 'EXPERT'>('WRITER')
  const found = useQuery({
    queryKey: ['cms', 'user-search', q], enabled: q.trim().length >= 2,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('admin_search_accounts', { p_query: q })
      if (error) throw error
      return ((data ?? []) as { kind: string; id: string; name: string; subtitle: string }[]).filter((x) => x.kind === 'USER').slice(0, 8)
    },
  })
  const add = useMutation({ mutationFn: (id: string) => cmsSetStaff(id, role), onSuccess: () => { toast.success('Đã thêm vào ban nội dung'); refresh(); onClose() }, onError: (e) => toast.error(knowledgeErrorMessage(e)) })
  return (
    <Sheet open onClose={onClose} title="Thêm người vào ban nội dung">
      <div className="space-y-3">
        <SegmentedControl value={role} onChange={setRole} options={[{ value: 'WRITER', label: 'Viết' }, { value: 'EDITOR', label: 'Biên tập' }, { value: 'EXPERT', label: 'Chuyên gia' }]} />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm theo tên hoặc email" aria-label="Tìm người dùng" />
        {(found.data ?? []).map((u) => (
          <button key={u.id} type="button" disabled={add.isPending} onClick={() => add.mutate(u.id)} className="flex w-full items-center gap-3 rounded-xl border border-border p-2.5 text-left hover:border-fg-subtle">
            <Avatar name={u.name} size="sm" /><span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{u.name}</span><span className="block truncate text-xs text-fg-muted">{u.subtitle}</span></span>
            <PenSquare className="size-4 text-fg-subtle" aria-hidden />
          </button>
        ))}
      </div>
    </Sheet>
  )
}

function AuthorSheet({ a, onClose }: { a: Partial<CmsAuthor>; onClose: () => void }) {
  const refresh = useRefreshMeta()
  const [f, setF] = useState(a)
  const save = useMutation({
    mutationFn: () => cmsSaveAuthor({ ...f, name: f.name ?? '' }),
    onSuccess: () => { toast.success('Đã lưu tác giả'); refresh(); onClose() },
    onError: (e) => toast.error(knowledgeErrorMessage(e)),
  })
  const upload = async (file: File) => {
    try { setF((x) => ({ ...x, avatar_url: null })); const url = await uploadContentImage(file); setF((x) => ({ ...x, avatar_url: url })) } catch (e) { toast.error(knowledgeErrorMessage(e)) }
  }
  return (
    <Sheet open onClose={onClose} title={a.id ? 'Sửa tác giả' : 'Tác giả mới'} footer={<Button block loading={save.isPending} disabled={(f.name ?? '').trim().length < 2} onClick={() => save.mutate()}>Lưu</Button>}>
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <Avatar src={f.avatar_url} name={f.name ?? '?'} size="lg" />
          <label className="cursor-pointer text-sm font-semibold text-brand">Đổi ảnh<input type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => { const x = e.target.files?.[0]; if (x) void upload(x) }} /></label>
        </div>
        <Field label="Tên" htmlFor="au-name"><Input id="au-name" value={f.name ?? ''} maxLength={80} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Chức danh" htmlFor="au-title"><Input id="au-title" value={f.title ?? ''} maxLength={80} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="HLV marathon, chuyên gia dinh dưỡng…" /></Field>
        <Field label="Loại" htmlFor="au-kind">
          <select id="au-kind" value={f.kind ?? 'COACH'} onChange={(e) => setF({ ...f, kind: e.target.value })} className="h-11 w-full rounded-xl border border-border bg-bg px-3 text-[15px]">
            {Object.entries(AUTHOR_KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
        <Field label="Giới thiệu" htmlFor="au-bio"><Textarea id="au-bio" rows={3} maxLength={600} value={f.bio ?? ''} onChange={(e) => setF({ ...f, bio: e.target.value })} /></Field>
        <Field label="Mã hồ sơ Chợ Runner (tuỳ chọn)" htmlFor="au-partner" hint="Người đọc bấm “Xem hồ sơ & dịch vụ” ở cuối bài">
          <Input id="au-partner" value={f.partner_id ?? ''} onChange={(e) => setF({ ...f, partner_id: e.target.value.trim() || null })} placeholder="uuid hồ sơ đối tác" />
        </Field>
        <SwitchRow checked={!!f.verified} onChange={(v) => setF({ ...f, verified: v })} label="Đã xác minh" description="Hiện dấu xác minh cạnh tên tác giả" />
      </div>
    </Sheet>
  )
}
