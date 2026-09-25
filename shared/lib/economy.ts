// Chính sách kinh tế dùng chung (mirror của private.economy_config — migration 003700, Baseline v1.1).
// Máy chủ luôn là nguồn đúng; ở đây chỉ để hiển thị trước và cho admin mô phỏng.

export interface RunTier { upToKm: number; rate: number }
export interface RunPolicy { freeKm: number; dailyCap: number; tiers: RunTier[] }
export interface CapacityTier { max: number; xu: number }
export interface StreakReward { weeks: number; xu: number }
export interface ReferralPolicy { inviterXu: number; refereeXu: number; monthlyCap: number; minKm: number }
export interface ComebackPolicy { minRestDays: number; xu: number; cooldownDays: number }
export interface GamePolicy { shieldPrice: number; maxShields: number; defaultWeeklyGoal: number }

export interface EconomyPolicy {
  xuVnd: number                        // quy ước: 1 Xu = xuVnd đồng (không đổi ra tiền mặt)
  xpPerKm: number
  run: RunPolicy
  checkinXu: number                    // +Xu khi có bài chạy hợp lệ trong ngày
  checkinMinKm: number
  giftDailyCapXu: number
  streakRewards: StreakReward[]        // mốc chuỗi tuần liên tiếp
  referral: ReferralPolicy
  comeback: ComebackPolicy             // thưởng quay lại sau nghỉ dài (không hạ cấp)
  levelUpXu: Record<string, number>    // "2": 20 …
  capacityTiers: CapacityTier[]        // phí tạo thử thách / giải theo quy mô
  game: GamePolicy
}

export const DEFAULT_POLICY: EconomyPolicy = {
  xuVnd: 100,
  xpPerKm: 10,
  run: { freeKm: 2, dailyCap: 20, tiers: [{ upToKm: 10, rate: 2 }, { upToKm: 20, rate: 1 }] },
  checkinXu: 1,
  checkinMinKm: 1,
  giftDailyCapXu: 20000,
  streakRewards: [{ weeks: 2, xu: 10 }, { weeks: 4, xu: 20 }, { weeks: 8, xu: 50 }],
  referral: { inviterXu: 20, refereeXu: 10, monthlyCap: 10, minKm: 3 },
  comeback: { minRestDays: 28, xu: 10, cooldownDays: 90 },
  levelUpXu: { 2: 20, 3: 50, 4: 100, 5: 200, 6: 300, 7: 500, 8: 1000 },
  capacityTiers: [
    { max: 5, xu: 0 }, { max: 20, xu: 150 }, { max: 50, xu: 400 }, { max: 100, xu: 800 },
    { max: 200, xu: 1500 }, { max: 500, xu: 3500 }, { max: 1000, xu: 7000 },
  ],
  game: { shieldPrice: 200, maxShields: 2, defaultWeeklyGoal: 3 },
}

const n = (v: unknown, fallback: number) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? fallback : Number(v))
const arr = <T,>(v: unknown, map: (x: Record<string, unknown>) => T, fallback: T[]): T[] =>
  Array.isArray(v) ? v.map((x) => map((x ?? {}) as Record<string, unknown>)) : fallback

/** Chuẩn hóa JSON từ DB (thiếu khóa thì lấy mặc định) */
export function toPolicy(raw: unknown): EconomyPolicy {
  const r = (raw ?? {}) as Record<string, unknown>
  const d = DEFAULT_POLICY
  const run = (r.run ?? {}) as Record<string, unknown>
  const ref = (r.referral ?? {}) as Record<string, unknown>
  const game = (r.game ?? {}) as Record<string, unknown>
  const cb = (r.comeback ?? {}) as Record<string, unknown>
  return {
    xuVnd: n(r.xuVnd, d.xuVnd),
    xpPerKm: n(r.xpPerKm, d.xpPerKm),
    run: {
      freeKm: n(run.freeKm, d.run.freeKm), dailyCap: n(run.dailyCap, d.run.dailyCap),
      tiers: arr(run.tiers, (t) => ({ upToKm: n(t.upToKm, 0), rate: n(t.rate, 0) }), d.run.tiers),
    },
    checkinXu: n(r.checkinXu, d.checkinXu),
    checkinMinKm: n(r.checkinMinKm, d.checkinMinKm),
    giftDailyCapXu: n(r.giftDailyCapXu, d.giftDailyCapXu),
    streakRewards: arr(r.streakRewards, (t) => ({ weeks: n(t.weeks, 0), xu: n(t.xu, 0) }), d.streakRewards),
    referral: {
      inviterXu: n(ref.inviterXu, d.referral.inviterXu), refereeXu: n(ref.refereeXu, d.referral.refereeXu),
      monthlyCap: n(ref.monthlyCap, d.referral.monthlyCap), minKm: n(ref.minKm, d.referral.minKm),
    },
    comeback: { minRestDays: n(cb.minRestDays, d.comeback.minRestDays), xu: n(cb.xu, d.comeback.xu), cooldownDays: n(cb.cooldownDays, d.comeback.cooldownDays) },
    levelUpXu: r.levelUpXu && typeof r.levelUpXu === 'object'
      ? Object.fromEntries(Object.entries(r.levelUpXu as Record<string, unknown>).map(([k, v]) => [k, n(v, 0)])) : { ...d.levelUpXu },
    capacityTiers: arr(r.capacityTiers, (t) => ({ max: n(t.max, 0), xu: n(t.xu, 0) }), d.capacityTiers).sort((a, b) => a.max - b.max),
    game: { shieldPrice: n(game.shieldPrice, d.game.shieldPrice), maxShields: n(game.maxShields, d.game.maxShields),
            defaultWeeklyGoal: n(game.defaultWeeklyGoal, d.game.defaultWeeklyGoal) },
  }
}

/** Xu lũy kế cho tổng `km` chạy trong ngày theo bậc thang (chưa áp trần) */
export function runXuForKm(km: number, run: RunPolicy = DEFAULT_POLICY.run): number {
  let lower = run.freeKm, acc = 0
  for (const t of [...run.tiers].sort((a, b) => a.upToKm - b.upToKm)) {
    if (t.upToKm <= lower) continue
    acc += Math.max(Math.min(km, t.upToKm) - lower, 0) * t.rate
    lower = t.upToKm
  }
  return acc
}

/** Xu của một bài chạy `km` khi hôm nay đã chạy `prevKm` và đã nhận `todayXu` từ chạy */
export function runReward(km: number, p: EconomyPolicy = DEFAULT_POLICY, prevKm = 0, todayXu = 0): number {
  const raw = runXuForKm(prevKm + km, p.run) - runXuForKm(prevKm, p.run)
  return Math.round(Math.max(Math.min(raw, p.run.dailyCap - todayXu), 0) * 10) / 10
}

/** Mức quy mô cho `slots` người; null = vượt mức lớn nhất (admin cấp riêng) */
export function capacityTier(slots: number, tiers: CapacityTier[] = DEFAULT_POLICY.capacityTiers): CapacityTier | null {
  const s = Math.max(1, Math.floor(slots || 1))
  return [...tiers].sort((a, b) => a.max - b.max).find((t) => t.max >= s) ?? null
}

/** Phí tạo thử thách / giải cho `slots` người (không phụ thuộc thời gian); null = liên hệ admin */
export function creationFee(slots: number, tiers: CapacityTier[] = DEFAULT_POLICY.capacityTiers): number | null {
  return capacityTier(slots, tiers)?.xu ?? null
}

/** Mô tả biểu phí ngắn gọn, ví dụ "≤5 người miễn phí · ≤20: 150 Xu · …" */
export function feePolicyText(tiers: CapacityTier[]): string {
  return [...tiers].sort((a, b) => a.max - b.max)
    .map((t) => (t.xu === 0 ? `≤${fmt(t.max)} người miễn phí` : `≤${fmt(t.max)}: ${fmt(t.xu)} Xu`)).join(' · ')
}

/** Mô tả thưởng chạy, ví dụ "km 1–2: 0 · km 3–10: 2 Xu/km · km 11–20: 1 Xu/km · tối đa 20 Xu/ngày" */
export function runPolicyText(run: RunPolicy): string {
  let lower = run.freeKm
  const parts = run.freeKm > 0 ? [`km 1–${fmt(run.freeKm)}: 0`] : []
  for (const t of [...run.tiers].sort((a, b) => a.upToKm - b.upToKm)) {
    if (t.upToKm <= lower) continue
    parts.push(`km ${fmt(Math.floor(lower) + 1)}–${fmt(t.upToKm)}: ${fmt(t.rate)} Xu/km`)
    lower = t.upToKm
  }
  return [...parts, `từ km ${fmt(Math.floor(lower) + 1)}: 0`, `tối đa ${fmt(run.dailyCap)} Xu/ngày`].join(' · ')
}

const vnd = new Intl.NumberFormat('vi-VN')
const fmt = (v: number) => vnd.format(v)
/** Quy đổi tham chiếu sang tiền đồng: 150 Xu → "≈ 15.000đ" */
export const xuToVnd = (xu: number, p: Pick<EconomyPolicy, 'xuVnd'> = DEFAULT_POLICY) => `≈ ${vnd.format(Math.round(xu * p.xuVnd))}đ`
export const formatVnd = (v: number) => `${vnd.format(Math.round(v))}đ`

/** 8 cấp độ (XP chỉ từ km chạy: 10 XP/km) */
export const LEVELS = [
  { level: 1, name: 'Tân Binh', en: 'Novice', minXp: 0 },
  { level: 2, name: 'Runner Triển Vọng', en: 'Riser', minXp: 1000 },
  { level: 3, name: 'Chân Chạy Kiên Trì', en: 'Striver', minXp: 5000 },
  { level: 4, name: 'Chiến Binh Đường Nhựa', en: 'Warrior', minXp: 15000 },
  { level: 5, name: 'Cao Thủ Sức Bền', en: 'Master', minXp: 35000 },
  { level: 6, name: 'Quái Vật Cự Ly', en: 'Beast', minXp: 70000 },
  { level: 7, name: 'Huyền Thoại', en: 'Legend', minXp: 120000 },
  { level: 8, name: 'Đỉnh Cao RaceHub', en: 'Apex', minXp: 200000 },
] as const

export function levelFor(xp: number) {
  return [...LEVELS].reverse().find((l) => xp >= l.minXp) ?? LEVELS[0]
}

/** Tiến độ tới cấp sau: { current, next, pct, need } — next = null ở cấp cao nhất */
export function levelProgress(xp: number) {
  const current = levelFor(xp)
  const next = LEVELS.find((l) => l.level === current.level + 1) ?? null
  if (!next) return { current, next, pct: 100, need: 0 }
  return { current, next, pct: Math.min(100, Math.round(((xp - current.minXp) / (next.minXp - current.minXp)) * 100)), need: next.minXp - xp }
}

/** Kiểm tra cấu hình trước khi admin lưu (máy chủ kiểm tra lại) */
export function validatePolicy(p: EconomyPolicy): string | null {
  if (!(p.xuVnd >= 1 && p.xuVnd <= 1_000_000)) return 'Giá trị 1 Xu phải từ 1 đến 1.000.000 đồng.'
  if (!(p.xpPerKm >= 0 && p.xpPerKm <= 1000)) return 'XP mỗi km phải từ 0 đến 1.000.'
  if (!(p.run.freeKm >= 0 && p.run.freeKm <= 100)) return 'Số km không tính Xu phải từ 0 đến 100.'
  if (!(p.run.dailyCap >= 0 && p.run.dailyCap <= 100000)) return 'Trần Xu chạy mỗi ngày không hợp lệ.'
  if (p.run.tiers.some((t) => !(t.upToKm > 0 && t.upToKm <= 1000 && t.rate >= 0 && t.rate <= 1000))) return 'Bậc thưởng km không hợp lệ.'
  if (!(p.checkinXu >= 0 && p.checkinXu <= 10000)) return 'Xu điểm danh không hợp lệ.'
  const tiers = [...p.capacityTiers].sort((a, b) => a.max - b.max)
  if (!tiers.length) return 'Cần ít nhất một mức quy mô.'
  if (tiers.some((t) => !(Number.isInteger(t.max) && t.max >= 1 && t.xu >= 0))) return 'Mức quy mô phải là số người nguyên ≥ 1 và phí ≥ 0.'
  if (new Set(tiers.map((t) => t.max)).size !== tiers.length) return 'Hai mức quy mô bị trùng số người.'
  if (p.streakRewards.some((s) => !(Number.isInteger(s.weeks) && s.weeks >= 1 && s.xu >= 0))) return 'Mốc chuỗi tuần không hợp lệ.'
  if (!(p.referral.inviterXu >= 0 && p.referral.refereeXu >= 0 && p.referral.monthlyCap >= 0 && p.referral.minKm >= 0)) return 'Thưởng giới thiệu không hợp lệ.'
  if (!(p.game.shieldPrice >= 0)) return 'Giá khiên không hợp lệ.'
  if (!(p.comeback.minRestDays >= 7 && p.comeback.minRestDays <= 365 && p.comeback.xu >= 0 && p.comeback.cooldownDays >= 0)) return 'Thưởng quay lại không hợp lệ (nghỉ tối thiểu 7–365 ngày).'
  return null
}
