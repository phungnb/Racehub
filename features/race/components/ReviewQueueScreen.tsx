'use client'

import Link from 'next/link'
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, ExternalLink, Flag, RefreshCw, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button, Card, EmptyState, ErrorState, Field, Input, SegmentedControl, Skeleton } from '@/shared/ui'
import { useOrganizer } from '../hooks/useOrganizer'
import {
  addSource, deleteSource, listCandidates, listSources, scanNow, setCandidateStatus, setSourceActive,
  type CandidateState, type RaceCandidate,
} from '../api/listingApi'
import { fmtDate } from './RaceCard'

const ERRORS: Record<string, string> = {
  NO_SEARCH_KEY: 'chưa đặt TAVILY_API_KEY trên máy chủ', SEARCH_LIMIT: 'hết lượt tìm kiếm trong tháng', SEARCH_FAILED: 'dịch vụ tìm kiếm lỗi',
  AI_KEY: 'ANTHROPIC_API_KEY sai hoặc hết tiền', AI_LIMIT: 'AI hết hạn mức / quá tải, thử lại sau', AI_FAILED: 'AI đọc trang lỗi',
  BAD_URL: 'không truy cập được trang (hoặc robots.txt chặn)', FETCH_FAILED: 'không tải được trang', NOT_HTML: 'không phải trang web',
}
const VIEWS: { value: CandidateState; label: string }[] = [
  { value: 'PENDING', label: 'Chờ duyệt' }, { value: 'FILTERED', label: 'Đã lọc bỏ' }, { value: 'REJECTED', label: 'Đã bỏ' },
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
              <button type="button" aria-label="Xóa nguồn" className="p-1.5 text-fg-muted hover:text-danger" onClick={() => { if (window.confirm('Xóa nguồn này và các giải đã tìm từ nguồn?')) del.mutate(s.id) }}><Trash2 className="size-4" aria-hidden /></button>
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
  const q = useQuery({ queryKey: ['race-candidates', view], queryFn: () => listCandidates(view) })
  const set = useMutation({
    mutationFn: (v: { id: string; status: CandidateState }) => setCandidateStatus(v.id, v.status),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['race-candidates'] }); void qc.invalidateQueries({ queryKey: ['race-pending'] }) },
    onError: () => toast.error('Không cập nhật được'),
  })
  return (
    <div className="space-y-3">
      <SegmentedControl value={view} onChange={setView} options={VIEWS} />
      {q.isPending ? <Skeleton className="h-32" /> : q.isError ? <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        : !q.data.length ? <EmptyState icon={Flag} title="Không có giải nào" description={view === 'PENDING' ? 'Thêm nguồn rồi bấm "Quét ngay", hoặc chờ lần quét thứ Hai.' : 'Trống.'} />
        : <ul className="space-y-3">{q.data.map((c) => <li key={c.id}><CandidateRow c={c} busy={set.isPending} onSet={(status) => set.mutate({ id: c.id, status })} /></li>)}</ul>}
    </div>
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
