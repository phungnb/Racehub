// Logic thuần của thử thách: nhãn, định dạng điểm, tiến độ theo kế hoạch, kiểm tra dữ liệu tạo mới.
// Luật tính điểm thật nằm ở DB (migration 000600) — file này chỉ để hiển thị và kiểm tra sớm ở client.

export type ChallengePhase = 'UPCOMING' | 'LIVE' | 'SETTLING' | 'ENDED' | 'CANCELLED'
export type ChallengeFormat = 'SOLO_GOAL' | 'RANKED' | 'DUEL' | 'TEAM' | 'COLLECTIVE'
export type Objective = 'DISTANCE' | 'RUNS' | 'DURATION' | 'STREAK_DAYS'
export type TeamMode = 'TEAM_SUM' | 'TEAM_AVG' | 'TEAM_GAP' | 'LAST_MEMBER'
export type Audience = 'PUBLIC' | 'CLUB_ONLY' | 'INVITE_ONLY'
export type RewardSource = 'NONE' | 'CREATOR' | 'CLUB'
export type RewardSplit = 'WINNER' | 'TOP3' | 'FINISHERS' | 'TEAM'

export const FORMAT_META: Record<ChallengeFormat, { label: string; short: string; description: string }> = {
  SOLO_GOAL: { label: 'Mục tiêu cá nhân', short: 'Cá nhân', description: 'Tự đặt mục tiêu (VD: 100 km tháng này) và chinh phục nó' },
  RANKED: { label: 'Đua xếp hạng', short: 'Xếp hạng', description: 'Mọi người cùng chạy, ai nhiều nhất đứng đầu BXH' },
  DUEL: { label: 'Thách đấu 1-1', short: '1-1', description: 'Rủ một người bạn so tài, ai hơn thì thắng' },
  TEAM: { label: 'Đồng đội', short: 'Đồng đội', description: 'Chia đội thi đấu, tính điểm theo cả đội' },
  COLLECTIVE: { label: 'Cộng đồng', short: 'Cộng đồng', description: 'Tất cả cùng góp km để đạt một mốc chung' },
}

export const OBJECTIVE_META: Record<Objective, { label: string; unit: string; hint: string }> = {
  DISTANCE: { label: 'Quãng đường', unit: 'km', hint: 'Cộng dồn số km chạy' },
  RUNS: { label: 'Số buổi chạy', unit: 'buổi', hint: 'Mỗi bài chạy hợp lệ tính 1 buổi' },
  DURATION: { label: 'Thời gian chạy', unit: 'phút', hint: 'Cộng dồn thời gian di chuyển' },
  STREAK_DAYS: { label: 'Chuỗi ngày', unit: 'ngày', hint: 'Số ngày chạy đủ cự ly tối thiểu trong ngày' },
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
}

export interface PledgeDraft {
  enabled: boolean
  /** Các mốc cho chọn (km). Rỗng = nhập tự do trong khoảng min–max */
  options: number[]
  minKm: number
  maxKm: number
  /** Được tính vượt mục tiêu tối đa bao nhiêu % (null = không giới hạn) */
  capPct: number | null
}

export const DEFAULT_PLEDGE: PledgeDraft = { enabled: false, options: [21, 42, 60, 100], minKm: 10, maxKm: 300, capPct: 20 }

/** Thử thách này có hỗ trợ mục tiêu tự đăng ký không (chỉ tính quãng đường, cá nhân hoặc đồng đội) */
export const pledgeSupported = (d: Pick<ChallengeDraft, 'format' | 'objective'>) =>
  d.objective === 'DISTANCE' && (d.format === 'SOLO_GOAL' || d.format === 'TEAM')

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

/** Mẫu "Thử thách tuần" của CLB: tuần hiện tại (hoặc tuần sau nếu đã quá thứ Tư), các mốc 21/42/60/100 km */
export function weeklyPreset(now: Date, clubId: string): Partial<ChallengeDraft> {
  const next = ((new Date(now.getTime() + 7 * 3_600_000)).getUTCDay() || 7) > 3
  const start = vnMonday(now, next)
  const startIso = (start.getTime() < now.getTime() ? new Date(now.getTime() + 60_000) : start).toISOString()
  return {
    format: 'SOLO_GOAL', objective: 'DISTANCE', title: `Thử thách tuần ${isoWeek(start)}`,
    description: 'Chọn mốc km của bạn cho tuần này. Hoàn thành mốc đã đăng ký là chiến thắng!',
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
    audience: 'CLUB_ONLY', clubId, rewardSource: 'CLUB', teamNames: ['Đội Xanh', 'Đội Đỏ'], teamSize: 0, maxSlots: 50,
    start: s.toISOString(), end: new Date(s.getTime() + 10 * DAY).toISOString(),
    pledge: { ...DEFAULT_PLEDGE, enabled: true, options: [], minKm: 10, maxKm: 300, capPct: 20 },
  }
}

/** Kiểm tra phần mục tiêu tự đăng ký */
export function validatePledge(p: PledgeDraft): string | null {
  if (!p.enabled) return null
  if (p.options.length) {
    if (p.options.length > 8) return 'Tối đa 8 mốc'
    if (p.options.some((o) => !(o > 0) || o > 5000)) return 'Mốc từ 1 đến 5.000 km'
  } else if (!(p.minKm > 0) || p.maxKm < p.minKm || p.maxKm > 5000) return 'Khoảng mục tiêu không hợp lệ'
  if (p.capPct !== null && (p.capPct < 0 || p.capPct > 500)) return '% vượt từ 0 đến 500'
  return null
}

/** Dữ liệu gửi RPC set_challenge_pledge */
export const pledgePayload = (p: PledgeDraft) => ({
  options: p.options.length ? [...new Set(p.options)].sort((a, b) => a - b) : null,
  min_km: p.options.length ? null : p.minKm,
  max_km: p.options.length ? null : p.maxKm,
  cap_pct: p.capPct,
})

/** Km thật sự được tính cho một người: tối đa mục tiêu × (1 + % vượt) */
export const cappedKm = (km: number, pledge: number | null, capPct: number | null) =>
  pledge && capPct !== null ? Math.min(km, Math.round(pledge * (1 + capPct / 100) * 100) / 100) : km

export function defaultDraft(now = new Date(), clubId: string | null = null): ChallengeDraft {
  const start = new Date(now.getTime() + 3_600_000)
  start.setMinutes(0, 0, 0)
  return {
    format: 'RANKED', title: '', description: '', audience: clubId ? 'CLUB_ONLY' : 'PUBLIC', clubId,
    objective: 'DISTANCE', gameMode: 'TEAM_AVG', targetValue: 0, minKm: 1, minPace: 3, maxPace: 15, dailyCapKm: 0,
    teamNames: ['Đội Xanh', 'Đội Đỏ'], teamSize: 0, maxSlots: 5,      // ≤ 5 người: miễn phí tạo
    start: start.toISOString(), end: new Date(start.getTime() + 7 * DAY).toISOString(),
    rewardXu: 0, rewardSource: clubId ? 'CLUB' : 'CREATOR', rewardSplit: 'WINNER',
    pledge: { ...DEFAULT_PLEDGE },
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
    if (!pledge && (d.format === 'SOLO_GOAL' || d.format === 'COLLECTIVE') && !(d.targetValue > 0)) e.targetValue = 'Hãy đặt mục tiêu'
    if (d.targetValue < 0) e.targetValue = 'Mục tiêu không hợp lệ'
    if (d.minKm < 0 || d.minKm > 100) e.minKm = 'Từ 0 đến 100 km'
    if (d.objective === 'STREAK_DAYS' && !(d.minKm > 0)) e.minKm = 'Chuỗi ngày cần cự ly tối thiểu mỗi ngày'
    if (!(d.minPace > 0) || d.maxPace < d.minPace || d.maxPace > 30) e.minPace = 'Khoảng pace không hợp lệ'
    if (d.dailyCapKm < 0) e.dailyCapKm = 'Không hợp lệ'
    if (d.format === 'TEAM') {
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
    if (d.format !== 'DUEL' && (d.maxSlots < 2 || d.maxSlots > 10_000) && d.format !== 'SOLO_GOAL') e.maxSlots = 'Từ 2 đến 10.000 người'
  }
  return e
}

/** Số người tối đa thực tế (máy chủ tính phí theo số này) */
export function effectiveSlots(d: Pick<ChallengeDraft, 'format' | 'maxSlots' | 'teamSize' | 'teamNames'> & { pledge?: PledgeDraft }): number {
  if (d.format === 'DUEL') return 2
  if (d.format === 'SOLO_GOAL') return d.pledge?.enabled ? d.maxSlots : 1
  if (d.format === 'TEAM' && d.teamSize > 0) {
    const teams = d.teamNames.filter((t) => t.trim()).length
    return Math.min(d.maxSlots, d.teamSize * Math.max(teams, 1))
  }
  return d.maxSlots
}

/** Dữ liệu gửi lên RPC create_challenge_v2 */
export function draftToPayload(d: ChallengeDraft) {
  const pledge = d.pledge?.enabled && pledgeSupported(d)
  return {
    title: d.title.trim(),
    description: d.description.trim(),
    format: d.format,
    objective: d.objective,
    game_mode: d.format === 'TEAM' ? (pledge ? 'TEAM_SUM' : d.gameMode) : null,
    // Mục tiêu tự đăng ký: mục tiêu chung chỉ là mốc thấp nhất (máy chủ yêu cầu > 0 với thử thách cá nhân)
    target_value: pledge ? (d.format === 'SOLO_GOAL' ? Math.min(...(d.pledge.options.length ? d.pledge.options : [d.pledge.minKm])) : 0) : d.targetValue || 0,
    min_km: d.minKm,
    min_pace: d.minPace,
    max_pace: d.maxPace,
    daily_cap_km: d.dailyCapKm || null,
    start_date: d.start,
    end_date: d.end,
    max_slots: effectiveSlots(d),
    audience: d.format === 'DUEL' && d.audience === 'PUBLIC' ? 'INVITE_ONLY' : d.audience,
    club_id: d.audience === 'CLUB_ONLY' ? d.clubId : null,
    team_names: d.format === 'TEAM' ? d.teamNames.map((n) => n.trim()).filter(Boolean) : [],
    team_size: d.format === 'TEAM' ? d.teamSize : 0,
    reward_xu: d.rewardXu || 0,
    reward_source: d.rewardXu > 0 ? d.rewardSource : 'NONE',
    reward_split: d.format === 'RANKED' ? d.rewardSplit : 'WINNER',
  }
}

/** Mô tả phần thưởng cho người xem */
export function rewardSummary(c: { reward_xu?: number | string | null; reward_split?: string | null; format?: string | null }) {
  const x = Number(c.reward_xu ?? 0)
  if (x <= 0) return null
  const amount = `${nf1.format(x)} Xu`
  switch (c.reward_split) {
    case 'TOP3': return `${amount} cho Top 3 (50% · 30% · 20%)`
    case 'FINISHERS': return c.format === 'COLLECTIVE' ? `${amount} chia đều khi cả cộng đồng đạt mốc` : `${amount} chia đều cho người hoàn thành`
    case 'TEAM': return `${amount} chia đều cho đội thắng`
    default: return `${amount} cho người về nhất`
  }
}
