// Cộng dồn số liệu đơn vị lên cấp trên (Phòng Kinh doanh = Miền Bắc + Miền Nam + người gắn thẳng vào phòng) và xếp hạng.
import type { OverviewGroup } from '../api/orgApi'

export interface RolledUnit extends OverviewGroup { depth: number; children: RolledUnit[]; avg: number; rate: number }

export function rollUpUnits(units: OverviewGroup[]): RolledUnit[] {
  const byId = new Map<string, RolledUnit>(units.map((u) => [u.id, { ...u, km: Number(u.km) || 0, depth: 0, children: [], avg: 0, rate: 0 }]))
  const roots: RolledUnit[] = []
  for (const u of byId.values()) {
    const parent = u.parent_id ? byId.get(u.parent_id) : undefined
    if (parent) parent.children.push(u); else roots.push(u)
  }
  const sum = (u: RolledUnit, depth: number): RolledUnit => {
    u.depth = depth
    for (const c of u.children) {
      sum(c, depth + 1)
      u.members += c.members; u.active += c.active; u.km = Math.round((u.km + c.km) * 10) / 10
    }
    u.avg = u.members ? Math.round((u.km / u.members) * 100) / 100 : 0
    u.rate = u.members ? Math.round((u.active / u.members) * 100) : 0
    return u
  }
  return roots.map((r) => sum(r, 0))
}

export type RankBy = 'total' | 'avg' | 'rate'
export const rankUnits = <T extends { km: number; avg: number; rate: number; members: number }>(list: T[], by: RankBy) =>
  [...list].filter((u) => u.members > 0).sort((a, b) =>
    by === 'total' ? b.km - a.km : by === 'avg' ? b.avg - a.avg || b.km - a.km : b.rate - a.rate || b.km - a.km)

/** Khoảng ngày nhanh (giờ Việt Nam) → [từ, đến) ISO */
export type Period = 'week' | 'month' | '30d' | 'year'
export function periodRange(p: Period, now = new Date()): { from: string; to: string; label: string } {
  const vn = new Date(now.getTime() + 7 * 3600_000)
  const day = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d) - 7 * 3600_000)
  const y = vn.getUTCFullYear(), m = vn.getUTCMonth(), d = vn.getUTCDate()
  const tomorrow = day(y, m, d + 1)
  if (p === 'week') { const dow = (vn.getUTCDay() + 6) % 7; return { from: day(y, m, d - dow).toISOString(), to: tomorrow.toISOString(), label: 'Tuần này' } }
  if (p === 'month') return { from: day(y, m, 1).toISOString(), to: tomorrow.toISOString(), label: 'Tháng này' }
  if (p === 'year') return { from: day(y, 0, 1).toISOString(), to: tomorrow.toISOString(), label: 'Năm nay' }
  return { from: day(y, m, d - 29).toISOString(), to: tomorrow.toISOString(), label: '30 ngày' }
}
