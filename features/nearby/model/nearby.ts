// Nhãn + hàm thuần cho Runner Nearby
import type { Goal, Purpose, Radius, Reason, Slot, Visibility } from '../api/nearbyApi'

export const RADII: Radius[] = [2, 5, 10, 20]
export const GOALS: Record<Goal, string> = { '5K': '5K', '10K': '10K', HM: 'Half Marathon', FM: 'Marathon', TRAIL: 'Trail' }
export const SLOTS: Record<Slot, string> = { EARLY: 'Sáng sớm', MORNING: 'Buổi sáng', NOON: 'Trưa', EVENING: 'Buổi tối', WEEKEND: 'Cuối tuần' }
export const PURPOSES: Record<Purpose, string> = { BUDDY: 'Tìm bạn chạy cùng', CLUB: 'Tìm CLB gần đây', COACH: 'Tìm HLV / nhóm tập' }
export const VISIBILITY: Record<Visibility, { label: string; hint: string }> = {
  VERIFIED: { label: 'Runner đã xác minh', hint: 'Người cũng đã bật và có ≥ 3 bài chạy hợp lệ' },
  SAME_GENDER: { label: 'Chỉ cùng giới', hint: 'Theo giới tính trong hồ sơ' },
  CLUBS: { label: 'Chỉ thành viên CLB chung', hint: 'Người ở cùng ít nhất một CLB với bạn' },
}
export const PACE_FILTERS = { ALL: 'Mọi pace', FAST: 'Nhanh hơn 5:30', MID: '5:30–7:00', EASY: 'Chậm hơn 7:00', UNKNOWN: 'Chưa có dữ liệu' } as const
export const REASONS: Record<Reason, string> = { PACE: 'Cùng pace', SLOT: 'Cùng khung giờ', GOAL: 'Cùng mục tiêu', CLUB: 'Cùng CLB', MUTUAL: 'Có bạn chung' }
export const REPORT_REASONS = { SPAM: 'Làm phiền / spam', HARASSMENT: 'Quấy rối', FAKE: 'Tài khoản giả', UNSAFE: 'Hành vi nguy hiểm', OTHER: 'Khác' } as const
export const TTL: { hours: 24 | 168 | 720; label: string }[] = [{ hours: 24, label: '24 giờ' }, { hours: 168, label: '7 ngày' }, { hours: 720, label: '30 ngày' }]

/** 330 → "5:30/km" */
export const formatPace = (s: number | null | undefined) => (s ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}/km` : null)
/** Km hiển thị: máy chủ đã làm tròn + thêm nhiễu cố định theo cặp */
export const formatKm = (km: number) => (km <= 1 ? 'khoảng 1 km' : `khoảng ${km} km`)
/** Ô lưới ~1 km (chỉ để hiển thị trước khi gửi; máy chủ tự làm tròn lại) */
export const toCell = (v: number) => Math.round(v * 100) / 100

const WEEKDAY = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7']
/** "T7 27/09 · 05:30" (giờ Việt Nam) */
export function eventWhen(iso: string) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Ho_Chi_Minh', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false,
  }).formatToParts(new Date(iso)).map((x) => [x.type, x.value]))
  const wd = WEEKDAY[['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday)]
  return `${wd} ${p.day}/${p.month} · ${p.hour === '24' ? '00' : p.hour}:${p.minute}`
}

/** Thời gian còn lại tới khi vị trí hết hạn: "còn 5 giờ" / "còn 6 ngày" */
export function expiresIn(iso: string, now = Date.now()) {
  const h = Math.max(0, (new Date(iso).getTime() - now) / 3_600_000)
  if (h < 1) return 'còn dưới 1 giờ'
  return h < 48 ? `còn ${Math.round(h)} giờ` : `còn ${Math.round(h / 24)} ngày`
}
