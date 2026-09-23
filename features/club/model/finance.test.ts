import { describe, expect, it } from 'vitest'
import { cashCsv, formatVnd, parseVnd, transferNote, vietQrUrl } from './finance'
import { eventCountdown, eventWhen, fromVnLocalInput, mapsUrl, parseLatLng, toVnLocalInput } from './events'

describe('thu chi CLB — hàm thuần', () => {
  it('định dạng và đọc số tiền', () => {
    expect(formatVnd(150000)).toBe('150.000đ')
    expect(parseVnd('150.000')).toBe(150000)
    expect(parseVnd('150k')).toBe(150000)
    expect(parseVnd('1,5tr')).toBe(1500000)
    expect(parseVnd('abc')).toBeNaN()
  })
  it('nội dung chuyển khoản không dấu, ≤ 50 ký tự; link VietQR có số tiền + nội dung', () => {
    const n = transferNote('Hồ Tây Runners', 'Phí tháng 10/2026', 'Phùng Minh Đức')
    expect(n).toBe('HO TAY RUNNERS PHI THANG 10 202 PHUNG MINH DUC')
    expect(n.length).toBeLessThanOrEqual(50)
    const url = vietQrUrl({ bin: '970436', account_no: '0123456789', account_name: 'NGUYEN VAN A' }, 100000, n)
    expect(url.startsWith('https://img.vietqr.io/image/970436-0123456789-compact2.png?')).toBe(true)
    expect(new URL(url).searchParams.get('amount')).toBe('100000')
    expect(new URL(url).searchParams.get('addInfo')).toBe(n)
  })
  it('CSV có BOM, khoản chi mang dấu âm, ô có dấu phẩy được bọc ngoặc kép', () => {
    const csv = cashCsv([{ id: '1', kind: 'EXPENSE', amount_vnd: 30000, title: 'Nước, chuối', note: null, receipt_url: null,
      user_name: null, created_by_name: 'Minh', created_at: '2026-09-23T01:00:00Z', voided_at: null, void_reason: null }])
    expect(csv.charCodeAt(0)).toBe(0xfeff)
    expect(csv).toContain('"Nước, chuối"')
    expect(csv).toContain(',-30000,')
  })
})

describe('sự kiện CLB — hàm thuần', () => {
  it('giờ Việt Nam cho nhãn và ô nhập', () => {
    expect(eventWhen('2026-09-27T22:30:00Z')).toBe('Thứ Hai, 28/09 · 05:30')
    expect(toVnLocalInput('2026-09-27T22:30:00Z')).toBe('2026-09-28T05:30')
    expect(fromVnLocalInput('2026-09-28T05:30')).toBe('2026-09-27T22:30:00.000Z')
    expect(fromVnLocalInput('sai')).toBeNull()
  })
  it('đếm ngược', () => {
    const now = new Date('2026-09-28T00:00:00Z')
    expect(eventCountdown('2026-09-28T03:00:00Z', '2026-09-28T05:00:00Z', now)).toBe('Còn 3 giờ')
    expect(eventCountdown('2026-09-27T23:30:00Z', '2026-09-28T01:00:00Z', now)).toBe('Đang diễn ra')
    expect(eventCountdown('2026-09-20T00:00:00Z', '2026-09-20T01:00:00Z', now)).toBe('Đã kết thúc')
  })
  it('tọa độ từ link Google Maps hoặc chuỗi "lat, lng"; link bản đồ', () => {
    expect(parseLatLng('https://www.google.com/maps/@21.0583,105.8235,15z')).toEqual({ lat: 21.0583, lng: 105.8235 })
    expect(parseLatLng('21.0583, 105.8235')).toEqual({ lat: 21.0583, lng: 105.8235 })
    expect(parseLatLng('Hồ Tây')).toBeNull()
    expect(mapsUrl({ lat: 21.05, lng: 105.82, location_name: null })).toContain('query=21.05,105.82')
    expect(mapsUrl({ lat: null, lng: null, location_name: 'Hồ Tây' })).toContain('query=H%E1%BB%93%20T%C3%A2y')
    expect(mapsUrl({ lat: null, lng: null, location_name: null })).toBeNull()
  })
})
