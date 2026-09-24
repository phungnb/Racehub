// Phân tích cá nhân cho VIP (migration 004000): kỷ lục theo cự ly, phân bố pace, xuất CSV.

export interface PerfRun { id: string; started_at: string; title: string | null; km: number; moving_s: number; splits: number[] }
export interface Effort { key: string; label: string; km: number; seconds: number; runId: string; date: string; estimated: boolean }

export const EFFORT_DISTANCES = [
  { key: '1k', label: '1K', km: 1 },
  { key: '5k', label: '5K', km: 5 },
  { key: '10k', label: '10K', km: 10 },
  { key: 'hm', label: 'Half marathon', km: 21.0975 },
  { key: 'fm', label: 'Marathon', km: 42.195 },
] as const

/** Tổng nhỏ nhất của `n` km liên tiếp */
function bestWindow(splits: number[], n: number): number | null {
  if (n < 1 || splits.length < n) return null
  let sum = splits.slice(0, n).reduce((a, b) => a + b, 0)
  let best = sum
  for (let i = n; i < splits.length; i++) { sum += splits[i] - splits[i - n]; if (sum < best) best = sum }
  return best
}

/**
 * Kỷ lục mỗi cự ly: ưu tiên đoạn km liên tiếp nhanh nhất trong dữ liệu từng km (half / full: 21 / 42 km rồi quy đổi),
 * không có dữ liệu từng km thì ước tính theo pace trung bình của bài dài hơn cự ly (đánh dấu "ước tính").
 */
export function bestEfforts(runs: PerfRun[]): Effort[] {
  const out: Effort[] = []
  for (const d of EFFORT_DISTANCES) {
    let best: Effort | null = null
    for (const r of runs) {
      const whole = Math.floor(d.km)
      const w = bestWindow(r.splits, whole)
      let secs: number | null = w === null ? null : Math.round((w * d.km) / whole)
      let estimated = false
      if (secs === null && r.km >= d.km && r.moving_s > 0) { secs = Math.round((r.moving_s * d.km) / r.km); estimated = true }
      if (secs !== null && (!best || secs < best.seconds)) {
        best = { key: d.key, label: d.label, km: d.km, seconds: secs, runId: r.id, date: r.started_at, estimated }
      }
    }
    if (best) out.push(best)
  }
  return out
}

/** Phân bố pace từng km (s/km) theo ô 15 giây; bài không có dữ liệu từng km dùng pace trung bình × số km */
export function paceHistogram(runs: PerfRun[], step = 15, from = 180, to = 540) {
  const bins = Array.from({ length: Math.ceil((to - from) / step) }, (_, i) => ({ from: from + i * step, count: 0 }))
  const add = (pace: number, w = 1) => {
    const i = Math.min(bins.length - 1, Math.max(0, Math.floor((pace - from) / step)))
    bins[i].count += w
  }
  for (const r of runs) {
    if (r.splits.length) r.splits.forEach((s) => add(s))
    else if (r.km > 0) add(r.moving_s / r.km, Math.max(1, Math.round(r.km)))
  }
  return bins
}

export const fmtDuration = (s: number) => {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.round(s % 60)
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`
}
export const fmtPace = (secPerKm: number) => `${Math.floor(secPerKm / 60)}:${String(Math.round(secPerKm % 60)).padStart(2, '0')}`

export interface ExportRow { started_at: string; title: string | null; source: string | null; km: number; moving_s: number; elapsed_s: number; elev_m: number; avg_hr: number | null; xu: number; xp: number }

const cell = (v: unknown) => { const s = String(v ?? ''); return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
/** CSV mở thẳng bằng Excel (BOM UTF-8, dấu phẩy thập phân kiểu Việt Nam đặt trong ô có dấu ngoặc kép) */
export function toCsv(rows: ExportRow[]): string {
  const head = ['Ngày', 'Giờ', 'Tên bài', 'Nguồn', 'Km', 'Thời gian chạy', 'Pace (ph/km)', 'Độ cao (m)', 'Nhịp tim TB', 'Xu', 'XP']
  const body = rows.map((r) => {
    const d = new Date(r.started_at)
    return [d.toLocaleDateString('vi-VN'), d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }), r.title ?? '', r.source ?? '',
      String(r.km).replace('.', ','), fmtDuration(r.moving_s), r.km > 0 ? fmtPace(r.moving_s / r.km) : '', r.elev_m, r.avg_hr ?? '', String(r.xu).replace('.', ','), r.xp]
  })
  return '﻿' + [head, ...body].map((x) => x.map(cell).join(',')).join('\n')
}

/** Tổng hợp theo tháng cho bản báo cáo in */
export function summarize(rows: ExportRow[]) {
  const byMonth = new Map<string, { month: string; runs: number; km: number; moving_s: number }>()
  for (const r of rows) {
    const d = new Date(r.started_at)
    const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    const m = byMonth.get(k) ?? { month: k, runs: 0, km: 0, moving_s: 0 }
    m.runs += 1; m.km += r.km; m.moving_s += r.moving_s
    byMonth.set(k, m)
  }
  const months = [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month))
  const km = rows.reduce((s, r) => s + r.km, 0), moving = rows.reduce((s, r) => s + r.moving_s, 0)
  return { months, runs: rows.length, km, moving_s: moving, longest: rows.reduce((m, r) => Math.max(m, r.km), 0), pace: km > 0 ? moving / km : 0 }
}
