// Nhãn và định dạng dùng chung cho tổ chức (migration 008300)
import type { CampaignMetric, OrgKind } from '../api/orgApi'

export const KIND_LABEL: Record<OrgKind, string> = {
  COMPANY: 'Doanh nghiệp', FEDERATION: 'Liên đoàn / hệ thống CLB', SCHOOL: 'Trường học', OTHER: 'Tổ chức khác',
}

export const METRIC: Record<CampaignMetric, { label: string; unit: string; hint: string }> = {
  DISTANCE: { label: 'Tổng km', unit: 'km', hint: 'Cộng km mọi bài chạy hợp lệ' },
  RUNS: { label: 'Số buổi chạy', unit: 'buổi', hint: 'Mỗi bài chạy hợp lệ tính 1 buổi' },
  ACTIVE_DAYS: { label: 'Số ngày chạy', unit: 'ngày', hint: 'Mỗi ngày có ít nhất 1 bài tính 1 ngày — khuyến khích đều đặn' },
}

const nf = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 })
export const fmtValue = (v: number | null | undefined, metric: CampaignMetric) =>
  `${nf.format(Number(v ?? 0))} ${METRIC[metric].unit}`

export const fmtDay = (iso: string) => new Date(iso).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' })

export type CampaignPhase = 'UPCOMING' | 'LIVE' | 'ENDED'
export const campaignPhase = (c: { starts_at: string; ends_at: string }, now: number): CampaignPhase =>
  Date.parse(c.starts_at) > now ? 'UPCOMING' : Date.parse(c.ends_at) <= now ? 'ENDED' : 'LIVE'
export const PHASE_LABEL: Record<CampaignPhase, string> = { UPCOMING: 'Sắp diễn ra', LIVE: 'Đang diễn ra', ENDED: 'Đã kết thúc' }

const csvCell = (x: unknown) => { const s = String(x ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }

/** Tải file CSV (có BOM để Excel đọc đúng tiếng Việt) */
export function downloadCsv(filename: string, head: string[], rows: unknown[][]) {
  const csv = '﻿' + [head, ...rows].map((r) => r.map(csvCell).join(',')).join('\n')
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  a.download = filename
  a.click()
  URL.revokeObjectURL(a.href)
}

/** Ngày dạng yyyy-mm-dd (giờ máy) ↔ ISO đầu ngày giờ Việt Nam */
export const vnDayStart = (day: string) => new Date(`${day}T00:00:00+07:00`).toISOString()
export const toDayInput = (iso: string) => {
  const d = new Date(new Date(iso).getTime() + 7 * 3600_000)
  return d.toISOString().slice(0, 10)
}

/** Cây đơn vị → danh sách phẳng có độ sâu + đường dẫn "Miền Bắc / Hà Nội" (cho ô chọn, BXH) */
export interface UnitNode { id: string; name: string; parent_id?: string | null }
export function unitOptions<T extends UnitNode>(units: T[], only?: string[] | null): (T & { depth: number; path: string })[] {
  const kids = new Map<string | null, T[]>()
  for (const u of units) {
    const k = u.parent_id && units.some((x) => x.id === u.parent_id) ? u.parent_id : null
    kids.set(k, [...(kids.get(k) ?? []), u])
  }
  const out: (T & { depth: number; path: string })[] = []
  const walk = (parent: string | null, depth: number, prefix: string) => {
    for (const u of kids.get(parent) ?? []) {
      const path = prefix ? `${prefix} / ${u.name}` : u.name
      if (!only || only.includes(u.id)) out.push({ ...u, depth, path })
      walk(u.id, depth + 1, path)
    }
  }
  walk(null, 0, '')
  return out
}

/** Đọc CSV (phẩy / chấm phẩy / tab, có ngoặc kép) → mảng dòng */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^\uFEFF/, '')
  const first = src.split(/\r?\n/, 1)[0] ?? ''
  const sep = [';', '\t', ','].reduce((best, s) => (first.split(s).length > first.split(best).length ? s : best), ',')
  const rows: string[][] = []
  let row: string[] = [], cell = '', q = false
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (q) {
      if (ch === '"' && src[i + 1] === '"') { cell += '"'; i++ } else if (ch === '"') q = false; else cell += ch
    } else if (ch === '"') q = true
    else if (ch === sep) { row.push(cell.trim()); cell = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++
      row.push(cell.trim()); cell = ''
      if (row.some((c) => c)) rows.push(row)
      row = []
    } else cell += ch
  }
  row.push(cell.trim())
  if (row.some((c) => c)) rows.push(row)
  return rows
}
