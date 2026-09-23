export type ChallengePhase = 'UPCOMING' | 'LIVE' | 'ENDED'

export interface ChallengeRow {
  id: string
  title: string
  challenge_type: 'INDIVIDUAL' | 'TEAM' | string
  game_mode: string | null
  target_km: number | string | null
  min_km: number | string | null
  max_slots: number | null
  start_date: string
  end_date: string
  created_by: string | null
  target_audience: string | null
  calculated_fee: number | null
}

export const GAME_MODE_LABEL: Record<string, string> = {
  ACCUMULATE: 'Tích lũy km',
  DISTANCE_TARGET: 'Cự ly mục tiêu',
  MILESTONE: 'Cột mốc',
  STREAK: 'Chuỗi ngày',
  TEAM_SUM: 'Tổng km đội',
  TEAM_AVG: 'Km trung bình đội',
  TEAM_GAP: 'Cách biệt đội',
  LAST_MEMBER: 'Người cuối về đích',
}

const DAY = 86_400_000

export function challengePhase(c: Pick<ChallengeRow, 'start_date' | 'end_date'>, now = new Date()): ChallengePhase {
  const t = now.getTime()
  if (t < Date.parse(c.start_date)) return 'UPCOMING'
  if (t > Date.parse(c.end_date)) return 'ENDED'
  return 'LIVE'
}

/** Nhãn thời gian ngắn gọn: "Còn 5 ngày", "Còn 3 giờ", "Bắt đầu sau 2 ngày", "Đã kết thúc" */
export function timeLabel(c: Pick<ChallengeRow, 'start_date' | 'end_date'>, now = new Date()) {
  const phase = challengePhase(c, now)
  if (phase === 'ENDED') return 'Đã kết thúc'
  const target = Date.parse(phase === 'UPCOMING' ? c.start_date : c.end_date)
  const ms = target - now.getTime()
  const span = ms >= DAY ? `${Math.ceil(ms / DAY)} ngày` : `${Math.max(1, Math.ceil(ms / 3_600_000))} giờ`
  return phase === 'UPCOMING' ? `Bắt đầu sau ${span}` : `Còn ${span}`
}

/** Tiến độ thời gian đã trôi qua (0–1) của thử thách đang diễn ra */
export function timeProgress(c: Pick<ChallengeRow, 'start_date' | 'end_date'>, now = new Date()) {
  const s = Date.parse(c.start_date), e = Date.parse(c.end_date)
  if (e <= s) return 1
  return Math.min(1, Math.max(0, (now.getTime() - s) / (e - s)))
}
