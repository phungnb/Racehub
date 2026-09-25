// Bảng 8 cấp độ — nguồn chung ở shared/lib/economy (khớp private.level_for_xp, migration 003700)
import { LEVELS as ECON_LEVELS } from '@/shared/lib/economy'

export interface LevelDef {
  level: number
  name: string
  minXp: number
}

export const LEVELS: readonly LevelDef[] = ECON_LEVELS.map(({ level, name, minXp }) => ({ level, name, minXp }))

/** Mốc hiển thị thanh tiến độ ở cấp cao nhất */
export const MAX_XP = 300_000

export function levelDef(level: number | null | undefined): LevelDef {
  return LEVELS.find((l) => l.level === level) ?? LEVELS[0]
}

/**
 * Tiến độ trong cấp hiện tại. Cấp lấy từ server (có thể thấp hơn XP do cơ chế hạ cấp),
 * nên tính theo `level` chứ không suy ra từ XP.
 */
export function levelProgress(xp: number | null | undefined, level: number | null | undefined) {
  const cur = levelDef(level)
  const next = LEVELS.find((l) => l.level === cur.level + 1)
  const ceiling = next?.minXp ?? MAX_XP
  const value = Math.max(0, Number(xp ?? 0) - cur.minXp)
  const span = ceiling - cur.minXp
  return {
    current: cur,
    next: next ?? null,
    value: Math.min(value, span),
    span,
    remaining: Math.max(0, ceiling - Number(xp ?? 0)),
  }
}
