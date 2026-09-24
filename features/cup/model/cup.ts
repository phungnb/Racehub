// Thách đấu CLB: hàm thuần (giai đoạn, nhãn, kiểm tra biểu mẫu)
import type { Cup, CupMetric } from '../api/cupApi'

export type CupPhase = 'REVIEW' | 'REJECTED' | 'CANCELLED' | 'REGISTRATION' | 'LIVE' | 'SETTLING' | 'FINISHED'

export function cupPhase(c: Pick<Cup, 'status' | 'start_at' | 'end_at'>, now: number): CupPhase {
  if (c.status === 'PENDING_REVIEW') return 'REVIEW'
  if (c.status === 'REJECTED') return 'REJECTED'
  if (c.status === 'CANCELLED') return 'CANCELLED'
  if (c.status === 'FINISHED') return 'FINISHED'
  if (now < Date.parse(c.start_at)) return 'REGISTRATION'
  if (now < Date.parse(c.end_at)) return 'LIVE'
  return 'SETTLING'
}

export const PHASE_LABEL: Record<CupPhase, string> = {
  REVIEW: 'Chờ admin duyệt', REJECTED: 'Không được duyệt', CANCELLED: 'Đã hủy', REGISTRATION: 'Đang nhận CLB',
  LIVE: 'Đang diễn ra', SETTLING: 'Đang chốt kết quả', FINISHED: 'Đã kết thúc',
}

export const METRIC_LABEL: Record<CupMetric, { title: string; hint: string; unit: string }> = {
  AVG_KM: { title: 'Km trung bình / thành viên', hint: 'Công bằng khi các CLB chênh quân số', unit: 'km/người' },
  TOTAL_KM: { title: 'Tổng km cả CLB', hint: 'CLB đông, chạy nhiều thì thắng', unit: 'km' },
}

/** Còn đăng ký được không (CLB chưa vào, chưa quá hạn, chưa đủ chỗ) */
export function canJoin(c: Pick<Cup, 'status' | 'reg_close_at' | 'clubs' | 'max_clubs'>, now: number) {
  return c.status === 'OPEN' && now <= Date.parse(c.reg_close_at) && c.clubs < c.max_clubs
}

export interface CupDraft { title: string; start: string; end: string; close: string; maxClubs: number }

/** Lỗi biểu mẫu tạo thách đấu (thời gian dạng ISO) — null nếu hợp lệ */
export function validateCup(d: CupDraft, now: number): string | null {
  const t = d.title.trim()
  if (t.length < 3 || t.length > 120) return 'Tên thách đấu cần từ 3 đến 120 ký tự.'
  const s = Date.parse(d.start), e = Date.parse(d.end), c = Date.parse(d.close || d.start)
  if (!s || !e) return 'Chọn thời gian bắt đầu và kết thúc.'
  if (s < now - 10 * 60_000) return 'Thời gian bắt đầu phải ở tương lai.'
  if (e <= s) return 'Thời gian kết thúc phải sau thời gian bắt đầu.'
  if (e - s < 86400_000 || e - s > 93 * 86400_000) return 'Thách đấu kéo dài từ 1 ngày đến 3 tháng.'
  if (c < now || c > e) return 'Hạn đăng ký phải sau hiện tại và trước khi kết thúc.'
  if (!Number.isInteger(d.maxClubs) || d.maxClubs < 2 || d.maxClubs > 200) return 'Số CLB tối đa từ 2 đến 200.'
  return null
}

export function scoreText(metric: CupMetric, s: { km: number; avg_km: number }) {
  return metric === 'TOTAL_KM' ? `${s.km.toLocaleString('vi-VN')} km` : `${s.avg_km.toLocaleString('vi-VN')} km/người`
}
