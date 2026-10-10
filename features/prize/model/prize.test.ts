import { describe, it, expect } from 'vitest'
import { parseSizes, prizeSheet } from './prize'

describe('tặng phẩm', () => {
  it('parseSizes bỏ trùng và rỗng', () => expect(parseSizes('S, M; L\nM, ,XL')).toEqual(['S', 'M', 'L', 'XL']))
  it('prizeSheet có cột cỡ áo / BIB tuỳ chọn', () => {
    const rows = [{ user_id: 'u', display_name: 'A', status: 'JOINED', ref_label: 'RH-1 · 5 km', filled: false }]
    expect(prizeSheet(rows, false, false).head).not.toContain('Cỡ áo')
    const s = prizeSheet(rows, true, true)
    expect(s.head).toContain('Cỡ áo'); expect(s.head).toContain('BIB / cự ly')
    expect(s.rows[0]).toContain('Chưa điền')
  })
})
