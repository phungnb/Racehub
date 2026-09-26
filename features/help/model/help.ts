// Menu Hướng dẫn & Chính sách (migration 007300): kiểu dữ liệu + điền thông tin pháp nhân vào nội dung trang
export type HelpSection = 'GUIDE' | 'POLICY' | 'SUPPORT'

export interface HelpMenuItem { slug: string; section: HelpSection; title: string; icon: string | null; summary: string | null }
export type SiteInfo = Partial<Record<SiteKey, string>>
export interface HelpMenu { pages: HelpMenuItem[]; site: SiteInfo }
export interface HelpPage extends HelpMenuItem {
  body: string; version: string; effective_at: string | null; updated_at: string
  is_published: boolean; needs_review: boolean; site: SiteInfo
}
export interface HelpAdminPage extends Omit<HelpPage, 'site'> { sort: number; updated_by_name: string | null }

/** Giữ đồng bộ với private.site_info_keys() */
export const SITE_KEYS = [
  { key: 'company_name', label: 'Tên công ty / chủ sở hữu', placeholder: 'Công ty TNHH …' },
  { key: 'tax_code', label: 'Mã số thuế', placeholder: '0123456789' },
  { key: 'business_license', label: 'Giấy phép / đăng ký kinh doanh', placeholder: 'Số …, cấp ngày …, nơi cấp …' },
  { key: 'address', label: 'Địa chỉ', placeholder: 'Số nhà, đường, phường, tỉnh / thành' },
  { key: 'support_email', label: 'Email hỗ trợ', placeholder: 'hotro@…' },
  { key: 'support_phone', label: 'Điện thoại hỗ trợ', placeholder: '09…' },
  { key: 'report_email', label: 'Email nhận báo cáo vi phạm', placeholder: 'baocao@…' },
  { key: 'dpo_contact', label: 'Người phụ trách dữ liệu cá nhân', placeholder: 'Họ tên — email' },
  { key: 'min_age', label: 'Tuổi tối thiểu dùng app', placeholder: '16' },
] as const
export type SiteKey = (typeof SITE_KEYS)[number]['key']

export const SECTION_LABEL: Record<HelpSection, string> = {
  GUIDE: 'Hướng dẫn chơi', POLICY: 'Chính sách & quy định', SUPPORT: 'Hỗ trợ',
}

/** Trang pháp lý viết sẵn trong code (không nằm trong bảng help_pages) — luôn đứng đầu nhóm Chính sách */
export const STATIC_POLICIES: HelpMenuItem[] = [
  { slug: 'terms', section: 'POLICY', title: 'Điều khoản sử dụng', icon: '📄', summary: null },
  { slug: 'privacy', section: 'POLICY', title: 'Chính sách quyền riêng tư', icon: '🛡️', summary: null },
]
export const staticHref = (slug: string) => (slug === 'terms' ? '/terms' : slug === 'privacy' ? '/privacy' : `/help/${slug}`)

export const MISSING = 'đang cập nhật'

/** Thay {{khoá}} bằng thông tin pháp nhân; khoá chưa nhập → "đang cập nhật", khoá lạ giữ nguyên để admin thấy gõ sai */
export function fillSiteInfo(body: string, site: SiteInfo): string {
  const known = new Set<string>(SITE_KEYS.map((k) => k.key))
  return body.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (all, key: string) =>
    known.has(key) ? (site[key as SiteKey]?.trim() || `*${MISSING}*`) : all)
}

/** Nhóm các trang theo mục, thêm trang pháp lý tĩnh vào đầu nhóm Chính sách */
export function groupMenu(pages: HelpMenuItem[]): { section: HelpSection; items: HelpMenuItem[] }[] {
  const order: HelpSection[] = ['GUIDE', 'POLICY', 'SUPPORT']
  return order.map((section) => ({
    section,
    items: [...(section === 'POLICY' ? STATIC_POLICIES : []), ...pages.filter((p) => p.section === section)],
  })).filter((g) => g.items.length > 0)
}

/** Dòng chân menu: chỉ các thông tin đã nhập */
export function companyLine(site: SiteInfo): string[] {
  return [
    site.company_name,
    site.tax_code && `MST ${site.tax_code}`,
    site.business_license,
    site.address,
    [site.support_email, site.support_phone].filter(Boolean).join(' · ') || undefined,
  ].filter((x): x is string => !!x && x.trim().length > 0)
}
