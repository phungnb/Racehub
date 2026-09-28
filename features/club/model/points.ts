// Luật tính điểm CLB (009400): mô tả bằng lời, mẫu gợi ý, kiểm tra trước khi gửi (khớp private.valid_point_rule)
import type { PointRule } from '../api/pointsApi'

export const DAY_LABEL: Record<number, string> = { 1: 'T2', 2: 'T3', 3: 'T4', 4: 'T5', 5: 'T6', 6: 'T7', 7: 'CN' }

export const paceText = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`
/** "6:30" → 390; sai định dạng → null */
export function parsePace(t: string): number | null {
  const m = t.trim().match(/^(\d{1,2})[:.,'](\d{1,2})$/)
  if (!m) return null
  const s = Number(m[1]) * 60 + Number(m[2])
  return Number(m[2]) < 60 && s > 0 ? s : null
}
const n = (v: number) => (Number.isInteger(v) ? String(v) : String(v).replace('.', ','))

/** Mô tả một luật bằng lời cho thành viên đọc */
export function describeRule(r: PointRule): string {
  const pts = r.per === 'KM' ? `${n(r.points)} điểm mỗi km` : `${n(r.points)} điểm mỗi buổi`
  const cond: string[] = []
  if (r.min_km) cond.push(`từ ${n(r.min_km)} km`)
  if (r.max_km) cond.push(`tới ${n(r.max_km)} km`)
  if (r.max_pace_s) cond.push(`pace ≤ ${paceText(r.max_pace_s)}/km`)
  if (r.from_hour != null || r.to_hour != null) cond.push(`bắt đầu ${r.from_hour ?? 0}h–${r.to_hour ?? 24}h`)
  if (r.days?.length && r.days.length < 7) cond.push([...r.days].sort().map((d) => DAY_LABEL[d]).join(', '))
  if (r.group_only) cond.push('buổi chạy nhóm có điểm danh')
  return cond.length ? `${pts} · ${cond.join(' · ')}` : pts
}

export const RULE_TEMPLATES: { label: string; hint: string; rules: PointRule[]; daily_cap: number | null }[] = [
  { label: 'Chăm chỉ', hint: 'Thưởng sự đều đặn hơn số km', daily_cap: 30, rules: [
    { name: 'Mỗi buổi từ 3 km', per: 'RUN', points: 10, min_km: 3 },
    { name: 'Buổi dài từ 10 km', per: 'RUN', points: 10, min_km: 10 },
    { name: 'Chạy sáng sớm', per: 'RUN', points: 5, min_km: 3, from_hour: 4, to_hour: 7 },
  ] },
  { label: 'Theo km', hint: 'Điểm = số km, thêm thưởng buổi dài', daily_cap: null, rules: [
    { name: 'Mỗi km', per: 'KM', points: 1, min_km: 1 },
    { name: 'Thưởng buổi 21 km', per: 'RUN', points: 20, min_km: 21 },
  ] },
  { label: 'Gắn kết', hint: 'Khuyến khích đi chạy cùng CLB', daily_cap: 50, rules: [
    { name: 'Mỗi buổi từ 3 km', per: 'RUN', points: 5, min_km: 3 },
    { name: 'Đi chạy nhóm CLB', per: 'RUN', points: 20, group_only: true },
    { name: 'Chạy cuối tuần', per: 'RUN', points: 5, min_km: 5, days: [6, 7] },
  ] },
]

/** Kiểm tra giống máy chủ để báo lỗi ngay trên form */
export function validateRules(rules: PointRule[], dailyCap: number | null): string | null {
  if (!rules.length || rules.length > 12) return 'Cần 1–12 luật.'
  for (const [i, r] of rules.entries()) {
    const at = `Luật ${i + 1}`
    if (r.name.trim().length < 2 || r.name.trim().length > 60) return `${at}: tên 2–60 ký tự.`
    if (!(r.points >= 0 && r.points <= (r.per === 'KM' ? 100 : 1000))) return `${at}: điểm ${r.per === 'KM' ? 'mỗi km tối đa 100' : 'mỗi buổi tối đa 1.000'}.`
    if (r.min_km != null && !(r.min_km >= 0 && r.min_km <= 500)) return `${at}: km tối thiểu 0–500.`
    if (r.max_km != null && !(r.max_km >= (r.min_km ?? 0) && r.max_km <= 1000)) return `${at}: km tối đa phải ≥ km tối thiểu.`
    if (r.max_pace_s != null && !(r.max_pace_s >= 150 && r.max_pace_s <= 1500)) return `${at}: pace 2:30–25:00 / km.`
    if (r.from_hour != null && r.to_hour != null && r.from_hour >= r.to_hour) return `${at}: giờ bắt đầu phải trước giờ kết thúc.`
  }
  if (dailyCap != null && !(dailyCap >= 1 && dailyCap <= 100000)) return 'Trần điểm mỗi ngày 1–100.000 (để trống = không giới hạn).'
  return null
}
