import { describe, it, expect } from 'vitest'
import { filterSearch, matchesSearch, searchKey, searchRank } from './search'

describe('tìm kiếm tiếng Việt', () => {
  it('bỏ dấu, hoa thường, Unicode tổ hợp như dựng sẵn', () => {
    expect(searchKey('  Đặng ÁNH-Dũng! ')).toBe('dang anh dung')
    expect(searchKey('Nguyễn')).toBe(searchKey('Nguyễn'))
  })
  it('nhiều từ không cần thứ tự, viết tắt, nhiều trường', () => {
    expect(matchesSearch('an nguyen', 'Nguyễn Văn An')).toBe(true)
    expect(matchesSearch('NGUYỄN VĂN AN', 'Nguyễn Văn An')).toBe(true)
    expect(matchesSearch('nbnr', 'No Beer No Run')).toBe(true)
    expect(matchesSearch('hat do', 'Mũ lưỡi trai', 'hat_do')).toBe(true)
    expect(matchesSearch('nguyen binh', 'Nguyễn Văn An')).toBe(false)
    expect(matchesSearch('  ', 'bất kỳ')).toBe(true)
  })
  it('xếp khớp nhất trước', () => {
    expect(searchRank('ho tay', 'Hồ Tây')).toBe(0)
    expect(searchRank('ho tay', 'Hồ Tây Runners')).toBe(1)
    expect(searchRank('tay', 'Hồ Tây Runners')).toBe(2)
    expect(filterSearch(['Tây Hồ Trail', 'CLB Hồ Tây', 'Hồ Tây Runners'], 'ho tay', (x) => [x])).toEqual(['Hồ Tây Runners', 'CLB Hồ Tây', 'Tây Hồ Trail'])
  })
})
