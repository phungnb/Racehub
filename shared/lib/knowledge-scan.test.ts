import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const { normalizeArticles } = await import('./knowledge-scan')

const page = 'https://bao.vn/chuyen-muc/chay-bo'
const art = (o: Record<string, unknown> = {}) => ({ title: 'Cách chạy 5K đầu tiên', summary: 'Tóm tắt.', category_id: 'BEGINNER', tags: ['5K'], source_name: 'Báo A', url: '', ...o })

describe('normalizeArticles', () => {
  it('trang một bài: dùng link trang; link riêng cùng trang gốc được giữ, khác trang bị bỏ', () => {
    const r = normalizeArticles({ articles: [art(), art({ title: 'Bài thứ hai ở danh sách', url: '/bai-2' }), art({ title: 'Link bịa sang trang khác', url: 'https://evil.com/x' })] }, page, null)
    expect(r.map((x) => x.source_url)).toEqual([page, 'https://bao.vn/bai-2', page].slice(0, 2))
  })
  it('chuyên mục lạ → mặc định của nguồn; không có → RACES; thiếu tóm tắt / tiêu đề ngắn bị loại', () => {
    expect(normalizeArticles({ articles: [art({ category_id: 'X' })] }, page, 'GEAR')[0].category_id).toBe('GEAR')
    expect(normalizeArticles({ articles: [art({ category_id: 'X' })] }, page, null)[0].category_id).toBe('RACES')
    expect(normalizeArticles({ articles: [art({ summary: '' }), art({ title: 'ab' })] }, page, null)).toEqual([])
  })
  it('đầu vào rác → rỗng; tên nguồn mặc định là tên miền', () => {
    expect(normalizeArticles(null, page, null)).toEqual([])
    expect(normalizeArticles({ articles: 'x' }, page, null)).toEqual([])
    expect(normalizeArticles({ articles: [art({ source_name: '' })] }, page, null)[0].source_name).toBe('bao.vn')
  })
})
