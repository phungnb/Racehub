// Định dạng số liệu hiển thị (locale vi-VN)

const nf = new Intl.NumberFormat('vi-VN')
const nf1 = new Intl.NumberFormat('vi-VN', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const nf2 = new Intl.NumberFormat('vi-VN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export const formatNumber = (n: number | null | undefined) => nf.format(Number(n ?? 0))

/** 1250.5 → "1.250,5" (bỏ phần thập phân nếu tròn) */
export const formatCoin = (n: number | string | null | undefined) => {
  const v = Number(n ?? 0)
  return Number.isInteger(v) ? nf.format(v) : nf1.format(v)
}

/** mét → "5,20" km */
export const formatKm = (meters: number | null | undefined) => nf2.format(Number(meters ?? 0) / 1000)

/** giây → "1:02:05" hoặc "32:30" */
export function formatDuration(totalSeconds: number | null | undefined) {
  const s = Math.max(0, Math.round(Number(totalSeconds ?? 0)))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const mm = String(m).padStart(h > 0 ? 2 : 1, '0')
  const ss = String(sec).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

/** giây/km → "5:15"; không hợp lệ → "--:--" */
export function formatPace(secPerKm: number | null | undefined) {
  const v = Number(secPerKm ?? 0)
  if (!v || !Number.isFinite(v)) return '--:--'
  const m = Math.floor(v / 60)
  const s = Math.round(v % 60)
  return s === 60 ? `${m + 1}:00` : `${m}:${String(s).padStart(2, '0')}`
}

export const paceFrom = (meters: number, seconds: number) => (meters > 0 ? seconds / (meters / 1000) : 0)

/** "3 phút trước", "Hôm qua", hoặc ngày */
export function formatRelative(iso: string | Date | null | undefined, now: Date = new Date()) {
  if (!iso) return ''
  const d = typeof iso === 'string' ? new Date(iso) : iso
  const diff = (now.getTime() - d.getTime()) / 1000
  if (Number.isNaN(diff)) return ''
  if (diff < 60) return 'Vừa xong'
  if (diff < 3600) return `${Math.floor(diff / 60)} phút trước`
  if (diff < 86400) return `${Math.floor(diff / 3600)} giờ trước`
  if (diff < 172800) return 'Hôm qua'
  return d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' })
}
