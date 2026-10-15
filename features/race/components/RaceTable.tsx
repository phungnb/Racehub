'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ExternalLink, Search } from 'lucide-react'
import { cn } from '@/shared/lib/cn'
import type { CalendarRow, RaceKind } from '../api/listingApi'
import { fmtDate } from './RaceCard'

const KIND_LABEL: Record<RaceKind, string> = { OFFLINE: 'Giải offline (chạy trực tiếp)', ONLINE: 'Giải online (chạy ảo)' }

export interface Selection { picked: Set<string>; onToggle: (id: string) => void; onToggleAll: (ids: string[], on: boolean) => void }

const dateRange = (r: CalendarRow) => (r.race_date ? (r.end_date && r.end_date !== r.race_date ? `${fmtDate(r.race_date)} – ${fmtDate(r.end_date)}` : fmtDate(r.race_date)) : 'Chưa rõ')

function Link2({ href, label }: { href: string | null; label: string }) {
  if (!href) return <span className="text-fg-subtle">—</span>
  return <a href={href} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1 font-semibold text-brand">{label}<ExternalLink className="size-3" aria-hidden /></a>
}

function Section({ kind, rows, sel, editHref, onEdit }: { kind: RaceKind; rows: CalendarRow[]; sel?: Selection; editHref?: (id: string) => string; onEdit?: (id: string) => void }) {
  const all = rows.length > 0 && rows.every((r) => sel?.picked.has(r.id))
  return (
    <details open className="rounded-xl border border-border bg-surface">
      <summary className="flex min-h-11 cursor-pointer items-center gap-2 px-3 text-sm font-bold">
        <span className="flex-1">{KIND_LABEL[kind]}</span>
        <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs font-semibold text-fg-muted">{rows.length}</span>
      </summary>
      <div className="overflow-x-auto border-t border-border">
        <table className="w-full min-w-[720px] text-left text-xs">
          <thead className="bg-surface-2 text-fg-muted">
            <tr>
              {sel && <th className="w-8 px-2 py-2"><input type="checkbox" className="size-4" aria-label="Chọn cả nhóm" checked={all} onChange={(e) => sel.onToggleAll(rows.map((r) => r.id), e.target.checked)} /></th>}
              <th className="w-8 px-2 py-2">TT</th><th className="px-2 py-2">Tên giải</th><th className="px-2 py-2">Địa điểm</th><th className="px-2 py-2">Ngày chạy</th>
              <th className="px-2 py-2">Hạn đăng ký</th><th className="px-2 py-2">Cự ly</th><th className="px-2 py-2">Link giải</th><th className="px-2 py-2">Link mua bib</th>
              {(editHref || onEdit) && <th className="px-2 py-2" />}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.id} className={cn('border-t border-border align-top', sel?.picked.has(r.id) && 'bg-brand/10')}>
                {sel && <td className="px-2 py-2"><input type="checkbox" className="size-4" aria-label={`Chọn ${r.title}`} checked={sel.picked.has(r.id)} onChange={() => sel.onToggle(r.id)} /></td>}
                <td className="px-2 py-2 text-fg-muted">{i + 1}</td>
                <td className="px-2 py-2 font-semibold">{r.title}{r.organizer && <span className="block text-[11px] font-normal text-fg-muted">{r.organizer}</span>}</td>
                <td className="px-2 py-2">{r.kind === 'ONLINE' ? (r.location || 'Chạy ảo') : r.location || '—'}</td>
                <td className="whitespace-nowrap px-2 py-2">{dateRange(r)}</td>
                <td className="whitespace-nowrap px-2 py-2">{r.reg_deadline ? fmtDate(r.reg_deadline) : '—'}</td>
                <td className="px-2 py-2">{r.distances.length ? r.distances.join(', ') : '—'}</td>
                <td className="px-2 py-2"><Link2 href={r.race_url} label="Trang giải" /></td>
                <td className="px-2 py-2"><Link2 href={r.reg_url} label="Mua bib" /></td>
                {(editHref || onEdit) && (
                  <td className="space-y-1 px-2 py-2">
                    {onEdit && <button type="button" onClick={() => onEdit(r.id)} className="block whitespace-nowrap font-semibold text-brand">Sửa</button>}
                    {editHref && <Link href={editHref(r.id)} className="block whitespace-nowrap font-semibold text-fg-muted">Đăng tin</Link>}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  )
}

/** Bảng tổng hợp giải chạy: hai nhóm Offline / Online, mỗi nhóm thu gọn được, sắp theo ngày chạy. */
const fold = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').toLowerCase()

export function RaceTable({ rows: all, sel, editHref, onEdit }: { rows: CalendarRow[]; sel?: Selection; editHref?: (id: string) => string; onEdit?: (id: string) => void }) {
  const [term, setTerm] = useState('')
  const words = fold(term).split(/\s+/).filter(Boolean)
  const rows = words.length ? all.filter((r) => { const hay = fold([r.title, r.location, r.organizer, ...r.distances].filter(Boolean).join(' ')); return words.every((w) => hay.includes(w)) }) : all
  const by = (k: RaceKind) => rows.filter((r) => r.kind === k).sort((a, b) => (a.race_date ?? '9').localeCompare(b.race_date ?? '9'))
  return (
    <div className="space-y-3">
      <label className="relative block">
        <span className="sr-only">Tìm giải</span>
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-muted" aria-hidden />
        <input type="search" value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Tìm giải theo tên, địa điểm, cự ly…"
          className="h-11 w-full rounded-xl border border-border bg-bg pl-9 pr-3 text-[15px]" />
      </label>
      {words.length > 0 && !rows.length && <p className="px-1 text-sm text-fg-muted">Không có giải nào khớp “{term.trim()}”.</p>}
      <Section kind="OFFLINE" rows={by('OFFLINE')} sel={sel} editHref={editHref} onEdit={onEdit} />
      <Section kind="ONLINE" rows={by('ONLINE')} sel={sel} editHref={editHref} onEdit={onEdit} />
    </div>
  )
}
