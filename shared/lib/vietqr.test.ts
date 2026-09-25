import { describe, it, expect } from 'vitest'
import { crc16, vietQrPayload } from './vietqr'

describe('VietQR', () => {
  it('CRC-16/CCITT-FALSE đúng chuẩn', () => {
    expect(crc16('123456789')).toBe('29B1')
  })
  it('mã tĩnh: đủ trường NAPAS, không có số tiền, CRC khớp', () => {
    const s = vietQrPayload({ bin: '970436', account_no: '0123456789' }, null, 'Phí giải Hồ Tây')
    expect(s.startsWith('000201010211')).toBe(true)
    expect(s).toContain('0010A000000727')
    expect(s).toContain('0006970436')
    expect(s).toContain('01100123456789')
    expect(s).toContain('0208QRIBFTTA')
    expect(s).toContain('5303704')
    expect(s).toContain('5802VN')
    expect(s).toContain('62190815Phi giai Ho Tay')
    expect(s).toContain('53037045802VN')                    // không có trường 54 (số tiền)
    expect(s.slice(-4)).toBe(crc16(s.slice(0, -4)))
  })
  it('có số tiền → mã động 12 + trường 54', () => {
    const s = vietQrPayload({ bin: '970436', account_no: '1' }, 150000, 'x')
    expect(s).toContain('010212')
    expect(s).toContain('5406150000')
  })
})
