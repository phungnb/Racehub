import { describe, expect, it } from 'vitest'
import { usableResultUrls } from './web-search'

describe('usableResultUrls', () => {
  it('bỏ mạng xã hội, file, trùng; giữ trang giải; cắt theo giới hạn', () => {
    const urls = ['https://www.facebook.com/x', 'https://hue-marathon.vn/a#top', 'https://hue-marathon.vn/a', 'https://x.vn/f.pdf', 'https://youtu.be/1', 'not a url', 'https://b.vn/', 'https://c.vn/']
    expect(usableResultUrls(urls, 2)).toEqual(['https://hue-marathon.vn/a', 'https://b.vn/'])
  })
  it('giới hạn số kết quả mỗi tên miền để đa dạng nguồn', () => {
    const urls = ['https://a.vn/1', 'https://www.a.vn/2', 'https://a.vn/3', 'https://b.vn/1']
    expect(usableResultUrls(urls, 10, 2)).toEqual(['https://a.vn/1', 'https://www.a.vn/2', 'https://b.vn/1'])
  })
})
