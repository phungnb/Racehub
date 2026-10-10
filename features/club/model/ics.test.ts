import { describe, it, expect } from 'vitest'
import { eventIcs } from './ics'

const ev = { id: 'e1', title: 'Chạy dài, Hồ Tây', starts_at: '2026-10-11T22:30:00Z', ends_at: '2026-10-12T00:30:00Z', location_name: 'Hồ Tây', description: 'Dòng 1\nDòng 2' }

describe('eventIcs', () => {
  const ics = eventIcs(ev, 'CLB A', new Date('2026-10-10T00:00:00Z'))
  it('có giờ UTC, tiêu đề đã escape và hai chuông nhắc', () => {
    expect(ics).toContain('DTSTART:20261011T223000Z')
    expect(ics).toContain('DTEND:20261012T003000Z')
    expect(ics).toContain('SUMMARY:Chạy dài\\, Hồ Tây · CLB A')
    expect(ics).toContain('DESCRIPTION:Dòng 1\\nDòng 2')
    expect(ics.match(/BEGIN:VALARM/g)).toHaveLength(2)
    expect(ics).toContain('TRIGGER:-PT1H')
    expect(ics).toContain('TRIGGER:-P1D')
  })
  it('xuống dòng CRLF và không dòng nào quá 75 byte', () => {
    expect(ics.endsWith('\r\n')).toBe(true)
    for (const l of eventIcs({ ...ev, description: 'x'.repeat(300) }).split('\r\n')) expect(new TextEncoder().encode(l).length).toBeLessThanOrEqual(75)
  })
})
