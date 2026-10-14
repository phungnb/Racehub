import { describe, expect, it } from 'vitest'
import { usableResultUrls } from './web-search'

describe('usableResultUrls', () => {
  it('bỏ mạng xã hội, file, trùng; giữ trang giải; cắt theo giới hạn', () => {
    const urls = ['https://www.facebook.com/x', 'https://hue-marathon.vn/a#top', 'https://hue-marathon.vn/a', 'https://x.vn/f.pdf', 'https://youtu.be/1', 'not a url', 'https://b.vn/', 'https://c.vn/']
    expect(usableResultUrls(urls, 2)).toEqual(['https://hue-marathon.vn/a', 'https://b.vn/'])
  })
})
