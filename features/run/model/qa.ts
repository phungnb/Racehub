// Kiểm thử GPS thực địa: người test chọn kịch bản, nhập quãng đường chuẩn (đo sẵn / vòng sân / cột mốc),
// RaceHub gửi kèm tóm tắt chất lượng GPS → Quản trị → Hệ thống → Kiểm thử GPS so sánh theo thiết bị & kịch bản.

export const QA_KEY = 'rh-run-qa'

export const QA_SCENARIOS = [
  { code: 'CLEAR', label: 'Trời quang, cung đường đo chuẩn', hint: 'Đường đã biết chính xác độ dài (đường đua, cột mốc km).' },
  { code: 'HIGHRISE', label: 'Giữa nhà cao tầng', hint: 'Phố hẹp, nhiều toà nhà hai bên — GPS dễ nhảy.' },
  { code: 'TREES', label: 'Dưới tán cây / GPS yếu', hint: 'Công viên nhiều cây, mái che, gầm cầu.' },
  { code: 'TRACK', label: 'Vòng sân vận động nhiều vòng', hint: 'Chạy làn 1, ghi số vòng × 400 m làm quãng chuẩn.' },
  { code: 'SLOW', label: 'Đi bộ / chạy rất chậm', hint: 'Kiểm tra nhiễu khi tốc độ thấp, không bị tự tạm dừng nhầm.' },
  { code: 'PAUSE', label: 'Tạm dừng 2 phút rồi tiếp tục', hint: 'Bấm Tạm dừng, đi tiếp 100 m, bấm Tiếp tục — đoạn đó không được cộng.' },
  { code: 'REST', label: 'Đứng nghỉ lâu không bấm dừng', hint: 'Đứng yên 10+ phút: app phải hỏi Kết thúc; quên bấm thì phần đứng yên cuối bài bị bỏ.' },
  { code: 'LOCK', label: 'Khoá màn hình 20–30 phút', hint: 'App cài: tắt màn hình bỏ túi. Trình duyệt: dùng nút Khoá màn hình của RaceHub.' },
  { code: 'SWITCH', label: 'Chuyển app / nghe cuộc gọi', hint: 'Mở app khác, nghe gọi 1–2 phút rồi quay lại.' },
  { code: 'OFFLINE', label: 'Mất mạng trong lúc chạy', hint: 'Bật chế độ máy bay giữa chừng; lưu bài khi chưa có mạng → bài vào hàng chờ.' },
  { code: 'RELOAD', label: 'Đóng app rồi mở lại', hint: 'Vuốt tắt app giữa buổi, mở lại → Khôi phục → chạy tiếp.' },
] as const
export type QaScenario = (typeof QA_SCENARIOS)[number]['code']
export const qaLabel = (code: string | null | undefined) => QA_SCENARIOS.find((s) => s.code === code)?.label ?? code ?? '—'

export interface QaInput { scenario: QaScenario | null; ref_m: number | null; note: string }

/** Sai lệch (%) giữa quãng đường RaceHub đo và quãng đường chuẩn; null = chưa nhập quãng chuẩn */
export function errorPct(measuredM: number, refM: number | null | undefined): number | null {
  if (!refM || refM <= 0) return null
  return Math.round(((measuredM - refM) / refM) * 1000) / 10
}

/** Mức đánh giá độ lệch: ≤ 2 % tốt (ngang đồng hồ GPS), ≤ 5 % chấp nhận được, lớn hơn cần xem lại */
export const errorTone = (pct: number | null) => (pct === null ? 'none' : Math.abs(pct) <= 2 ? 'good' : Math.abs(pct) <= 5 ? 'ok' : 'bad')

/** Tên thiết bị gọn từ user agent (không gửi cả chuỗi) */
export function deviceLabel(ua: string): string {
  const ios = ua.match(/iPhone OS (\d+)[_.](\d+)/) ?? ua.match(/CPU OS (\d+)[_.](\d+)/)
  if (ios) return `iPhone iOS ${ios[1]}.${ios[2]}`
  const and = ua.match(/Android (\d+(?:\.\d+)?);\s*([^;)]+?)(?:\sBuild|\)|;)/)
  if (and) return `${and[2].trim()} · Android ${and[1]}`.slice(0, 60)
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Trình duyệt'
  const os = /Mac OS X/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : ''
  return `${browser}${os ? ` · ${os}` : ''}`
}

/**
 * Tỷ lệ điểm HỎNG (%): sai số lớn, nhảy điểm, trùng thời gian. Điểm "rung tại chỗ" / "đứng yên" là bình thường —
 * bộ lọc gộp nhiều điểm 1 giây thành một bước vài mét, nên không tính là hỏng.
 */
export function badPct(q: { fixes?: number; rejected?: Record<string, number> } | null | undefined) {
  if (!q?.fixes) return 0
  const r = q.rejected ?? {}
  return Math.round((((r.INACCURATE ?? 0) + (r.TELEPORT ?? 0) + (r.NO_TIME ?? 0)) / q.fixes) * 1000) / 10
}

export const REJECT_LABEL: Record<string, string> = {
  INACCURATE: 'Sai số lớn (> 35 m) — bỏ', TELEPORT: 'Nhảy điểm — bỏ', NO_TIME: 'Trùng / lùi thời gian — bỏ',
  JITTER: 'Gộp vào bước sau (bình thường)', STILL: 'Đứng yên (bình thường)',
}
