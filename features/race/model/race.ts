// Giải chạy: định dạng, trạng thái, CSV cho ban tổ chức (hàm thuần)
import type { XlsxSheet } from '@/shared/lib/excel'
import type { DashboardRow, Race } from '../api/raceApi'

export type RacePhase = 'CANCELLED' | 'UPCOMING' | 'LIVE' | 'ENDED'

export function racePhase(r: Pick<Race, 'status' | 'start_at' | 'end_at'>, now = Date.now()): RacePhase {
  if (r.status === 'CANCELLED') return 'CANCELLED'
  if (now < Date.parse(r.start_at)) return 'UPCOMING'
  if (now < Date.parse(r.end_at)) return 'LIVE'
  return 'ENDED'
}

export const canRegister = (r: Pick<Race, 'status' | 'reg_close_at' | 'end_at'>, now = Date.now()) =>
  r.status === 'PUBLISHED' && now <= Date.parse(r.reg_close_at) && now < Date.parse(r.end_at)

/** Tên cự ly quen thuộc */
export function distanceLabel(km: number) {
  const k = Number(km)
  if (Math.abs(k - 42.2) < 0.15 || Math.abs(k - 42.195) < 0.01) return 'Full Marathon'
  if (Math.abs(k - 21.1) < 0.1 || Math.abs(k - 21.0975) < 0.01) return 'Half Marathon'
  return `${String(k).replace('.', ',')} km`
}

/** Thời gian thi đấu h:mm:ss (hoặc m:ss) */
export function raceTime(s: number | null | undefined) {
  if (s == null) return '—'
  const t = Math.round(s)
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec = t % 60
  const mm = String(m).padStart(h ? 2 : 1, '0'), ss = String(sec).padStart(2, '0')
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

export const racePace = (paceS: number) => `${Math.floor(paceS / 60)}:${String(Math.round(paceS % 60)).padStart(2, '0')}/km`

const STATUS_VI: Record<DashboardRow['status'], string> = { REGISTERED: 'Chưa hoàn thành', FINISHED: 'Hoàn thành', WITHDRAWN: 'Đã rút' }
const cell = (v: unknown) => {
  const s = v == null ? '' : String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** Danh sách VĐV → CSV (có BOM để Excel đọc đúng tiếng Việt); xếp hạng trong từng cự ly */
export function dashboardCsv(rows: DashboardRow[]) {
  const rankOf = new Map<string, number>()
  for (const km of [...new Set(rows.map((r) => Number(r.distance_km)))]) {
    rows.filter((r) => Number(r.distance_km) === km && r.status === 'FINISHED' && r.finish_time_s != null)
      .sort((a, b) => a.finish_time_s! - b.finish_time_s!)
      .forEach((r, i) => rankOf.set(r.bib, i + 1))
  }
  const head = ['BIB', 'Họ tên', 'Cự ly (km)', 'Trạng thái', 'Hạng', 'Thành tích', 'Quãng đường bài chạy (km)', 'Ngày chạy', 'Ngày đăng ký']
  const body = rows.map((r) => [
    r.bib, r.display_name ?? '', String(r.distance_km).replace('.', ','), STATUS_VI[r.status], rankOf.get(r.bib) ?? '',
    raceTime(r.finish_time_s), r.finish_distance_m != null ? (r.finish_distance_m / 1000).toFixed(2).replace('.', ',') : '',
    r.finished_at ? new Date(r.finished_at).toLocaleDateString('vi-VN') : '', new Date(r.registered_at).toLocaleDateString('vi-VN'),
  ])
  return '﻿' + [head, ...body].map((r) => r.map(cell).join(',')).join('\n')
}

/** Kết quả giải → Excel cho CLB Pro: một sheet tổng hợp theo cự ly + một sheet danh sách VĐV (hạng trong từng cự ly) */
export function raceXlsxSheets(rows: DashboardRow[]): XlsxSheet[] {
  const rankOf = new Map<string, number>()
  const kms = [...new Set(rows.map((r) => Number(r.distance_km)))].sort((a, b) => a - b)
  for (const km of kms) {
    rows.filter((r) => Number(r.distance_km) === km && r.status === 'FINISHED' && r.finish_time_s != null)
      .sort((a, b) => a.finish_time_s! - b.finish_time_s!)
      .forEach((r, i) => rankOf.set(r.bib, i + 1))
  }
  const date = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('vi-VN') : '')
  const summary = kms.map((km) => {
    const g = rows.filter((r) => Number(r.distance_km) === km && r.status !== 'WITHDRAWN')
    return [distanceLabel(km), g.length, g.filter((r) => r.status === 'FINISHED').length, rows.filter((r) => Number(r.distance_km) === km && r.status === 'WITHDRAWN').length]
  })
  const list = [...rows].sort((a, b) => Number(a.distance_km) - Number(b.distance_km)
    || (rankOf.get(a.bib) ?? 1e9) - (rankOf.get(b.bib) ?? 1e9) || a.bib.localeCompare(b.bib))
  return [
    { name: 'Tổng hợp', head: ['Cự ly', 'Đăng ký', 'Hoàn thành', 'Đã rút'], rows: summary },
    {
      name: 'Kết quả',
      head: ['Cự ly', 'Hạng', 'BIB', 'Họ tên', 'Trạng thái', 'Thành tích', 'Pace', 'Quãng đường bài chạy (km)', 'Ngày chạy', 'Ngày đăng ký'],
      rows: list.map((r) => [
        distanceLabel(Number(r.distance_km)), rankOf.get(r.bib) ?? '', r.bib, r.display_name ?? '', STATUS_VI[r.status],
        r.finish_time_s != null ? raceTime(r.finish_time_s) : '',
        r.finish_time_s != null && r.finish_distance_m ? racePace((r.finish_time_s / r.finish_distance_m) * 1000) : '',
        r.finish_distance_m != null ? Math.round(r.finish_distance_m / 10) / 100 : '',
        date(r.finished_at), date(r.registered_at),
      ]),
    },
  ]
}
