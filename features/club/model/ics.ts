// File lịch .ics cho một sự kiện CLB: mở bằng ứng dụng Lịch của điện thoại, có chuông nhắc trước 1 ngày và 1 giờ. Hàm thuần.
const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/[,;]/g, (c) => `\\${c}`)

/** Cắt dòng quá 75 byte theo RFC 5545 (nối tiếp bằng dấu cách đầu dòng) */
function fold(line: string) {
  const out: string[] = []
  let cur = ''
  for (const ch of line) {
    if (new TextEncoder().encode(cur + ch).length > (out.length ? 74 : 75)) { out.push(cur); cur = ch } else cur += ch
  }
  out.push(cur)
  return out.join('\r\n ')
}

export interface IcsEvent { id: string; title: string; starts_at: string; ends_at: string; location_name: string | null; description: string | null }

export function eventIcs(e: IcsEvent, clubName?: string | null, now = new Date()) {
  const alarm = (trigger: string, text: string) => ['BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(text)}`, `TRIGGER:${trigger}`, 'END:VALARM']
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//RaceHub//Lich CLB//VI', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${e.id}@racehub`,
    `DTSTAMP:${stamp(now)}`,
    `DTSTART:${stamp(new Date(e.starts_at))}`,
    `DTEND:${stamp(new Date(e.ends_at))}`,
    `SUMMARY:${esc(clubName ? `${e.title} · ${clubName}` : e.title)}`,
    ...(e.location_name ? [`LOCATION:${esc(e.location_name)}`] : []),
    ...(e.description ? [`DESCRIPTION:${esc(e.description)}`] : []),
    ...alarm('-PT1H', `Còn 1 giờ: ${e.title}`),
    ...alarm('-P1D', `Ngày mai: ${e.title}`),
    'END:VEVENT', 'END:VCALENDAR',
  ]
  return lines.map(fold).join('\r\n') + '\r\n'
}
