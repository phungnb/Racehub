// Chính sách Xu dùng chung (mirror của private.economy_config / challenge_creation_fee, migration 000700).
// Máy chủ luôn là nguồn đúng; ở đây chỉ để hiển thị trước và cho admin mô phỏng.

export interface ChallengeFeePolicy {
  freeMaxSlots: number      // ≤ số này: miễn phí
  midMaxSlots: number       // ≤ số này: tính midRatePerSlot
  midRatePerSlot: number    // Xu / người
  ratePerSlot: number       // Xu / người khi vượt midMaxSlots
}

export interface EconomyPolicy {
  xuVnd: number             // giá trị tham chiếu: 1 Xu ≈ xuVnd đồng
  firstKmXu: number         // Xu cho km đầu tiên của bài chạy
  extraKmXu: number         // Xu cho mỗi km tiếp theo
  maxDailyReward: number    // trần Xu từ chạy mỗi ngày
  challengeFee: ChallengeFeePolicy
}

export const DEFAULT_POLICY: EconomyPolicy = {
  xuVnd: 1000,
  firstKmXu: 1,
  extraKmXu: 0.2,
  maxDailyReward: 10,
  challengeFee: { freeMaxSlots: 5, midMaxSlots: 10, midRatePerSlot: 3, ratePerSlot: 5 },
}

const n = (v: unknown, fallback: number) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? fallback : Number(v))

/** Chuẩn hóa JSON từ DB (thiếu khóa thì lấy mặc định) */
export function toPolicy(raw: unknown): EconomyPolicy {
  const r = (raw ?? {}) as Record<string, unknown>
  const f = (r.challengeFee ?? {}) as Record<string, unknown>
  const d = DEFAULT_POLICY
  return {
    xuVnd: n(r.xuVnd, d.xuVnd),
    firstKmXu: n(r.firstKmXu, d.firstKmXu),
    extraKmXu: n(r.extraKmXu, d.extraKmXu),
    maxDailyReward: n(r.maxDailyReward, d.maxDailyReward),
    challengeFee: {
      freeMaxSlots: n(f.freeMaxSlots, d.challengeFee.freeMaxSlots),
      midMaxSlots: n(f.midMaxSlots, d.challengeFee.midMaxSlots),
      midRatePerSlot: n(f.midRatePerSlot, d.challengeFee.midRatePerSlot),
      ratePerSlot: n(f.ratePerSlot, d.challengeFee.ratePerSlot),
    },
  }
}

/** Phí tạo thử thách cho `slots` người tối đa */
export function creationFee(slots: number, f: ChallengeFeePolicy = DEFAULT_POLICY.challengeFee): number {
  const s = Math.max(1, Math.floor(slots || 1))
  if (s <= f.freeMaxSlots) return 0
  if (s <= f.midMaxSlots) return Math.ceil(s * f.midRatePerSlot)
  return Math.ceil(s * f.ratePerSlot)
}

/** Xu nhận được cho một bài chạy `km` khi hôm nay đã nhận `todayXu` */
export function runReward(km: number, p: EconomyPolicy = DEFAULT_POLICY, todayXu = 0): number {
  if (!(km >= 1)) return 0
  const raw = p.firstKmXu + (km - 1) * p.extraKmXu
  return Math.round(Math.min(raw, Math.max(p.maxDailyReward - todayXu, 0)) * 10) / 10
}

/** Mô tả biểu phí ngắn gọn, ví dụ "≤ 5 người miễn phí · 6–10 người 3 Xu/người · trên 10 người 5 Xu/người" */
export function feePolicyText(f: ChallengeFeePolicy): string {
  const parts = [`≤ ${f.freeMaxSlots} người miễn phí`]
  if (f.midMaxSlots > f.freeMaxSlots) parts.push(`${f.freeMaxSlots + 1}–${f.midMaxSlots} người ${f.midRatePerSlot} Xu/người`)
  parts.push(`trên ${Math.max(f.midMaxSlots, f.freeMaxSlots)} người ${f.ratePerSlot} Xu/người`)
  return parts.join(' · ')
}

const vnd = new Intl.NumberFormat('vi-VN')
/** Quy đổi tham chiếu sang tiền đồng: 30 Xu → "≈ 30.000đ" */
export const xuToVnd = (xu: number, p: Pick<EconomyPolicy, 'xuVnd'> = DEFAULT_POLICY) => `≈ ${vnd.format(Math.round(xu * p.xuVnd))}đ`

/** Kiểm tra cấu hình trước khi admin lưu (máy chủ kiểm tra lại) */
export function validatePolicy(p: EconomyPolicy): string | null {
  const f = p.challengeFee
  if (!(p.xuVnd >= 1 && p.xuVnd <= 1_000_000)) return 'Giá trị 1 Xu phải từ 1 đến 1.000.000 đồng.'
  if (!(p.firstKmXu >= 0 && p.firstKmXu <= 100)) return 'Xu km đầu phải từ 0 đến 100.'
  if (!(p.extraKmXu >= 0 && p.extraKmXu <= 100)) return 'Xu mỗi km tiếp theo phải từ 0 đến 100.'
  if (!(p.maxDailyReward >= 0 && p.maxDailyReward <= 10_000)) return 'Trần Xu mỗi ngày phải từ 0 đến 10.000.'
  if (!Number.isInteger(f.freeMaxSlots) || f.freeMaxSlots < 0) return 'Mốc miễn phí phải là số nguyên ≥ 0.'
  if (!Number.isInteger(f.midMaxSlots) || f.midMaxSlots < f.freeMaxSlots) return 'Mốc giữa phải ≥ mốc miễn phí.'
  if (!(f.midRatePerSlot >= 0) || !(f.ratePerSlot >= 0)) return 'Đơn giá mỗi người không được âm.'
  return null
}
