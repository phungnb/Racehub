import { describe, expect, it } from 'vitest'
import { parseInline, parseMarkdown, safeHref, slugify, tocOf, youtubeId } from './markdown'

describe('markdown Knowledge', () => {
  it('tiêu đề có neo mục lục không trùng, đoạn văn, danh sách, trích dẫn, bảng', () => {
    const b = parseMarkdown('## Kỹ thuật cơ bản\n\nChạy **chậm** thôi.\ndòng tiếp\n\n- a\n- b\n\n1. một\n2. hai\n\n> Lưu ý\n> thêm\n\n| Tuần | Bài |\n|---|---|\n| 1 | Đi bộ |\n\n## Kỹ thuật cơ bản')
    expect(b.map((x) => x.t)).toEqual(['h', 'p', 'ul', 'ol', 'quote', 'table', 'h'])
    expect(tocOf(b).map((x) => x.id)).toEqual(['ky-thuat-co-ban', 'ky-thuat-co-ban-1'])
    expect(b[1]).toEqual({ t: 'p', c: [{ t: 'text', v: 'Chạy ' }, { t: 'b', c: [{ t: 'text', v: 'chậm' }] }, { t: 'text', v: ' thôi. dòng tiếp' }] })
    expect(b[5]).toMatchObject({ t: 'table', rows: [[[{ v: '1' }], [{ v: 'Đi bộ' }]]] })
  })

  it('không cho HTML / link nguy hiểm; ảnh chỉ https; video YouTube', () => {
    expect(safeHref('javascript:alert(1)')).toBeNull()
    expect(safeHref('//evil.com')).toBeNull()
    expect(safeHref('/challenges')).toBe('/challenges')
    expect(parseInline('[bấm](javascript:alert(1))')).toEqual([{ t: 'text', v: 'bấm' }, { t: 'text', v: ')' }])
    expect(parseMarkdown('<script>alert(1)</script>')).toEqual([{ t: 'p', c: [{ t: 'text', v: '<script>alert(1)</script>' }] }])
    expect(parseMarkdown('![giày](http://x.vn/a.jpg)')[0].t).toBe('p')
    expect(parseMarkdown('![giày](https://x.vn/a.jpg)')[0]).toEqual({ t: 'img', alt: 'giày', src: 'https://x.vn/a.jpg' })
    expect(youtubeId('https://youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
    expect(parseMarkdown('https://www.youtube.com/watch?v=dQw4w9WgXcQ')[0]).toEqual({ t: 'video', id: 'dQw4w9WgXcQ' })
    expect(slugify('Chạy 10K đầu tiên!')).toBe('chay-10k-dau-tien')
  })
})
