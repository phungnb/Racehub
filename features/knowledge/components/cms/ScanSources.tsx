'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { RefreshCw, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button, Card, ErrorState, Field, Input, SegmentedControl, Skeleton } from '@/shared/ui'
import { addScanSource, deleteScanSource, listScanSources, scanKnowledgeNow, setScanSourceActive, setScanSourceMode, type CmsMeta } from '../../api/knowledgeApi'
import { formatDate } from '../../model/knowledge'

const ERRORS: Record<string, string> = {
  NO_SEARCH_KEY: 'chưa đặt TAVILY_API_KEY', SEARCH_LIMIT: 'hết lượt tìm kiếm trong tháng', SEARCH_FAILED: 'dịch vụ tìm kiếm lỗi',
  AI_KEY: 'chưa đặt hoặc sai khoá AI (GEMINI_API_KEY)', AI_LIMIT: 'AI hết hạn mức, thử lại sau', AI_FAILED: 'AI đọc trang lỗi',
  BAD_URL: 'không truy cập được trang (hoặc robots.txt chặn)', FETCH_FAILED: 'không tải được trang', NOT_HTML: 'không phải trang web',
}

/** Admin: nguồn tự tìm tin kiến thức. Tin tìm được vào tab «Chờ duyệt» dưới dạng tóm tắt + link nguồn; không tự đăng. */
export function ScanSources({ meta }: { meta: CmsMeta }) {
  const qc = useQueryClient()
  const [mode, setMode] = useState<'SEARCH' | 'PAGE'>('SEARCH')
  const [value, setValue] = useState('')
  const [label, setLabel] = useState('')
  const [cat, setCat] = useState('')
  const [saveAs, setSaveAs] = useState<'SUMMARY' | 'FULL'>('FULL')
  const q = useQuery({ queryKey: ['knowledge-scan-sources'], queryFn: listScanSources })
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['knowledge-scan-sources'] }); void qc.invalidateQueries({ queryKey: ['cms'] }) }
  const add = useMutation({
    mutationFn: () => addScanSource({ kind: mode, value: value.trim(), label: label.trim() || null, category_id: cat || null, scan_mode: saveAs }),
    onSuccess: () => { setValue(''); setLabel(''); refresh(); toast.success('Đã thêm nguồn') },
    onError: () => toast.error('Không thêm được (sai định dạng hoặc nguồn đã có).'),
  })
  const scan = useMutation({
    mutationFn: scanKnowledgeNow,
    onSuccess: (r) => { refresh(); toast.success(r.error ? `Quét lỗi: ${ERRORS[r.error] ?? r.error}` : `Tìm thấy ${r.found} tin mới, đã vào tab Chờ duyệt`) },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Không quét được'),
  })
  const toggle = useMutation({ mutationFn: (v: { id: string; active: boolean }) => setScanSourceActive(v.id, v.active), onSuccess: refresh })
  const mode2 = useMutation({ mutationFn: (v: { id: string; m: 'SUMMARY' | 'FULL' }) => setScanSourceMode(v.id, v.m), onSuccess: refresh })
  const del = useMutation({ mutationFn: deleteScanSource, onSuccess: refresh })
  return (
    <Card className="space-y-3">
      <p className="text-sm font-semibold">Tự tìm tin kiến thức</p>
      <p className="text-xs text-fg-muted">Tìm bằng từ khóa hoặc đọc một trang chuyên mục. AI viết tóm tắt (hoặc bài đầy đủ nếu bạn chọn) kèm link bài gốc; mỗi tin vào tab «Chờ duyệt» để biên tập kiểm tra rồi mới đăng. Hệ thống quét mỗi thứ Hai.</p>
      {q.isPending ? <Skeleton className="h-16" /> : q.isError ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : (
        <ul className="space-y-2">
          {q.data.map((s) => (
            <li key={s.id} className="flex items-center gap-2 rounded-xl border border-border p-2.5 text-sm">
              <input type="checkbox" className="size-5 shrink-0 accent-[var(--color-brand)]" checked={s.active} onChange={(e) => toggle.mutate({ id: s.id, active: e.target.checked })} aria-label="Bật quét nguồn này" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{s.label || (s.kind === 'SEARCH' ? `Tìm: ${s.query}` : s.url)}</span>
                <select value={s.scan_mode} onChange={(e) => mode2.mutate({ id: s.id, m: e.target.value as 'SUMMARY' | 'FULL' })} aria-label="Dạng lưu của nguồn"
                  className="my-0.5 h-8 rounded-lg border border-border bg-surface px-2 text-xs">
                  <option value="FULL">Bài đầy đủ</option><option value="SUMMARY">Tóm tắt + link</option>
                </select>
                <span className="block truncate text-xs text-fg-muted">{s.last_error ? `Lỗi lần quét cuối: ${ERRORS[s.last_error] ?? s.last_error}` : s.last_scanned_at ? `Quét lần cuối ${formatDate(s.last_scanned_at)}` : 'Chưa quét'}</span>
              </span>
              <Button size="sm" variant="secondary" disabled={scan.isPending} onClick={() => scan.mutate(s.id)}><RefreshCw className="size-4" aria-hidden />{scan.isPending && scan.variables === s.id ? 'Đang quét…' : 'Quét ngay'}</Button>
              <button type="button" aria-label="Xóa nguồn" className="p-1.5 text-fg-muted hover:text-danger" onClick={() => { if (window.confirm('Xóa nguồn này?')) del.mutate(s.id) }}><Trash2 className="size-4" aria-hidden /></button>
            </li>
          ))}
          {!q.data.length && <li className="text-sm text-fg-muted">Chưa có nguồn nào.</li>}
        </ul>
      )}
      <Field label="Thêm nguồn" htmlFor="ks-url">
        <div className="space-y-2">
          <SegmentedControl value={mode} onChange={setMode} options={[{ value: 'SEARCH', label: 'Tìm bằng từ khóa' }, { value: 'PAGE', label: 'Trang chuyên mục' }]} />
          <Input id="ks-url" value={value} onChange={(e) => setValue(e.target.value)} inputMode={mode === 'PAGE' ? 'url' : 'text'}
            placeholder={mode === 'SEARCH' ? 'VD: cách phòng tránh chấn thương gối khi chạy bộ' : 'https://… (trang danh sách bài)'} />
          <SegmentedControl value={saveAs} onChange={setSaveAs} options={[{ value: 'SUMMARY', label: 'Tóm tắt + link' }, { value: 'FULL', label: 'Bài đầy đủ' }]} />
          {saveAs === 'FULL' && <p className="text-xs text-fg-muted">AI viết lại đủ nội dung bài (trang danh sách thì mở từng bài con), ghi rõ nguồn ở cuối bài. Bài vào «Chờ duyệt», admin sửa và đối chiếu nguồn rồi mới đăng; bài sức khoẻ vẫn cần duyệt chuyên môn. Quét lại nguồn cũ sẽ nâng bản tóm tắt chưa ai sửa lên bài đầy đủ.</p>}
          <select value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Chuyên mục mặc định" className="h-11 w-full rounded-xl border border-border bg-surface px-3 text-sm">
            <option value="">Chuyên mục: để AI chọn</option>
            {meta.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <div className="flex gap-2">
            <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Tên gọi (không bắt buộc)" maxLength={80} aria-label="Tên nguồn" />
            <Button type="button" className="shrink-0" disabled={(mode === 'PAGE' ? !/^https?:\/\/\S+$/i.test(value.trim()) : value.trim().length < 3) || add.isPending} onClick={() => add.mutate()}>Thêm</Button>
          </div>
        </div>
      </Field>
    </Card>
  )
}
