// Bảng cấp độ theo tài liệu "Chi tiết module app" — Module 1.3
export interface LevelDef {
  level: number
  name: string
  minXp: number
}

export const LEVELS: readonly LevelDef[] = [
  { level: 1, name: 'Người Mới Bắt Đầu', minXp: 0 },
  { level: 2, name: 'Người Chạy Đều Đặn', minXp: 1_000 },
  { level: 3, name: 'Vận Động Viên Cơ Bản', minXp: 5_000 },
  { level: 4, name: 'Runner Nghiêm Túc', minXp: 15_000 },
  { level: 5, name: 'Huyền Thoại Đường Chạy', minXp: 40_000 },
] as const

export const MAX_XP = 100_000

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
