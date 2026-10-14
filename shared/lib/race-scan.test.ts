import { describe, expect, it } from 'vitest'
import { extractEventLinks, isSearchResultsUrl, screenCandidate } from './race-scan'
import { robotsAllowsPath } from './safe-fetch'
import type { RaceDraft } from './race-import'

const NOW = Date.parse('2026-10-14T00:00:00Z')
const draft = (o: Partial<RaceDraft> = {}): RaceDraft => ({ title: 'Hue Marathon 2026', race_date: '2026-12-01', end_date: '', location: 'Huế', organizer: 'BTC', image_url: 'https://x/a.jpg', description: '5K 10K 21K', distances: ['5K', '10K', '21K'], ...o })

describe('screenCandidate', () => {
  it('giải tương lai đủ thông tin vào hàng chờ với điểm cao', () => {
    expect(screenCandidate(draft(), NOW)).toEqual({ status: 'PENDING', score: 100, reason: null })
  })
  it.each([
    [{ title: '' }, 'Thiếu tên'],
    [{ title: 'Tin tức bóng đá', description: 'hôm nay' }, 'Không giống giải chạy'],
    [{ race_date: '' }, 'Không đọc được ngày'],
    [{ race_date: '2026-01-01' }, 'Giải đã diễn ra'],
    [{ race_date: '2030-01-01' }, 'Ngày quá xa (>18 tháng)'],
  ] as const)('loại %j', (o, reason) => {
    expect(screenCandidate(draft(o), NOW)).toMatchObject({ status: 'FILTERED', reason })
  })
})

describe('extractEventLinks', () => {
  const base = new URL('https://btc.vn/lich-giai')
  it('chỉ lấy link cùng tên miền, bỏ rác và trùng, ưu tiên link giải', () => {
    const html = `<a href="/about">a</a><a href="/giai-chay-hue-marathon">b</a><a href="https://other.com/x">c</a><a href="/giai-chay-hue-marathon#top">d</a>
      <a href="/img/a.jpg">e</a><a href="/login">f</a><a href="mailto:a@b.c">g</a><a href="/">h</a>`
    expect(extractEventLinks(html, base)).toEqual(['https://btc.vn/giai-chay-hue-marathon', 'https://btc.vn/about'])
  })
  it('giới hạn số link', () => {
    const html = Array.from({ length: 50 }, (_, i) => `<a href="/p${i}">x</a>`).join('')
    expect(extractEventLinks(html, base, 10)).toHaveLength(10)
  })
})

describe('robotsAllowsPath', () => {
  const txt = 'User-agent: *\nDisallow: /admin\nAllow: /admin/public\n\nUser-agent: Other\nDisallow: /'
  it('theo nhóm * và quy tắc dài nhất', () => {
    expect(robotsAllowsPath(txt, '/giai')).toBe(true)
    expect(robotsAllowsPath(txt, '/admin/x')).toBe(false)
    expect(robotsAllowsPath(txt, '/admin/public/x')).toBe(true)
  })
  it('chặn toàn bộ khi Disallow: /', () => {
    expect(robotsAllowsPath('User-agent: *\nDisallow: /', '/a')).toBe(false)
  })
})

describe('isSearchResultsUrl', () => {
  it('nhận link kết quả tìm kiếm, bỏ qua trang giải', () => {
    expect(isSearchResultsUrl('https://www.google.com/search?q=lich+giai+chay')).toBe(true)
    expect(isSearchResultsUrl('https://www.bing.com/search?q=marathon')).toBe(true)
    expect(isSearchResultsUrl('https://hue-marathon.vn/')).toBe(false)
    expect(isSearchResultsUrl('khong phai url')).toBe(false)
  })
})
