import { supabase } from '@/shared/lib/supabase'
import type { ExportRow, PerfRun } from '../model/insights'
import { systemErrorMessage } from '@/shared/lib/errors'

export interface Period { start: string; km: number; runs: number; moving_s: number; elev_m: number }
export interface Trends { weeks: Period[]; months: Period[] }

const n = (v: unknown) => Number(v ?? 0)
const toPeriod = (p: Period): Period => ({ start: p.start, km: n(p.km), runs: n(p.runs), moving_s: n(p.moving_s), elev_m: n(p.elev_m) })

export async function getTrends(): Promise<Trends> {
  const { data, error } = await supabase.rpc('my_trends')
  if (error) throw error
  const t = (data ?? {}) as Trends
  return { weeks: (t.weeks ?? []).map(toPeriod), months: (t.months ?? []).map(toPeriod) }
}

export async function getPerformance(): Promise<PerfRun[]> {
  const { data, error } = await supabase.rpc('my_performance')
  if (error) throw error
  return ((data ?? []) as PerfRun[]).map((r) => ({ ...r, km: n(r.km), moving_s: n(r.moving_s), splits: (r.splits ?? []).map(n) }))
}

export async function exportActivities(from: string, to: string): Promise<ExportRow[]> {
  const { data, error } = await supabase.rpc('my_activity_export', { p_from: from, p_to: to })
  if (error) throw error
  return ((data ?? []) as ExportRow[]).map((r) => ({ ...r, km: n(r.km), moving_s: n(r.moving_s), elapsed_s: n(r.elapsed_s), elev_m: n(r.elev_m),
    avg_hr: r.avg_hr == null ? null : n(r.avg_hr), xu: n(r.xu), xp: n(r.xp) }))
}

export function insightsErrorMessage(e: unknown): string {
  const raw = (e as { message?: string } | null)?.message ?? ''
  if (raw.includes('VIP_REQUIRED')) return 'Tính năng này dành cho gói VIP cao hơn.'
  if (raw.includes('INVALID_RANGE')) return 'Khoảng ngày không hợp lệ (tối đa 3 năm).'
  return systemErrorMessage(e, 'Không tải được dữ liệu. Hãy thử lại.')
}
