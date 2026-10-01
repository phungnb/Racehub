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
  { key: 'support_zalo', label: 'Zalo hỗ trợ', placeholder: 'Số điện thoại Zalo hoặc link zalo.me/…' },
  { key: 'support_telegram', label: 'Telegram hỗ trợ', placeholder: '@tên hoặc link t.me/…' },
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
/** Trang có giao diện riêng (bảng giá, trang doanh nghiệp, pháp lý): mục menu mở trang đó, nội dung admin soạn hiện bên trong */
const ROUTED: Record<string, string> = { terms: '/terms', privacy: '/privacy', 'vip-pro': '/goi', 'doanh-nghiep': '/doanh-nghiep' }
export const staticHref = (slug: string) => ROUTED[slug] ?? `/help/${slug}`
/** Hai mục nổi bật đầu menu (thẻ lớn) — không lặp lại trong danh sách bên dưới */
export const FEATURED: HelpMenuItem[] = [
  { slug: 'vip-pro', section: 'GUIDE', title: 'Gói & quyền lợi', icon: '👑', summary: 'So sánh Miễn phí · VIP · CLB Pro' },
  { slug: 'doanh-nghiep', section: 'GUIDE', title: 'RaceHub cho doanh nghiệp', icon: '🏢', summary: 'Chiến dịch, xếp hạng phòng ban, báo cáo nhân sự' },
]
/** Mục nổi bật: lấy tiêu đề / mô tả admin đã sửa nếu có */
export const featuredMenu = (pages: HelpMenuItem[]) => FEATURED.map((f) => ({ ...f, ...pages.find((p) => p.slug === f.slug) }))

export const MISSING = 'đang cập nhật'

/** Mã chèn link bấm được: {{zalo_link}} → [Nhắn Zalo](https://zalo.me/…), tương tự Telegram / gọi điện / email */
export const LINK_KEYS = [
  { key: 'zalo_link', kind: 'zalo', text: 'Nhắn Zalo' },
  { key: 'telegram_link', kind: 'telegram', text: 'Nhắn Telegram' },
  { key: 'phone_link', kind: 'phone', text: 'Gọi điện' },
  { key: 'email_link', kind: 'email', text: 'Gửi email' },
] as const

/** Thay {{khoá}} bằng thông tin pháp nhân / link liên hệ; khoá chưa nhập → "đang cập nhật", khoá lạ giữ nguyên để admin thấy gõ sai */
export function fillSiteInfo(body: string, site: SiteInfo): string {
  const known = new Set<string>(SITE_KEYS.map((k) => k.key))
  const links = contactLinks(site)
  return body.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (all, key: string) => {
    if (known.has(key)) return site[key as SiteKey]?.trim() || `*${MISSING}*`
    const lk = LINK_KEYS.find((k) => k.key === key)
    if (!lk) return all
    const l = links.find((x) => x.kind === lk.kind)
    return l ? `[${lk.text}: ${l.value}](${l.href})` : `*${MISSING}*`
  })
}

/** Nhóm các trang theo mục, thêm trang pháp lý tĩnh vào đầu nhóm Chính sách */
export function groupMenu(pages: HelpMenuItem[]): { section: HelpSection; items: HelpMenuItem[] }[] {
  const order: HelpSection[] = ['GUIDE', 'POLICY', 'SUPPORT']
  const featured = new Set(FEATURED.map((f) => f.slug))
  // Điều khoản / Quyền riêng tư: bản admin soạn (008500) nếu có, không thì bản viết sẵn trong code
  const statics = STATIC_POLICIES.filter((s) => !pages.some((p) => p.slug === s.slug))
  return order.map((section) => ({
    section,
    items: [...(section === 'POLICY' ? statics : []), ...pages.filter((p) => p.section === section && !featured.has(p.slug))],
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

export type ContactKind = 'phone' | 'zalo' | 'telegram' | 'email'
export interface ContactLink { kind: ContactKind; label: string; value: string; href: string }

const digits = (v: string) => v.replace(/[^\d+]/g, '')
const isUrl = (v: string) => /^https:\/\//i.test(v)

/** Các kênh liên hệ admin đã nhập → link bấm được (gọi, mở Zalo / Telegram, soạn email). Giá trị lạ / sai → bỏ qua. */
export function contactLinks(site: SiteInfo): ContactLink[] {
  const out: ContactLink[] = []
  const phone = site.support_phone?.trim()
  if (phone && digits(phone).replace('+', '').length >= 8) out.push({ kind: 'phone', label: 'Điện thoại', value: phone, href: `tel:${digits(phone)}` })
  const zalo = site.support_zalo?.trim()
  if (zalo) {
    const d = digits(zalo).replace(/^\+84/, '0')
    const href = isUrl(zalo) && /^https:\/\/(www\.)?zalo\.me\//i.test(zalo) ? zalo : d.length >= 8 ? `https://zalo.me/${d}` : null
    if (href) out.push({ kind: 'zalo', label: 'Zalo', value: zalo, href })
  }
  const tg = site.support_telegram?.trim()
  if (tg) {
    const name = tg.replace(/^https:\/\/(www\.)?t\.me\//i, '').replace(/^@/, '')
    if (/^[A-Za-z0-9_]{4,32}$/.test(name)) out.push({ kind: 'telegram', label: 'Telegram', value: `@${name}`, href: `https://t.me/${name}` })
  }
  const email = site.support_email?.trim()
  if (email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) out.push({ kind: 'email', label: 'Email', value: email, href: `mailto:${email}` })
  return out
}
