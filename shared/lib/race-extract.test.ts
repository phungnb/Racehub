import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const { candidateKey, htmlToText, normalizeExtracted } = await import('./race-extract')

describe('htmlToText', () => {
  it('bỏ script/thẻ, giữ link tuyệt đối', () => {
    const t = htmlToText('<head><title>x</title></head><script>evil()</script><p>Giải <a href="/dk">Đăng ký</a></p>', 'https://a.vn/lich')
    expect(t).not.toContain('evil')
    expect(t).toContain('Đăng ký (https://a.vn/dk)')
  })
})

describe('normalizeExtracted', () => {
  it('chặn dữ liệu sai kiểu / ngày sai / link không phải http', () => {
    const r = normalizeExtracted({ races: [
      { title: ' Dalat Marathon ', race_date: '2027-03-01', end_date: '01/03', location: 'Đà Lạt', province: 'Lâm Đồng', distances: ['21K', 5, ''], organizer: 'X', reg_url: 'javascript:1', description: 'ok' },
      { title: '', race_date: '2027-01-01' },
    ] })
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({ title: 'Dalat Marathon', race_date: '2027-03-01', end_date: '', reg_url: '', distances: ['21K'] })
  })
  it('đầu vào rác → rỗng', () => { expect(normalizeExtracted(null)).toEqual([]); expect(normalizeExtracted({ races: 'x' })).toEqual([]) })
})

describe('candidateKey', () => {
  it('trang#tên-ngày, bỏ dấu', () => {
    expect(candidateKey('https://a.vn/lich#top', { title: 'Đà Nẵng Marathon 2027', race_date: '2027-04-10' })).toBe('https://a.vn/lich#da-nang-marathon-2027-2027-04-10')
  })
})
