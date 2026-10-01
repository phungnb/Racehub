import { describe, it, expect } from 'vitest'
import { companyLine, contactLinks, featuredMenu, fillSiteInfo, groupMenu, staticHref } from './help'

describe('menu Hướng dẫn & Chính sách', () => {
  it('điền thông tin pháp nhân; thiếu thì ghi "đang cập nhật"; khoá lạ giữ nguyên', () => {
    const out = fillSiteInfo('Email: {{support_email}} · MST {{ tax_code }} · {{la}}', { support_email: 'hotro@racehub.vn' })
    expect(out).toBe('Email: hotro@racehub.vn · MST *đang cập nhật* · {{la}}')
  })

  it('mã chèn link liên hệ thành link bấm được; chưa nhập → "đang cập nhật"', () => {
    const out = fillSiteInfo('{{zalo_link}} | {{telegram_link}} | {{phone_link}} | {{email_link}}',
      { support_zalo: '0909 123 456', support_telegram: '@racehub_vn', support_phone: '0909123456' })
    expect(out).toBe('[Nhắn Zalo: 0909 123 456](https://zalo.me/0909123456) | [Nhắn Telegram: @racehub_vn](https://t.me/racehub_vn)'
      + ' | [Gọi điện: 0909123456](tel:0909123456) | *đang cập nhật*')
  })

  it('Điều khoản + Quyền riêng tư luôn đứng đầu nhóm Chính sách', () => {
    const g = groupMenu([
      { slug: 'bat-dau', section: 'GUIDE', title: 'Bắt đầu', icon: null, summary: null },
      { slug: 'quy-tac-cong-dong', section: 'POLICY', title: 'Quy tắc', icon: null, summary: null },
    ])
    expect(g.map((x) => x.section)).toEqual(['GUIDE', 'POLICY'])
    expect(g[1].items.map((x) => x.slug)).toEqual(['terms', 'privacy', 'quy-tac-cong-dong'])
    expect(staticHref('terms')).toBe('/terms')
    expect(staticHref('bat-dau')).toBe('/help/bat-dau')
  })

  it('008500: Điều khoản / Quyền riêng tư admin soạn thay bản tĩnh; Gói & Doanh nghiệp là thẻ nổi bật, không lặp trong danh sách', () => {
    const pages = [
      { slug: 'terms', section: 'POLICY' as const, title: 'Điều khoản (admin)', icon: '📄', summary: null },
      { slug: 'vip-pro', section: 'GUIDE' as const, title: 'Gói của tôi', icon: '👑', summary: 'Bảng giá' },
      { slug: 'doanh-nghiep', section: 'GUIDE' as const, title: 'Doanh nghiệp', icon: '🏢', summary: null },
      { slug: 'bat-dau', section: 'GUIDE' as const, title: 'Bắt đầu', icon: null, summary: null },
    ]
    const g = groupMenu(pages)
    expect(g[0].items.map((x) => x.slug)).toEqual(['bat-dau'])
    expect(g[1].items.map((x) => [x.slug, x.title])).toEqual([['privacy', 'Chính sách quyền riêng tư'], ['terms', 'Điều khoản (admin)']])
    expect(featuredMenu(pages).map((f) => [f.title, staticHref(f.slug)])).toEqual([['Gói của tôi', '/goi'], ['Doanh nghiệp', '/doanh-nghiep']])
    expect(featuredMenu([]).map((f) => f.title)).toEqual(['Gói & quyền lợi', 'RaceHub cho doanh nghiệp'])
  })

  it('chân menu chỉ hiện thông tin đã nhập', () => {
    expect(companyLine({})).toEqual([])
    expect(companyLine({ company_name: 'Công ty A', tax_code: '0101', support_phone: '0909' })).toEqual(['Công ty A', 'MST 0101', '0909'])
  })
})

describe('contactLinks', () => {
  it('tạo link gọi, Zalo, Telegram, email; bỏ giá trị sai', () => {
    expect(contactLinks({ support_phone: '0909 123 456', support_zalo: '+84 909123456', support_telegram: 'https://t.me/racehub_vn', support_email: 'hotro@racehub.vn' })
      .map((c) => [c.kind, c.href])).toEqual([
      ['phone', 'tel:0909123456'], ['zalo', 'https://zalo.me/0909123456'], ['telegram', 'https://t.me/racehub_vn'], ['email', 'mailto:hotro@racehub.vn'],
    ])
    expect(contactLinks({ support_zalo: 'https://zalo.me/g/abc123', support_telegram: '@ab' })).toEqual([
      { kind: 'zalo', label: 'Zalo', value: 'https://zalo.me/g/abc123', href: 'https://zalo.me/g/abc123' },
    ])
    expect(contactLinks({ support_zalo: 'javascript:alert(1)', support_email: 'khong-phai-email' })).toEqual([])
  })
})
