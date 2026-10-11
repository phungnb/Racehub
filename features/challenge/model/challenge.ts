// Logic thuần của thử thách: nhãn, định dạng điểm, tiến độ theo kế hoạch, kiểm tra dữ liệu tạo mới.
// Luật tính điểm thật nằm ở DB (migration 000600) — file này chỉ để hiển thị và kiểm tra sớm ở client.

import type { XlsxSheet } from '@/shared/lib/excel'
import type { LeaderboardEntry, TeamStanding } from '../api/challengeApi'

export type ChallengePhase = 'UPCOMING' | 'LIVE' | 'SETTLING' | 'ENDED' | 'CANCELLED'
export type ChallengeFormat = 'SOLO_GOAL' | 'RANKED' | 'DUEL' | 'TEAM' | 'COLLECTIVE'
export type Objective = 'DISTANCE' | 'RUNS' | 'DURATION' | 'STREAK_DAYS' | 'BEST_TIME' | 'BEST_PACE'
export type TeamMode = 'TEAM_SUM' | 'TEAM_AVG' | 'TEAM_GAP' | 'LAST_MEMBER'
export type Audience = 'PUBLIC' | 'CLUB_ONLY' | 'INVITE_ONLY'
export type RewardSource = 'NONE' | 'CREATOR' | 'CLUB'
export type RewardSplit = 'WINNER' | 'TOP3' | 'FINISHERS' | 'TEAM'

export const FORMAT_META: Record<ChallengeFormat, { label: string; short: string; description: string }> = {
  SOLO_GOAL: { label: 'Chinh phục cá nhân', short: 'Cá nhân', description: 'Quãng đường, thời gian (5K, 10K, Half, Full…), pace hoặc chuỗi ngày — cho riêng bạn hoặc rủ nhiều người' },
  RANKED: { label: 'Cộng đồng · Đua xếp hạng', short: 'Xếp hạng', description: 'Mọi người cùng chạy, BXH theo km hoặc số ngày chạy' },
  DUEL: { label: 'Thách đấu 1-1', short: '1-1', description: 'Rủ một người bạn so tài, ai hơn thì thắng' },
  TEAM: { label: 'Đồng đội', short: 'Đồng đội', description: 'Chia đội thi đấu, tính điểm theo cả đội' },
  COLLECTIVE: { label: 'Cộng đồng · Cùng nhau chinh phục', short: 'Cộng đồng', description: 'Cùng nhau chinh phục: cộng dồn km, có BXH theo km hoặc số ngày chạy' },
}

/** Nhóm thử thách "Cộng đồng" gồm các kiểu con — thêm kiểu mới ở đây khi phát triển (Cùng nhau chinh phục, …) */
export const COMMUNITY_KINDS = [
  { id: 'TOGETHER', format: 'COLLECTIVE', label: 'Cùng nhau chinh phục', description: 'Cộng dồn km của mọi người để chạm một mục tiêu chung. BXH lọc theo km, số ngày chạy, số buổi' },
  { id: 'RANKED', format: 'RANKED', label: 'Đua xếp hạng', description: 'Không đặt mục tiêu — chỉ thời gian và luật. Xếp theo tổng km, bảng có số ngày chạy, số buổi, pace TB (như giải chạy online)' },
] as const satisfies readonly { id: string; format: ChallengeFormat; label: string; description: string }[]
export const isCommunity = (f: ChallengeFormat | string) => f === 'COLLECTIVE' || f === 'RANKED'
export const isConquest = (o: Objective | string | null | undefined) => o === 'BEST_TIME' || o === 'BEST_PACE'

export const OBJECTIVE_META: Record<Objective, { label: string; unit: string; hint: string }> = {
  DISTANCE: { label: 'Quãng đường', unit: 'km', hint: 'Cộng dồn số km chạy' },
  RUNS: { label: 'Số buổi chạy', unit: 'buổi', hint: 'Mỗi bài chạy hợp lệ tính 1 buổi' },
  DURATION: { label: 'Thời gian chạy', unit: 'phút', hint: 'Cộng dồn thời gian di chuyển' },
  STREAK_DAYS: { label: 'Chuỗi ngày', unit: 'ngày', hint: 'Số ngày chạy đủ cự ly tối thiểu trong ngày' },
  BEST_TIME: { label: 'Chinh phục thời gian', unit: 'hạng mục', hint: '5K, 10K, Half, Full… đạt thời gian mục tiêu' },
  BEST_PACE: { label: 'Chinh phục pace', unit: 'hạng mục', hint: '5K, 10K, Half, Full… chạy đạt pace mục tiêu' },
}

/**
 * Các kiểu "Tính điểm theo" hiển thị ngang hàng. "Chinh phục cự ly" lưu ở DB là BEST_TIME + chế độ ANY (migration 013800),
 * nên lựa chọn ở giao diện gồm cả cặp (objective, mode) chứ không chỉ objective.
 */
export type ObjectiveChoiceId = Objective | 'BEST_DISTANCE'
export const DISTANCE_CONQUEST_META = { label: 'Chinh phục cự ly', unit: 'hạng mục', hint: '5K, 10K, 10,1 km… chạy một bài đủ cự ly là đạt, không cần thời gian' }
export const isDistanceConquest = (objective: Objective | string | null | undefined, mode: string | null | undefined) =>
  objective === 'BEST_TIME' && mode === 'ANY'
/** Nhãn / đơn vị / gợi ý của kiểu tính điểm, tính cả chế độ ANY */
export const objectiveMeta = (objective: Objective, mode?: string | null) =>
  isDistanceConquest(objective, mode) ? DISTANCE_CONQUEST_META : OBJECTIVE_META[objective]
/**
 * Mở rộng danh sách objective thành các lựa chọn, chèn "Chinh phục cự ly" ngay sau "Chinh phục pace".
 * `patch` là phần cần ghi vào bản nháp khi chọn: objective và chế độ chinh phục (ANY chỉ cho "Chinh phục cự ly").
 */
export function objectiveChoices(objectives: Objective[], cur: { objective: Objective; mode: ConquestMode }) {
  const distance = isDistanceConquest(cur.objective, cur.mode)
  const out: { id: ObjectiveChoiceId; meta: { label: string; unit: string; hint: string }; active: boolean; objective: Objective; mode: ConquestMode | null }[] = []
  for (const o of objectives) {
    const conq = isConquest(o)
    out.push({ id: o, meta: OBJECTIVE_META[o], objective: o, mode: conq ? (cur.mode === 'ANY' ? 'FIXED' : cur.mode) : null,
      active: cur.objective === o && !distance })
    if (o === 'BEST_PACE' && objectives.includes('BEST_TIME')) {
      out.push({ id: 'BEST_DISTANCE', meta: DISTANCE_CONQUEST_META, objective: 'BEST_TIME', mode: 'ANY', active: distance })
    }
  }
  return out
}

/* ------------------- Chinh phục thời gian / pace (migration 010700) ------------------- */

/** ANY = Chinh phục cự ly: chạy một bài đủ cự ly là đạt, không đặt thời gian/pace (migration 013800) */
export type ConquestMode = 'FIXED' | 'SELF' | 'ANY'
export interface ConquestCategoryDraft { label: string; km: number; target: string }
/** tolerancePct: sai số cự ly cho phép (%) — bài ≥ (100 − sai số)% cự ly hạng mục được tính (014200) */
export interface ConquestDraft { mode: ConquestMode; categories: ConquestCategoryDraft[]; tolerancePct: number }
/** Cự ly có sẵn — "Tự đặt" cho phép nhập cự ly bất kỳ */
export const CONQUEST_PRESETS: { label: string; km: number; time: string; pace: string }[] = [
  { label: '5K', km: 5, time: '30:00', pace: '6:00' },
  { label: '10K', km: 10, time: '1:00:00', pace: '6:00' },
  { label: 'Half', km: 21.0975, time: '2:15:00', pace: '6:24' },
  { label: 'Full', km: 42.195, time: '4:45:00', pace: '6:45' },
]
export const DEFAULT_CONQUEST: ConquestDraft = { mode: 'FIXED', categories: [{ label: '5K', km: 5, target: '30:00' }, { label: '10K', km: 10, target: '1:00:00' }], tolerancePct: 1 }
/** "1,5%" */
export const pctLabel = (x: number) => `${String(Math.round(x * 10) / 10).replace('.', ',')}%`

/** "1:05:30" → 3930 · "25:00" → 1500 · "6:15" (pace) → 375; sai → null */
export function parseClock(t: string): number | null {
  const parts = t.trim().replace(/[.,']/g, ':').split(':').filter((x) => x !== '')
  if (!parts.length || parts.length > 3 || parts.some((x) => !/^\d{1,3}$/.test(x))) return null
  const n = parts.map(Number)
  if (n.slice(1).some((x) => x >= 60)) return null
  const s = n.reduce((acc, x) => acc * 60 + x, 0)
  return s > 0 ? s : null
}
/** 3930 → "1:05:30" · 1500 → "25:00" */
export function formatClock(s: number | null | undefined): string {
  if (s == null || !Number.isFinite(s)) return '—'
  const v = Math.round(s), h = Math.floor(v / 3600), m = Math.floor((v % 3600) / 60), sec = v % 60
  const mm = h ? String(m).padStart(2, '0') : String(m)
  return `${h ? `${h}:` : ''}${mm}:${String(sec).padStart(2, '0')}`
}
export const kmLabel = (km: number) => `${new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 3 }).format(km)} km`

/** Kiểm tra hạng mục (khớp set_challenge_conquest) */
export function validateConquest(c: ConquestDraft, objective: Objective): string | null {
  if (!c.categories.length || c.categories.length > 8) return 'Cần 1 đến 8 hạng mục'
  if (!(c.tolerancePct >= 0 && c.tolerancePct <= 10)) return 'Sai số cự ly từ 0 đến 10%'
  for (const [i, x] of c.categories.entries()) {
    const at = `Hạng mục ${i + 1}`
    if (!x.label.trim() || x.label.trim().length > 40) return `${at}: đặt tên (tối đa 40 ký tự)`
    if (!(x.km >= 0.4 && x.km <= 250)) return `${at}: cự ly từ 0,4 đến 250 km`
    if (c.mode === 'FIXED') {
      const s = parseClock(x.target)
      if (s === null) return `${at}: nhập mục tiêu dạng ${objective === 'BEST_PACE' ? '6:00 (phút:giây mỗi km)' : '1:05:00 hoặc 25:00'}`
      if (objective === 'BEST_PACE' && (s < 120 || s > 1500)) return `${at}: pace từ 2:00 đến 25:00 /km`
      if (objective === 'BEST_TIME' && (s < 60 || s > 172_800)) return `${at}: thời gian không hợp lệ`
    }
  }
  if (new Set(c.categories.map((x) => x.label.trim().toLowerCase())).size !== c.categories.length) return 'Tên hạng mục bị trùng'
  return null
}
export const conquestPayload = (d: Pick<ChallengeDraft, 'objective' | 'conquest'>) => ({
  objective: d.objective as 'BEST_TIME' | 'BEST_PACE',
  mode: d.conquest.mode,
  tolerance_pct: Math.round(d.conquest.tolerancePct * 10) / 10,
  categories: d.conquest.categories.map((x) => ({ label: x.label.trim(), distance_km: x.km, target_s: d.conquest.mode === 'FIXED' ? parseClock(x.target) : null })),
})

/**
 * Cách tính điểm của từng loại thử thách — hiện ở bước tạo và tab Luật chơi để ai cũng hiểu mình được tính thế nào.
 */
export function scoringLines(c: {
  format: ChallengeFormat | string; objective: Objective | string | null; game_mode?: string | null; pledge_enabled?: boolean
  target_value?: number | null; conquest_mode?: string | null; pledge_cap_pct?: number | null; min_km?: number | null
  conquest_tolerance_pct?: number | null
}): string[] {
  const o = (c.objective ?? 'DISTANCE') as Objective
  const unit = OBJECTIVE_META[o]?.unit ?? 'km'
  if (isConquest(o)) {
    const tol = Number(c.conquest_tolerance_pct ?? 1)
    return [
      ...(c.conquest_mode === 'ANY' ? [
        `Chinh phục cự ly: chạy một bài có cự ly đạt hạng mục${tol > 0 ? ` (sai số tối đa ${pctLabel(tol)})` : ''} là đạt, không cần thời gian hay pace.`,
        'Đạt mọi hạng mục đã đăng ký = hoàn thành. Không giới hạn thời gian của bài.',
      ] : [
      `Mỗi hạng mục (5K, 10K…) lấy bài chạy tốt nhất có cự ly ≥ hạng mục${tol > 0 ? ` (sai số ${pctLabel(tol)})` : ''}; ${o === 'BEST_PACE' ? 'pace = pace trung bình của bài' : 'thời gian quy đổi theo pace trung bình của bài'}.`,
      c.conquest_mode === 'SELF' ? 'Mỗi người tự đăng ký mục tiêu cho hạng mục mình chọn.' : 'Người tạo đặt mục tiêu cho từng hạng mục; người chơi chọn hạng mục để đăng ký.',
      'Đạt mọi hạng mục đã đăng ký = hoàn thành. BXH từng hạng mục xếp theo kết quả nhanh nhất.',
      ]),
    ]
  }
  if (c.format === 'TEAM') {
    const mode = TEAM_MODE_META[(c.game_mode ?? 'TEAM_SUM') as TeamMode]
    return [
      c.pledge_enabled ? `Mỗi người đăng ký km cam kết; điểm đội = tổng km được tính${c.pledge_cap_pct != null ? ` (mỗi người tối đa mục tiêu +${c.pledge_cap_pct}%)` : ''}.`
        : `Điểm đội — ${mode?.label ?? 'Tổng'}: ${mode?.description ?? ''}.`,
      `Điểm cá nhân = ${OBJECTIVE_META[o]?.label.toLowerCase()} (${unit}); đội điểm cao nhất thắng.`,
    ]
  }
  if (isCommunity(c.format)) {
    return [
      'Điểm = tổng km hợp lệ của mỗi người; cả cộng đồng cộng dồn' + (Number(c.target_value) > 0 ? ` để chạm mục tiêu ${formatScore(o, c.target_value)}.` : '.'),
      'BXH xếp theo km, lọc được theo số ngày chạy và số buổi.',
    ]
  }
  if (c.format === 'DUEL') return [`Hai người so ${OBJECTIVE_META[o]?.label.toLowerCase()} (${unit}); ai hơn khi hết giờ thì thắng.`]
  // Chinh phục cá nhân theo km / chuỗi ngày
  if (c.pledge_enabled) return ['Mỗi người tự đăng ký mục tiêu km; đạt mục tiêu của mình = hoàn thành. BXH theo % mục tiêu, lọc theo từng mục tiêu.']
  return [o === 'STREAK_DAYS'
    ? `Mỗi ngày chạy đủ ${c.min_km ?? 0} km tính 1 ngày; đủ ${formatScore(o, c.target_value)} = hoàn thành.`
    : `Cộng dồn ${OBJECTIVE_META[o]?.label.toLowerCase()} hợp lệ; đạt ${formatScore(o, c.target_value)} = hoàn thành.`]
}

export const TEAM_MODE_META: Record<TeamMode, { label: string; description: string }> = {
  TEAM_SUM: { label: 'Tổng', description: 'Cộng km cả đội. Hợp với đội đủ quân bằng nhau' },
  TEAM_AVG: { label: 'Trung bình', description: 'Tổng km chia số thành viên, kể cả người 0 km. Công bằng khi quân số khác nhau' },
  TEAM_GAP: { label: 'Gap nội bộ', description: 'Điểm = trung bình − ½ × (người cao nhất − người thấp nhất). Đội đều sức thắng' },
  LAST_MEMBER: { label: 'Chốt đoàn', description: 'Tính theo người chạy ít nhất đội. Không bỏ ai lại phía sau' },
}

export const AUDIENCE_LABEL: Record<Audience, string> = {
  PUBLIC: 'Công khai',
  CLUB_ONLY: 'Nội bộ CLB',
  INVITE_ONLY: 'Chỉ người có mã mời',
}

const nf = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 })
const nf1 = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 })

/** "12,5 km" · "4 buổi" · "95 phút" · "7 ngày" */
export function formatScore(objective: Objective | string | null | undefined, value: number | string | null | undefined, withUnit = true) {
  const v = Number(value ?? 0)
  const o = (objective ?? 'DISTANCE') as Objective
  const unit = OBJECTIVE_META[o]?.unit ?? 'km'
  const n = o === 'DISTANCE' ? nf.format(v) : o === 'DURATION' ? nf1.format(v) : String(Math.round(v))
  return withUnit ? `${n} ${unit}` : n
}

const DAY = 86_400_000
const SETTLE_GRACE_MS = 2 * 3_600_000

export function challengePhase(
  c: { start_date: string; end_date: string; status?: string | null },
  now = new Date(),
): ChallengePhase {
  if (c.status === 'CANCELLED') return 'CANCELLED'
  if (c.status === 'FINISHED') return 'ENDED'
  const t = now.getTime()
  if (t < Date.parse(c.start_date)) return 'UPCOMING'
  if (t < Date.parse(c.end_date)) return 'LIVE'
  return 'SETTLING'
}

/** Nhóm thời gian của danh sách thử thách CLB: Sắp diễn ra · Đang diễn ra · Đã kết thúc (gồm đang tổng kết / đã hủy) */
export type ChallengeBucket = 'UPCOMING' | 'LIVE' | 'ENDED'
export const BUCKET_LABEL: Record<ChallengeBucket, string> = { UPCOMING: 'Sắp diễn ra', LIVE: 'Đang diễn ra', ENDED: 'Đã kết thúc' }
export const challengeBucket = (c: { start_date: string; end_date: string; status?: string | null }, now = new Date()): ChallengeBucket => {
  const p = challengePhase(c, now)
  return p === 'UPCOMING' || p === 'LIVE' ? p : 'ENDED'
}
/** Chia danh sách theo nhóm thời gian: sắp diễn ra — gần giờ bắt đầu trước; đang diễn ra — sắp hết trước; đã kết thúc — mới nhất trước */
export function bucketChallenges<T extends { start_date: string; end_date: string; status?: string | null }>(list: T[], now = new Date()) {
  const out: Record<ChallengeBucket, T[]> = { UPCOMING: [], LIVE: [], ENDED: [] }
  for (const c of list) out[challengeBucket(c, now)].push(c)
  out.UPCOMING.sort((a, b) => Date.parse(a.start_date) - Date.parse(b.start_date))
  out.LIVE.sort((a, b) => Date.parse(a.end_date) - Date.parse(b.end_date))
  out.ENDED.sort((a, b) => Date.parse(b.end_date) - Date.parse(a.end_date))
  return out
}
/** Nhóm mở sẵn: đang diễn ra nếu có, không thì sắp diễn ra, cuối cùng là đã kết thúc */
export const defaultBucket = (b: Record<ChallengeBucket, unknown[]>): ChallengeBucket =>
  b.LIVE.length ? 'LIVE' : b.UPCOMING.length ? 'UPCOMING' : b.ENDED.length ? 'ENDED' : 'LIVE'

/** Đã qua thời gian chờ đồng bộ muộn → có thể tất toán */
export const settlementDue = (c: { end_date: string; status?: string | null }, now = new Date()) =>
  (c.status ?? 'ACTIVE') === 'ACTIVE' && now.getTime() >= Date.parse(c.end_date) + SETTLE_GRACE_MS

/** Nhãn thời gian ngắn gọn: "Còn 5 ngày", "Còn 3 giờ", "Bắt đầu sau 2 ngày", "Đang tổng kết", "Đã kết thúc" */
export function timeLabel(c: { start_date: string; end_date: string; status?: string | null }, now = new Date()) {
  const phase = challengePhase(c, now)
  if (phase === 'CANCELLED') return 'Đã hủy'
  if (phase === 'ENDED') return 'Đã kết thúc'
  if (phase === 'SETTLING') return 'Đang tổng kết'
  const target = Date.parse(phase === 'UPCOMING' ? c.start_date : c.end_date)
  const ms = target - now.getTime()
  const span = ms >= DAY ? `${Math.ceil(ms / DAY)} ngày` : ms >= 3_600_000 ? `${Math.ceil(ms / 3_600_000)} giờ` : `${Math.max(1, Math.ceil(ms / 60_000))} phút`
  return phase === 'UPCOMING' ? `Bắt đầu sau ${span}` : `Còn ${span}`
}

/** Tiến độ thời gian đã trôi qua (0–1) */
export function timeProgress(c: { start_date: string; end_date: string }, now = new Date()) {
  const s = Date.parse(c.start_date), e = Date.parse(c.end_date)
  if (e <= s) return 1
  return Math.min(1, Math.max(0, (now.getTime() - s) / (e - s)))
}

/**
 * So với kế hoạch đều đặn (mục tiêu chia đều theo thời gian):
 * diff > 0 = đang vượt kế hoạch, diff < 0 = đang chậm. null nếu không có mục tiêu hoặc chưa bắt đầu.
 */
export function planStatus(
  c: { start_date: string; end_date: string; target_value?: number | string | null },
  score: number, now = new Date(),
): { expected: number; diff: number } | null {
  const target = Number(c.target_value ?? 0)
  if (target <= 0 || now.getTime() < Date.parse(c.start_date)) return null
  const expected = target * timeProgress(c, now)
  return { expected, diff: score - expected }
}

/* ------------------------------- Tạo thử thách ------------------------------- */

export interface ChallengeDraft {
  format: ChallengeFormat
  title: string
  description: string
  audience: Audience
  clubId: string | null
  objective: Objective
  gameMode: TeamMode
  targetValue: number
  minKm: number
  minPace: number
  maxPace: number
  dailyCapKm: number
  /** Bắt buộc có nhịp tim: bài không có dữ liệu nhịp tim không được tính (migration 002400) */
  requireHr: boolean
  teamNames: string[]
  teamSize: number
  maxSlots: number
  start: string          // ISO
  end: string            // ISO
  rewardXu: number
  rewardSource: RewardSource
  rewardSplit: 'WINNER' | 'TOP3'
  /** Mục tiêu tự đăng ký (migration 002000): mỗi người tự chọn mốc km của mình */
  pledge: PledgeDraft
  /** Thể lệ bổ sung (migration 005400): thưởng, phạt, lệ phí, điều kiện, liên hệ */
  rules: RulesInfoDraft
  /** Tự lặp lại (migration 007600): hết kỳ, hệ thống tự tạo kỳ kế tiếp cùng luật */
  recurrence: Recurrence
  /** Chinh phục cá nhân "Cá nhân tôi": chỉ mình mình, không hiện ở Khám phá */
  personal: boolean
  /** Chinh phục thời gian / pace: các hạng mục (migration 010700) */
  conquest: ConquestDraft
  /** Hạn đăng ký (ISO); null = đến khi kết thúc (thử thách đội: đến giờ xuất phát) */
  regDeadline: string | null
}

export type Recurrence = 'NONE' | 'WEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'YEARLY'
export const RECURRENCE_LABEL: Record<Recurrence, string> = {
  NONE: 'Không lặp', WEEKLY: 'Hằng tuần', MONTHLY: 'Hằng tháng', QUARTERLY: 'Hằng quý', YEARLY: 'Hằng năm',
}
/** Số ngày tối đa của một kỳ để còn lặp được theo chu kỳ đó */
export const RECURRENCE_MAX_DAYS: Record<Exclude<Recurrence, 'NONE'>, number> = { WEEKLY: 7, MONTHLY: 28, QUARTERLY: 90, YEARLY: 365 }
export const recurrenceAllowed = (d: Pick<ChallengeDraft, 'format' | 'start' | 'end'>, r: Recurrence) =>
  r === 'NONE' || (d.format !== 'DUEL' && (Date.parse(d.end) - Date.parse(d.start)) / DAY <= RECURRENCE_MAX_DAYS[r] + 1e-6)

export interface RulesInfoDraft {
  prizes?: string
  penalties?: string
  fees?: string
  conduct?: string
  contact?: string
  custom?: { title: string; body: string }[]
}

export interface PledgeDraft {
  enabled: boolean
  /** Các mốc cho chọn (km). Rỗng = nhập tự do trong khoảng min–max */
  options: number[]
  minKm: number
  maxKm: number
  /** Được tính vượt mục tiêu tối đa bao nhiêu % (null = không giới hạn) */
  capPct: number | null
  /** Đua đội theo mục tiêu: số người mỗi đội. Số đội = số người đăng ký ÷ số này (máy chủ tự tạo đội khi chia) */
  teamSize: number
}

export const DEFAULT_PLEDGE: PledgeDraft = { enabled: false, options: [21, 42, 60, 100], minKm: 10, maxKm: 300, capPct: 20, teamSize: 5 }

/** Đua đội theo mục tiêu: đồng đội + mỗi người tự đăng ký km, đội được chia tự động theo số người đăng ký */
export const isTeamPledge = (d: Pick<ChallengeDraft, 'format' | 'pledge'>) => d.format === 'TEAM' && d.pledge.enabled

/** Số đội dự kiến khi chia: làm tròn (số người ÷ số người mỗi đội), ít nhất 2 */
export const plannedTeams = (members: number, teamSize: number) =>
  teamSize > 0 ? Math.max(2, Math.round(members / teamSize)) : 2

/** Thử thách này có hỗ trợ mục tiêu tự đăng ký không (chỉ tính quãng đường, cá nhân hoặc đồng đội) */
export const pledgeSupported = (d: Pick<ChallengeDraft, 'format' | 'objective'> & { personal?: boolean }) =>
  d.objective === 'DISTANCE' && ((d.format === 'SOLO_GOAL' && !d.personal) || d.format === 'TEAM')

/** Số tuần ISO của ngày (theo giờ VN) — "Thử thách tuần 39" */
export function isoWeek(date: Date): number {
  const vn = new Date(date.getTime() + 7 * 3_600_000)
  const d = new Date(Date.UTC(vn.getUTCFullYear(), vn.getUTCMonth(), vn.getUTCDate()))
  const day = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - day)
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1)
  return Math.ceil(((d.getTime() - yearStart) / DAY + 1) / 7)
}

/** 00:00 thứ Hai (giờ VN) của tuần chứa `date`, hoặc tuần sau nếu `next` */
export function vnMonday(date: Date, next = false): Date {
  const vn = new Date(date.getTime() + 7 * 3_600_000)
  const day = vn.getUTCDay() || 7
  const mondayVn = Date.UTC(vn.getUTCFullYear(), vn.getUTCMonth(), vn.getUTCDate() - (day - 1) + (next ? 7 : 0))
  return new Date(mondayVn - 7 * 3_600_000)
}

/**
 * Tên kỳ kế tiếp của thử thách lặp lại (khớp private.recur_title, migration 013300):
 * hằng tuần + tên có "tuần <số>" → số tuần của kỳ mới ("Thử thách tuần 41" → "Thử thách tuần 42"); còn lại "<tên> · Kỳ <n>".
 */
export function nextOccurrenceTitle(title: string, recurrence: Recurrence, occurrence: number, nextStart: Date): string {
  const base = title.replace(/\s*·\s*Kỳ \d+$/, '').replace(/\s*[-–]\s*[Ll]ần\s*\d+$/, '')
  const week = /([Tt]uần|TUẦN)(\s*)\d{1,2}(?!\d)/
  if (recurrence === 'WEEKLY' && week.test(base)) return base.replace(week, (_, w: string, sp: string) => `${w}${sp}${isoWeek(nextStart)}`).slice(0, 120)
  return `${base.slice(0, 108)} · Kỳ ${(occurrence || 1) + 1}`
}
/** Giờ bắt đầu kỳ kế tiếp (dời đúng một chu kỳ theo lịch) */
export function nextOccurrenceStart(start: string, recurrence: Exclude<Recurrence, 'NONE'>): Date {
  const d = new Date(start)
  if (recurrence === 'WEEKLY') return new Date(d.getTime() + 7 * DAY)
  const months = recurrence === 'MONTHLY' ? 1 : recurrence === 'QUARTERLY' ? 3 : 12
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes()))
}

/** Mẫu "Thử thách tuần" của CLB: tuần hiện tại (hoặc tuần sau nếu đã quá thứ Tư), các mốc 21/42/60/100 km */
export function weeklyPreset(now: Date, clubId: string): Partial<ChallengeDraft> {
  const next = ((new Date(now.getTime() + 7 * 3_600_000)).getUTCDay() || 7) > 3
  const start = vnMonday(now, next)
  const startIso = (start.getTime() < now.getTime() ? new Date(now.getTime() + 60_000) : start).toISOString()
  return {
    format: 'SOLO_GOAL', objective: 'DISTANCE', title: `Thử thách tuần ${isoWeek(start)}`,
    description: 'Chọn mục tiêu km của bạn cho tuần này. Hoàn thành mục tiêu đã đăng ký là chiến thắng!',
    audience: 'CLUB_ONLY', clubId, rewardSource: 'CLUB', maxSlots: 50,
    start: startIso, end: new Date(start.getTime() + 7 * DAY).toISOString(),
    pledge: { ...DEFAULT_PLEDGE, enabled: true, options: [21, 42, 60, 100], capPct: null },
  }
}

/** Mẫu "Đua đội theo mục tiêu": bắt đầu sau 2 ngày (để đăng ký mục tiêu + chia đội), kéo dài 10 ngày */
export function teamPledgePreset(now: Date, clubId: string): Partial<ChallengeDraft> {
  const start = vnMonday(now, true)
  const s = start.getTime() - now.getTime() < 2 * DAY ? new Date(start.getTime() + 7 * DAY) : start
  return {
    format: 'TEAM', objective: 'DISTANCE', gameMode: 'TEAM_SUM', title: 'Đua đội 10 ngày',
    description: 'Đăng ký mục tiêu km của bạn trước ngày xuất phát. Ban quản trị chia đội để tổng mục tiêu các đội bằng nhau.',
    audience: 'CLUB_ONLY', clubId, rewardSource: 'CLUB', teamSize: 0, maxSlots: 50,
    start: s.toISOString(), end: new Date(s.getTime() + 10 * DAY).toISOString(),
    pledge: { ...DEFAULT_PLEDGE, enabled: true, options: [], minKm: 1, maxKm: 1000, capPct: 20, teamSize: 5 },
  }
}

/** Kiểm tra phần mục tiêu tự đăng ký */
export function validatePledge(p: PledgeDraft): string | null {
  if (!p.enabled) return null
  if (p.options.length) {
    if (p.options.length > 8) return 'Tối đa 8 mục tiêu'
    if (p.options.some((o) => !(o > 0) || o > 5000)) return 'Mục tiêu từ 1 đến 5.000 km'
  } else if (!(p.minKm > 0) || p.maxKm < p.minKm || p.maxKm > 5000) return 'Khoảng mục tiêu không hợp lệ'
  if (p.capPct !== null && (p.capPct < 0 || p.capPct > 500)) return '% vượt từ 0 đến 500'
  return null
}

/** Kiểm tra số người mỗi đội của đua đội theo mục tiêu */
export const validateTeamSize = (n: number) => (Number.isInteger(n) && n >= 2 && n <= 50 ? null : 'Mỗi đội từ 2 đến 50 người')

/** Dữ liệu gửi RPC set_challenge_pledge (team_size chỉ có ở đua đội) */
export const pledgePayload = (p: PledgeDraft, team = false) => ({
  // Đua đội: thành viên tự nhập km bất kỳ (1–1000), không có mốc do người tạo đặt
  options: team ? null : p.options.length ? [...new Set(p.options)].sort((a, b) => a - b) : null,
  min_km: team ? 1 : p.options.length ? null : p.minKm,
  max_km: team ? 1000 : p.options.length ? null : p.maxKm,
  cap_pct: p.capPct,
  team_size: team ? p.teamSize : null,
})

/** Km thật sự được tính cho một người: tối đa mục tiêu × (1 + % vượt) */
export const cappedKm = (km: number, pledge: number | null, capPct: number | null) =>
  pledge && capPct !== null ? Math.min(km, Math.round(pledge * (1 + capPct / 100) * 100) / 100) : km

/** CLB đứng tên tổ chức, quỹ / lượt gói CLB trả phí: nội bộ CLB, hoặc Công khai do ban quản trị chọn CLB tổ chức (014100) */
export const clubOrganizes = (d: Pick<ChallengeDraft, 'format' | 'audience' | 'clubId' | 'personal'>) =>
  !!d.clubId && !(d.format === 'SOLO_GOAL' && d.personal) && (d.audience === 'CLUB_ONLY' || (d.audience === 'PUBLIC' && d.format !== 'DUEL'))

export function defaultDraft(now = new Date(), clubId: string | null = null): ChallengeDraft {
  const start = new Date(now.getTime() + 3_600_000)
  start.setMinutes(0, 0, 0)
  return {
    format: 'COLLECTIVE', title: '', description: '', audience: clubId ? 'CLUB_ONLY' : 'PUBLIC', clubId,
    objective: 'DISTANCE', gameMode: 'TEAM_AVG', targetValue: 0, minKm: 1, minPace: 3, maxPace: 15, dailyCapKm: 0, requireHr: false,
    teamNames: ['Đội Xanh', 'Đội Đỏ'], teamSize: 0, maxSlots: 5,      // ≤ 5 người: miễn phí tạo
    start: start.toISOString(), end: new Date(start.getTime() + 7 * DAY).toISOString(),
    rewardXu: 0, rewardSource: clubId ? 'CLUB' : 'NONE', rewardSplit: 'WINNER',
    pledge: { ...DEFAULT_PLEDGE },
    rules: {},
    recurrence: 'NONE',
    personal: false,
    conquest: { ...DEFAULT_CONQUEST, categories: DEFAULT_CONQUEST.categories.map((c) => ({ ...c })) },
    regDeadline: null,
  }
}

export type DraftErrors = Partial<Record<keyof ChallengeDraft, string>>

/** Kiểm tra theo từng bước wizard (1: loại, 2: luật, 3: thời gian & thưởng) */
export function validateDraft(d: ChallengeDraft, step: 1 | 2 | 3, now = new Date()): DraftErrors {
  const e: DraftErrors = {}
  if (step === 1) {
    const t = d.title.trim()
    if (t.length < 3 || t.length > 120) e.title = 'Tên cần từ 3 đến 120 ký tự'
    if (d.audience === 'CLUB_ONLY' && !d.clubId) e.clubId = 'Chọn CLB tổ chức'
  }
  if (step === 2) {
    const pledge = d.pledge.enabled && pledgeSupported(d)
    if (pledge) { const pe = validatePledge(d.pledge); if (pe) e.pledge = pe }
    if (isConquest(d.objective)) { const ce = validateConquest(d.conquest, d.objective); if (ce) e.conquest = ce }
    else if (!pledge && (d.format === 'SOLO_GOAL' || d.format === 'COLLECTIVE') && !(d.targetValue > 0)) e.targetValue = 'Hãy đặt mục tiêu'
    if (d.targetValue < 0) e.targetValue = 'Mục tiêu không hợp lệ'
    if (d.minKm < 0 || d.minKm > 100) e.minKm = 'Từ 0 đến 100 km'
    if (d.objective === 'STREAK_DAYS' && !(d.minKm > 0)) e.minKm = 'Chuỗi ngày cần cự ly tối thiểu mỗi ngày'
    if (!(d.minPace > 0) || d.maxPace < d.minPace || d.maxPace > 30) e.minPace = 'Khoảng pace không hợp lệ'
    if (d.dailyCapKm < 0) e.dailyCapKm = 'Không hợp lệ'
    if (isTeamPledge(d)) { const te = validateTeamSize(d.pledge.teamSize); if (te) e.teamSize = te }
    else if (d.format === 'TEAM') {
      const names = d.teamNames.map((n) => n.trim()).filter(Boolean)
      if (names.length < 2 || names.length > 8) e.teamNames = 'Cần từ 2 đến 8 đội'
      else if (new Set(names.map((n) => n.toLocaleLowerCase('vi'))).size !== names.length) e.teamNames = 'Tên đội bị trùng'
      else if (names.some((n) => n.length > 40)) e.teamNames = 'Tên đội tối đa 40 ký tự'
    }
  }
  if (step === 3) {
    const s = Date.parse(d.start), en = Date.parse(d.end)
    if (Number.isNaN(s) || Number.isNaN(en) || en <= s) e.end = 'Thời gian kết thúc phải sau bắt đầu'
    else if (en - s < 3_600_000) e.end = 'Thử thách cần kéo dài ít nhất 1 giờ'
    else if (en - s > 366 * DAY) e.end = 'Tối đa 1 năm'
    else if (en <= now.getTime()) e.end = 'Thời gian kết thúc đã qua'
    if (d.format === 'TEAM' && s < now.getTime() + 10 * 60_000) e.start = 'Thử thách đội cần bắt đầu sau ít nhất 10 phút để mọi người chọn đội'
    if (d.objective === 'STREAK_DAYS' && d.targetValue > Math.ceil((en - s) / DAY)) e.targetValue = 'Số ngày chuỗi dài hơn thời gian thử thách'
    if (d.rewardXu < 0 || d.rewardXu > 100_000) e.rewardXu = 'Từ 0 đến 100.000 Xu'
    if (d.regDeadline) {
      const r = Date.parse(d.regDeadline)
      if (Number.isNaN(r) || r > en || r < now.getTime()) e.regDeadline = 'Hạn đăng ký phải từ bây giờ đến trước khi kết thúc'
      else if (d.format === 'TEAM' && r > s) e.regDeadline = 'Thử thách đội: hạn đăng ký trước giờ xuất phát'
    }
    if (d.format !== 'DUEL' && (d.maxSlots < 2 || d.maxSlots > 10_000) && d.format !== 'SOLO_GOAL') e.maxSlots = 'Từ 2 đến 10.000 người'
  }
  return e
}

/** Số người tối đa thực tế (máy chủ tính phí theo số này) */
export function effectiveSlots(d: Pick<ChallengeDraft, 'format' | 'maxSlots' | 'teamSize' | 'teamNames'> & { pledge?: PledgeDraft; personal?: boolean }): number {
  if (d.format === 'DUEL') return 2
  if (d.format === 'SOLO_GOAL') return d.personal ? 1 : d.maxSlots
  if (d.format === 'TEAM' && d.pledge?.enabled) return d.maxSlots
  if (d.format === 'TEAM' && d.teamSize > 0) {
    const teams = d.teamNames.filter((t) => t.trim()).length
    return Math.min(d.maxSlots, d.teamSize * Math.max(teams, 1))
  }
  return d.maxSlots
}

/** Dữ liệu gửi lên RPC create_challenge_v2 */
export function draftToPayload(d: ChallengeDraft) {
  const pledge = d.pledge?.enabled && pledgeSupported(d)
  const conquest = isConquest(d.objective)
  // "Cộng đồng" không đặt mốc chung = đua xếp hạng
  const format: ChallengeFormat = d.format === 'COLLECTIVE' && !(d.targetValue > 0) ? 'RANKED' : d.format
  return {
    title: d.title.trim(),
    description: d.description.trim(),
    format,
    // Chinh phục: tạo như thử thách km rồi bật hạng mục ngay sau khi tạo (set_challenge_conquest)
    objective: conquest ? 'DISTANCE' : d.objective,
    game_mode: d.format === 'TEAM' ? (pledge ? 'TEAM_SUM' : d.gameMode) : null,
    // Mục tiêu tự đăng ký: mục tiêu chung chỉ là mốc thấp nhất (máy chủ yêu cầu > 0 với thử thách cá nhân)
    target_value: conquest ? 1 : pledge ? (d.format === 'SOLO_GOAL' ? Math.min(...(d.pledge.options.length ? d.pledge.options : [d.pledge.minKm])) : 0) : d.targetValue || 0,
    min_km: d.minKm,
    min_pace: d.minPace,
    max_pace: d.maxPace,
    daily_cap_km: d.dailyCapKm || null,
    start_date: d.start,
    end_date: d.end,
    max_slots: effectiveSlots(d),
    // "Cá nhân tôi": ẩn khỏi Khám phá, chỉ mình mình
    audience: d.format === 'SOLO_GOAL' && d.personal ? 'INVITE_ONLY' : d.format === 'DUEL' && d.audience === 'PUBLIC' ? 'INVITE_ONLY' : d.audience,
    club_id: clubOrganizes(d) ? d.clubId : null,
    // Đua đội theo mục tiêu: 2 đội tạm, máy chủ tạo lại đúng số đội khi ban quản trị chia đội
    team_names: d.format === 'TEAM' ? (pledge ? ['Đội 1', 'Đội 2'] : d.teamNames.map((n) => n.trim()).filter(Boolean)) : [],
    team_size: d.format === 'TEAM' && !pledge ? d.teamSize : 0,
    reward_xu: d.rewardXu || 0,
    reward_source: d.rewardXu > 0 ? d.rewardSource : 'NONE',
    reward_split: format === 'RANKED' ? d.rewardSplit : 'WINNER',
  }
}

/** Mô tả phần thưởng cho người xem */
export function rewardSummary(c: { reward_xu?: number | string | null; reward_split?: string | null; format?: string | null }) {
  const x = Number(c.reward_xu ?? 0)
  if (x <= 0) return null
  const amount = `${nf1.format(x)} Xu`
  switch (c.reward_split) {
    case 'TOP3': return `${amount} cho Top 3 (50% · 30% · 20%)`
    case 'FINISHERS': return c.format === 'COLLECTIVE' ? `${amount} chia đều khi cả cộng đồng đạt mục tiêu` : `${amount} chia đều cho người hoàn thành`
    case 'TEAM': return `${amount} chia đều cho đội thắng`
    default: return `${amount} cho người về nhất`
  }
}

/** Dựng bản nháp từ một thử thách cũ (mẫu): giữ luật chơi, dời thời gian về từ giờ tới + đúng số ngày cũ */
export function draftFromTemplate(t: {
  title: string; description: string | null; format: string; objective: string | null; game_mode: string | null; target_value: number | string
  min_km: number | string | null; min_pace: number | string | null; max_pace: number | string | null; daily_cap_km: number | string | null
  require_hr: boolean; max_slots: number; audience: string; club_id: string | null; team_size: number | null; reward_xu: number | string
  reward_split: string | null; days: number
  pledge: { enabled: boolean; options: (number | string)[]; min_km: number | string | null; max_km: number | string | null; cap_pct: number | string | null; team_size: number | null }
  team_names: string[]
  rules_info?: RulesInfoDraft | null
}, allowedClubs: string[], now = new Date()): ChallengeDraft {
  const base = defaultDraft(now, null)
  const num = (v: unknown, d: number) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? d : Number(v))
  const format = (['SOLO_GOAL', 'RANKED', 'TEAM', 'DUEL', 'COLLECTIVE'] as string[]).includes(t.format) ? (t.format as ChallengeFormat) : base.format
  const club = t.audience === 'CLUB_ONLY' && t.club_id && allowedClubs.includes(t.club_id) ? t.club_id : null
  const start = new Date(base.start)
  return {
    ...base, format, title: t.title, description: t.description ?? '',
    audience: club ? 'CLUB_ONLY' : t.audience === 'INVITE_ONLY' ? 'INVITE_ONLY' : 'PUBLIC', clubId: club,
    objective: isConquest(t.objective) ? 'DISTANCE' : (t.objective as Objective) ?? base.objective, gameMode: (t.game_mode as TeamMode) ?? base.gameMode,
    targetValue: num(t.target_value, 0), minKm: num(t.min_km, base.minKm), minPace: num(t.min_pace, base.minPace), maxPace: num(t.max_pace, base.maxPace),
    dailyCapKm: num(t.daily_cap_km, 0), requireHr: !!t.require_hr,
    teamNames: t.team_names.length ? t.team_names : base.teamNames, teamSize: num(t.team_size, 0), maxSlots: num(t.max_slots, base.maxSlots),
    end: new Date(start.getTime() + Math.max(1, num(t.days, 7)) * DAY).toISOString(),
    rewardXu: club ? num(t.reward_xu, 0) : 0, rewardSource: club ? 'CLUB' : 'NONE',
    rewardSplit: t.reward_split === 'TOP3' ? 'TOP3' : 'WINNER',
    pledge: t.pledge?.enabled ? {
      enabled: true, options: (t.pledge.options ?? []).map(Number), minKm: num(t.pledge.min_km, DEFAULT_PLEDGE.minKm),
      maxKm: num(t.pledge.max_km, DEFAULT_PLEDGE.maxKm), capPct: t.pledge.cap_pct === null ? null : num(t.pledge.cap_pct, 20),
      teamSize: num(t.pledge.team_size, DEFAULT_PLEDGE.teamSize),
    } : { ...DEFAULT_PLEDGE },
    rules: t.rules_info ?? {},
    personal: format === 'SOLO_GOAL' && t.max_slots <= 1,
  }
}

/** Bảng xếp hạng thử thách → Excel cho CLB Pro: sheet thông tin chung, sheet xếp hạng cá nhân, thêm sheet đội nếu có */
export function challengeXlsxSheets(
  c: { title: string; objective: Objective | string; start_date: string; end_date: string; target_value: number | string },
  rows: LeaderboardEntry[], teams: TeamStanding[] = [],
): XlsxSheet[] {
  const unit = OBJECTIVE_META[c.objective as Objective]?.unit ?? 'km'
  const date = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('vi-VN') : '')
  const teamName = new Map(teams.map((t) => [t.team_id, t.name]))
  const hasTeam = teams.length > 0
  const sheets: XlsxSheet[] = [
    {
      name: 'Thông tin',
      head: ['Mục', 'Giá trị'],
      rows: [
        ['Thử thách', c.title], ['Thời gian', `${date(c.start_date)} - ${date(c.end_date)}`],
        ['Mục tiêu', Number(c.target_value) > 0 ? formatScore(c.objective, c.target_value) : ''],
        ['Số người tham gia', rows.length], ['Số người hoàn thành', rows.filter((r) => r.completed_at).length],
      ],
      widths: [22, 40],
    },
    {
      name: 'Xếp hạng',
      head: ['Hạng', 'Họ tên', ...(hasTeam ? ['Đội'] : []), `Điểm (${unit})`, 'Quãng đường (km)', 'Số buổi chạy', 'Thời gian chạy (phút)', 'Số ngày chạy', 'Hoàn thành', 'Thưởng (Xu)'],
      rows: rows.map((r) => [
        r.rank, r.display_name, ...(hasTeam ? [r.team_id ? teamName.get(r.team_id) ?? '' : ''] : []),
        Number(r.score) || 0, Math.round(Number(r.distance_m) / 10) / 100, r.run_count, Math.round(Number(r.moving_s) / 60),
        r.streak_days, r.completed_at ? date(r.completed_at) : '', r.reward_xu || '',
      ]),
    },
  ]
  if (hasTeam) {
    sheets.push({
      name: 'Đội',
      head: ['Hạng', 'Đội', 'Thành viên', 'Đang hoạt động', 'Tổng', 'Điểm'],
      rows: teams.map((t, i) => [t.rank ?? i + 1, t.name, t.members, t.active_members, Number(t.total) || 0, Number(t.score) || 0]),
    })
  }
  return sheets
}
