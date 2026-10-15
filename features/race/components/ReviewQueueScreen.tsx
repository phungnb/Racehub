'use client'

import Link from 'next/link'
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, ExternalLink, Flag, RefreshCw, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button, Card, EmptyState, ErrorState, Field, Input, SegmentedControl, Sheet, Skeleton } from '@/shared/ui'
import { useOrganizer } from '../hooks/useOrganizer'
import {
  addSource, candidateToRow, deleteSource, listCandidates, listSources, scanNow, setCandidateStatus, setCandidatesStatus, setSourceActive, updateCandidate,
  type CandidateEdit, type CandidateState, type RaceCandidate, type RaceKind,
} from '../api/listingApi'
import { fmtDate } from './RaceCard'
import { RaceTable } from './RaceTable'

const ERRORS: Record<string, string> = {
  NO_SEARCH_KEY: 'chưa đặt TAVILY_API_KEY trên máy chủ', SEARCH_LIMIT: 'hết lượt tìm kiếm trong tháng', SEARCH_FAILED: 'dịch vụ tìm kiếm lỗi',
  AI_KEY: 'khoá AI (GEMINI_API_KEY / ANTHROPIC_API_KEY) sai hoặc hết tiền', AI_LIMIT: 'AI hết hạn mức / quá tải, thử lại sau', AI_FAILED: 'AI đọc trang lỗi',
  BAD_URL: 'không truy cập được trang (hoặc robots.txt chặn)', FETCH_FAILED: 'không tải được trang', NOT_HTML: 'không phải trang web',
}
const VIEWS: { value: CandidateState; label: string }[] = [
  { value: 'PENDING', label: 'Chờ duyệt' }, { value: 'APPROVED', label: 'Trong bảng' }, { value: 'FILTERED', label: 'Đã lọc bỏ' }, { value: 'REJECTED', label: 'Đã bỏ' },
]

/** Admin: khai báo nguồn quét, xem giải tự tìm được, duyệt (mở form chỉnh rồi đăng) hoặc bỏ. Không có gì tự đăng. */
export function ReviewQueueScreen() {
  const { isAdmin, isLoading } = useOrganizer()
  if (isLoading) return <Skeleton className="h-96" />
  if (!isAdmin) return <EmptyState icon={Flag} title="Chỉ admin" description="Hàng chờ duyệt giải dành cho admin." />
  return (
    <div className="space-y-5 pb-6">
      <Link href="/races" className="inline-flex items-center gap-1.5 text-sm text-fg-muted hover:text-fg"><ArrowLeft className="size-4" aria-hidden />Race</Link>
      <h1 className="text-2xl font-bold">Duyệt giải tự tìm</h1>
      <Sources />
      <Candidates />
    </div>
  )
}

function Sources() {
  const qc = useQueryClient()
  const [url, setUrl] = useState('')
  const [label, setLabel] = useState('')
  const [mode, setMode] = useState<'SEARCH' | 'PAGE'>('SEARCH')
  const q = useQuery({ queryKey: ['race-sources'], queryFn: listSources })
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['race-sources'] }); void qc.invalidateQueries({ queryKey: ['race-candidates'] }) }
  const add = useMutation({
    mutationFn: () => addSource({ kind: mode, value: url.trim(), label: label.trim() || null }),
    onSuccess: () => { setUrl(''); setLabel(''); refresh(); toast.success('Đã thêm nguồn') },
    onError: () => toast.error('Không thêm được (sai định dạng hoặc nguồn đã có).'),
  })
  const scan = useMutation({
    mutationFn: scanNow,
    onSuccess: (r) => { refresh(); toast.success(r.error ? `Quét lỗi: ${r.error}` : `Tìm thấy ${r.found} trang mới: ${r.pending} chờ duyệt, ${r.filtered} bị lọc`) },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Không quét được'),
  })
  const toggle = useMutation({ mutationFn: (v: { id: string; active: boolean }) => setSourceActive(v.id, v.active), onSuccess: refresh })
  const del = useMutation({ mutationFn: deleteSource, onSuccess: refresh })
  return (
    <Card className="space-y-3">
      <p className="text-sm font-semibold">Nguồn quét</p>
      <p className="text-xs text-fg-muted">Hai cách: tìm bằng từ khóa (như gõ Google) hoặc quét một trang lịch giải. Hệ thống quét mỗi thứ Hai và chỉ đưa vào hàng chờ, tôn trọng robots.txt của trang nguồn.</p>
      {q.isPending ? <Skeleton className="h-16" /> : q.isError ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : (
        <ul className="space-y-2">
          {q.data.map((s) => (
            <li key={s.id} className="flex items-center gap-2 rounded-xl border border-border p-2.5 text-sm">
              <input type="checkbox" className="size-5 shrink-0 accent-[var(--color-brand)]" checked={s.active} onChange={(e) => toggle.mutate({ id: s.id, active: e.target.checked })} aria-label="Bật quét nguồn này" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{s.label || (s.kind === 'SEARCH' ? `Tìm: ${s.query}` : s.url)}</span>
                <span className="block truncate text-xs text-fg-muted">{s.last_error ? `Lỗi lần quét cuối: ${ERRORS[s.last_error] ?? s.last_error}` : s.last_scanned_at ? `Quét lần cuối ${fmtDate(s.last_scanned_at)}` : 'Chưa quét'}</span>
              </span>
              <Button size="sm" variant="secondary" disabled={scan.isPending} onClick={() => scan.mutate(s.id)}><RefreshCw className="size-4" aria-hidden />{scan.isPending && scan.variables === s.id ? 'Đang quét…' : 'Quét ngay'}</Button>
              <button type="button" aria-label="Xóa nguồn" className="p-1.5 text-fg-muted hover:text-danger" onClick={() => { if (window.confirm('Xóa nguồn này? Giải đã đưa vào bảng vẫn được giữ; giải chưa duyệt của nguồn sẽ bị xóa.')) del.mutate(s.id) }}><Trash2 className="size-4" aria-hidden /></button>
            </li>
          ))}
          {!q.data.length && <li className="text-sm text-fg-muted">Chưa có nguồn nào.</li>}
        </ul>
      )}
      <Field label="Thêm nguồn" htmlFor="s-url">
        <div className="space-y-2">
          <SegmentedControl value={mode} onChange={setMode} options={[{ value: 'SEARCH', label: 'Tìm bằng từ khóa' }, { value: 'PAGE', label: 'Trang lịch giải' }]} />
          <Input id="s-url" value={url} onChange={(e) => setUrl(e.target.value)} inputMode={mode === 'PAGE' ? 'url' : 'text'}
            placeholder={mode === 'SEARCH' ? 'VD: lịch giải chạy marathon 2027 Việt Nam' : 'https://… (trang lịch giải)'} />
          <div className="flex gap-2">
            <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Tên gọi (không bắt buộc)" maxLength={80} aria-label="Tên nguồn" />
            <Button type="button" className="shrink-0" disabled={(mode === 'PAGE' ? !/^https?:\/\/\S+$/i.test(url.trim()) : url.trim().length < 3) || add.isPending} onClick={() => add.mutate()}>Thêm</Button>
          </div>
        </div>
      </Field>
    </Card>
  )
}

function Candidates() {
  const qc = useQueryClient()
  const [view, setView] = useState<CandidateState>('PENDING')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [editing, setEditing] = useState<RaceCandidate | null>(null)
  const q = useQuery({ queryKey: ['race-candidates', view], queryFn: () => listCandidates(view) })
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['race-candidates'] }); void qc.invalidateQueries({ queryKey: ['race-pending'] }); void qc.invalidateQueries({ queryKey: ['race-calendar'] }) }
  const set = useMutation({
    mutationFn: (v: { id: string; status: CandidateState }) => setCandidateStatus(v.id, v.status),
    onSuccess: refresh,
    onError: () => toast.error('Không cập nhật được'),
  })
  const bulk = useMutation({
    mutationFn: (v: { ids: string[]; status: CandidateState }) => setCandidatesStatus(v.ids, v.status),
    onSuccess: (_r, v) => {
      setPicked(new Set()); refresh()
      toast.success(v.status === 'APPROVED' ? `Đã đưa ${v.ids.length} giải vào bảng` : v.status === 'REJECTED' ? `Đã bỏ ${v.ids.length} giải` : `Đã đưa ${v.ids.length} giải về chờ duyệt`)
    },
    onError: () => toast.error('Không cập nhật được'),
  })
  const rows = q.data ?? []
  const ids = rows.filter((r) => picked.has(r.id)).map((r) => r.id)
  const tableView = view === 'PENDING' || view === 'APPROVED'
  const sel = {
    picked,
    onToggle: (id: string) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n }),
    onToggleAll: (all: string[], on: boolean) => setPicked((p) => { const n = new Set(p); for (const id of all) { if (on) n.add(id); else n.delete(id) } return n }),
  }
  return (
    <div className="space-y-3">
      <SegmentedControl value={view} onChange={(v) => { setView(v); setPicked(new Set()) }} options={VIEWS} />
      {q.isPending ? <Skeleton className="h-32" /> : q.isError ? <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        : !rows.length ? <EmptyState icon={Flag} title="Không có giải nào" description={view === 'PENDING' ? 'Thêm nguồn rồi bấm "Quét ngay", hoặc chờ lần quét thứ Hai.' : 'Trống.'} />
        : tableView ? (
          <>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <label className="flex min-h-11 items-center gap-2 font-semibold">
                <input type="checkbox" className="size-5" checked={ids.length === rows.length} onChange={(e) => sel.onToggleAll(rows.map((r) => r.id), e.target.checked)} />
                Chọn tất cả ({rows.length})
              </label>
              {ids.length > 0 && view === 'PENDING' && (
                <>
                  <Button size="sm" loading={bulk.isPending} onClick={() => bulk.mutate({ ids, status: 'APPROVED' })}>Đưa {ids.length} giải vào bảng</Button>
                  <Button size="sm" variant="secondary" disabled={bulk.isPending} onClick={() => bulk.mutate({ ids, status: 'REJECTED' })}>Bỏ {ids.length}</Button>
                </>
              )}
              {ids.length > 0 && view === 'APPROVED' && <Button size="sm" variant="secondary" loading={bulk.isPending} onClick={() => bulk.mutate({ ids, status: 'PENDING' })}>Gỡ {ids.length} giải khỏi bảng</Button>}
            </div>
            <RaceTable rows={rows.map(candidateToRow)} sel={sel} editHref={(id) => `/races/listing/new?candidate=${id}`} onEdit={(id) => setEditing(rows.find((r) => r.id === id) ?? null)} />
          </>
        )
        : <ul className="space-y-3">{rows.map((c) => <li key={c.id}><CandidateRow c={c} busy={set.isPending} onSet={(status) => set.mutate({ id: c.id, status })} /></li>)}</ul>}
      {editing && <EditRow key={editing.id} c={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); refresh() }} />}
    </div>
  )
}

const isHttp = (v: string) => v.trim() === '' || /^https?:\/\/\S+$/i.test(v.trim())

/** Admin sửa một dòng của bảng: nhất là link mua bib / đăng ký do trang nguồn thường ghi sai hoặc thiếu. */
function EditRow({ c, onClose, onSaved }: { c: RaceCandidate; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState<CandidateEdit>({
    title: c.title, kind: c.kind, location: c.location ?? '', race_date: c.race_date ?? '', end_date: c.end_date ?? '',
    reg_deadline: c.reg_deadline ?? '', race_url: c.race_url ?? c.url.split('#')[0], reg_url: c.reg_url ?? '',
  })
  const set = <K extends keyof CandidateEdit>(k: K, v: CandidateEdit[K]) => setF((x) => ({ ...x, [k]: v }))
  const save = useMutation({ mutationFn: () => updateCandidate(c.id, f), onSuccess: () => { toast.success('Đã lưu'); onSaved() }, onError: () => toast.error('Không lưu được (kiểm tra lại link và ngày).') })
  const bad = f.title.trim().length < 3 || !isHttp(f.race_url) || !isHttp(f.reg_url) || (f.end_date !== '' && f.race_date !== '' && f.end_date < f.race_date)
  return (
    <Sheet open onClose={onClose} title="Sửa giải trong bảng" description="Link mua bib / đăng ký để trống nếu chưa có."
      footer={<Button block loading={save.isPending} disabled={bad} onClick={() => save.mutate()}>Lưu</Button>}>
      <div className="space-y-3">
        <Field label="Tên giải" htmlFor="e-title"><Input id="e-title" value={f.title} maxLength={200} onChange={(e) => set('title', e.target.value)} /></Field>
        <Field label="Loại giải" htmlFor="e-kind">
          <select id="e-kind" value={f.kind} onChange={(e) => set('kind', e.target.value as RaceKind)} className="h-11 w-full rounded-xl border border-border bg-bg px-3 text-[15px]">
            <option value="OFFLINE">Offline (chạy trực tiếp)</option><option value="ONLINE">Online (chạy ảo)</option>
          </select>
        </Field>
        <Field label="Địa điểm" htmlFor="e-loc"><Input id="e-loc" value={f.location} maxLength={200} onChange={(e) => set('location', e.target.value)} /></Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Ngày chạy" htmlFor="e-date"><Input id="e-date" type="date" value={f.race_date} onChange={(e) => set('race_date', e.target.value)} /></Field>
          <Field label="Đến ngày" htmlFor="e-end"><Input id="e-end" type="date" value={f.end_date} onChange={(e) => set('end_date', e.target.value)} /></Field>
        </div>
        <Field label="Hạn đăng ký" htmlFor="e-dl"><Input id="e-dl" type="date" value={f.reg_deadline} onChange={(e) => set('reg_deadline', e.target.value)} /></Field>
        <Field label="Link giải" htmlFor="e-url" error={isHttp(f.race_url) ? undefined : 'Link phải bắt đầu bằng http(s)://'}>
          <Input id="e-url" inputMode="url" value={f.race_url} onChange={(e) => set('race_url', e.target.value)} />
        </Field>
        <Field label="Link mua bib (đăng ký)" htmlFor="e-reg" error={isHttp(f.reg_url) ? undefined : 'Link phải bắt đầu bằng http(s)://'}>
          <Input id="e-reg" inputMode="url" value={f.reg_url} onChange={(e) => set('reg_url', e.target.value)} />
        </Field>
      </div>
    </Sheet>
  )
}

function CandidateRow({ c, busy, onSet }: { c: RaceCandidate; busy: boolean; onSet: (s: CandidateState) => void }) {
  return (
    <Card className="space-y-2">
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-bold leading-tight">{c.title || '(không có tên)'}</h3>
        {c.status === 'PENDING' && <span className="shrink-0 rounded-full bg-brand/15 px-2 py-0.5 text-xs font-semibold text-brand">{c.score} điểm</span>}
      </div>
      <p className="text-xs text-fg-muted">
        {[c.race_date ? fmtDate(c.race_date) : 'Chưa rõ ngày', c.location, c.distances.join(' · ')].filter(Boolean).join(' · ')}
        {c.filter_reason ? ` — Lý do lọc: ${c.filter_reason}` : ''}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {c.status !== 'APPROVED' && <Link href={`/races/listing/new?candidate=${c.id}`}><Button size="sm">Duyệt & chỉnh</Button></Link>}
        {c.status === 'PENDING' && <Button size="sm" variant="secondary" disabled={busy} onClick={() => onSet('REJECTED')}>Bỏ</Button>}
        {c.status === 'REJECTED' && <Button size="sm" variant="secondary" disabled={busy} onClick={() => onSet('PENDING')}>Khôi phục</Button>}
        <a href={c.url} target="_blank" rel="noopener noreferrer nofollow" className="ml-auto inline-flex items-center gap-1 text-xs text-fg-muted hover:text-fg">Mở trang<ExternalLink className="size-3.5" aria-hidden /></a>
      </div>
    </Card>
  )
}
