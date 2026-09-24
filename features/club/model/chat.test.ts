import { describe, it, expect } from 'vitest'
import { applyMention, dayLabel, findMentions, groupMessages, mentionQuery } from './chat'

const NOW = new Date(2026, 8, 23, 9, 0)      // Thứ Tư 23/09/2026
const at = (d: number, h: number, m: number) => new Date(2026, 8, d, h, m).toISOString()

describe('dayLabel', () => {
  it('hôm nay, hôm qua, thứ trong tuần, ngày', () => {
    expect(dayLabel(new Date(2026, 8, 23, 6), NOW)).toBe('Hôm nay')
    expect(dayLabel(new Date(2026, 8, 22, 23), NOW)).toBe('Hôm qua')
    expect(dayLabel(new Date(2026, 8, 21, 5), NOW)).toBe('Thứ Hai, 21/09')
    expect(dayLabel(new Date(2026, 7, 1), NOW)).toBe('01/08')
    expect(dayLabel(new Date(2025, 7, 1), NOW)).toBe('01/08/2025')
  })
})

describe('groupMessages', () => {
  it('chèn nhãn ngày và gom tin liên tiếp trong 5 phút của cùng người', () => {
    const items = groupMessages([
      { id: '1', author_id: 'a', created_at: at(22, 20, 0) },
      { id: '2', author_id: 'a', created_at: at(23, 5, 0) },
      { id: '3', author_id: 'a', created_at: at(23, 5, 3) },
      { id: '4', author_id: 'b', created_at: at(23, 5, 4) },
      { id: '5', author_id: 'b', created_at: at(23, 5, 20) },
    ], NOW)
    expect(items.map((i) => (i.type === 'day' ? i.label : `${i.message.id}:${+i.groupStart}${+i.groupEnd}`)))
      .toEqual(['Hôm qua', '1:11', 'Hôm nay', '2:10', '3:01', '4:11', '5:11'])
  })

  it('tin đã thu hồi không gom với tin khác', () => {
    const items = groupMessages([
      { id: '1', author_id: 'a', created_at: at(23, 5, 0) },
      { id: '2', author_id: 'a', created_at: at(23, 5, 1), deleted_at: at(23, 5, 2) },
    ], NOW)
    expect(items.filter((i) => i.type === 'msg').map((i) => i.type === 'msg' && [i.groupStart, i.groupEnd])).toEqual([[true, true], [true, true]])
  })
})

describe('findMentions', () => {
  const members = [
    { user_id: 'an', name: 'An' },
    { user_id: 'an-ng', name: 'An Nguyễn' },
    { user_id: 'binh', name: 'Bình Trần' },
  ]
  it('khớp tên đầy đủ, ưu tiên tên dài, không phân biệt hoa thường', () => {
    expect(findMentions('@an nguyễn với @Bình Trần 5h nhé', members).sort()).toEqual(['an-ng', 'binh'])
    expect(findMentions('@An đi không', members)).toEqual(['an'])
  })
  it('không khớp khi tên là tiền tố của từ khác, hoặc không có @', () => {
    expect(findMentions('@Anh ơi', members)).toEqual([])
    expect(findMentions('An Nguyễn chạy nhanh', members)).toEqual([])
  })
})

describe('mentionQuery / applyMention', () => {
  it('nhận ra từ đang gõ sau @', () => {
    expect(mentionQuery('Chào @Bì', 8)).toEqual({ query: 'Bì', start: 5 })
    expect(mentionQuery('email@abc', 9)).toBeNull()
    expect(mentionQuery('không nhắc ai', 5)).toBeNull()
  })
  it('thay truy vấn bằng tên và đặt con trỏ sau dấu cách', () => {
    expect(applyMention('Chào @Bì nhé', 5, 8, 'Bình Trần')).toEqual({ text: 'Chào @Bình Trần  nhé', caret: 16 })
  })
})
