import { describe, it, expect } from 'vitest'
import { companyLine, fillSiteInfo, groupMenu, staticHref } from './help'

describe('menu Hướng dẫn & Chính sách', () => {
  it('điền thông tin pháp nhân; thiếu thì ghi "đang cập nhật"; khoá lạ giữ nguyên', () => {
    const out = fillSiteInfo('Email: {{support_email}} · MST {{ tax_code }} · {{la}}', { support_email: 'hotro@racehub.vn' })
    expect(out).toBe('Email: hotro@racehub.vn · MST *đang cập nhật* · {{la}}')
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

  it('chân menu chỉ hiện thông tin đã nhập', () => {
    expect(companyLine({})).toEqual([])
    expect(companyLine({ company_name: 'Công ty A', tax_code: '0101', support_phone: '0909' })).toEqual(['Công ty A', 'MST 0101', '0909'])
  })
})
