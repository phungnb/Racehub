// Sự kiện CLB: nhãn thời gian, link bản đồ, chuyển đổi ô nhập ngày giờ. Hàm thuần.
const TZ = 'Asia/Ho_Chi_Minh'
const WEEKDAY = ['Chủ nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy']

function vnParts(d: Date) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false,
  }).formatToParts(d).map((x) => [x.type, x.value]))
  const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday)
  return { y: p.year, m: p.month, d: p.day, hh: p.hour === '24' ? '00' : p.hour, mm: p.minute, wd }
}

/** "Chủ nhật, 28/09 · 05:30" (giờ Việt Nam) */
export function eventWhen(iso: string) {
  const p = vnParts(new Date(iso))
  return `${WEEKDAY[p.wd]}, ${p.d}/${p.m} · ${p.hh}:${p.mm}`
}

/** Ô lịch nhỏ: { day: "28", month: "Th9" } */
export function eventDateBadge(iso: string) {
  const p = vnParts(new Date(iso))
  return { day: p.d, month: `Th${Number(p.m)}` }
}

/** "Đang diễn ra" / "Còn 3 giờ" / "Còn 2 ngày" / "Đã kết thúc" */
export function eventCountdown(startIso: string, endIso: string, now = new Date()) {
  const s = new Date(startIso).getTime(), e = new Date(endIso).getTime(), t = now.getTime()
  if (t >= e) return 'Đã kết thúc'
  if (t >= s) return 'Đang diễn ra'
  const min = Math.round((s - t) / 60_000)
  if (min < 60) return `Còn ${min} phút`
  const h = Math.round(min / 60)
  if (h < 24) return `Còn ${h} giờ`
  return `Còn ${Math.round(h / 24)} ngày`
}

/** Link mở bản đồ (Google Maps): có tọa độ thì chỉ đường chính xác, không thì tìm theo tên */
export function mapsUrl(e: { lat: number | null; lng: number | null; location_name: string | null }) {
  if (e.lat != null && e.lng != null) return `https://www.google.com/maps/search/?api=1&query=${e.lat},${e.lng}`
  if (e.location_name) return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(e.location_name)}`
  return null
}

/** Dán link Google Maps hoặc "21.0583, 105.8235" → tọa độ */
export function parseLatLng(input: string): { lat: number; lng: number } | null {
  const m = /(-?\d{1,2}\.\d{3,})\s*,\s*(-?\d{1,3}\.\d{3,})/.exec(input) ?? /@(-?\d{1,2}\.\d+),(-?\d{1,3}\.\d+)/.exec(input)
  if (!m) return null
  const lat = Number(m[1]), lng = Number(m[2])
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null
}

/** ISO → giá trị ô <input type="datetime-local"> theo giờ Việt Nam */
export function toVnLocalInput(iso: string) {
  const p = vnParts(new Date(iso))
  return `${p.y}-${p.m}-${p.d}T${p.hh}:${p.mm}`
}

/** Giá trị ô datetime-local (hiểu là giờ Việt Nam, UTC+7) → ISO */
export function fromVnLocalInput(v: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(v)
  if (!m) return null
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4] - 7, +m[5])).toISOString()
}
