// 34 tỉnh / thành phố sau sắp xếp đơn vị hành chính (hiệu lực 01/7/2025) — dùng cho bộ lọc khu vực
export const PROVINCES = [
  'Hà Nội', 'TP. Hồ Chí Minh', 'Hải Phòng', 'Đà Nẵng', 'Huế', 'Cần Thơ',
  'An Giang', 'Bắc Ninh', 'Cà Mau', 'Cao Bằng', 'Đắk Lắk', 'Điện Biên', 'Đồng Nai', 'Đồng Tháp', 'Gia Lai', 'Hà Tĩnh',
  'Hưng Yên', 'Khánh Hòa', 'Lai Châu', 'Lâm Đồng', 'Lạng Sơn', 'Lào Cai', 'Nghệ An', 'Ninh Bình', 'Phú Thọ', 'Quảng Ngãi',
  'Quảng Ninh', 'Quảng Trị', 'Sơn La', 'Tây Ninh', 'Thái Nguyên', 'Thanh Hóa', 'Tuyên Quang', 'Vĩnh Long',
] as const

export type Province = (typeof PROVINCES)[number]

const fold = (s: string) => s.normalize('NFD').replace(/\p{M}+/gu, '').replace(/[đĐ]/g, 'd').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
const KEYS = PROVINCES.map((p) => [p, fold(p.replace(/^TP\. /, ''))] as const)

/** Đoán tỉnh / thành từ một địa chỉ ("…, Quận 1, Thành phố Hồ Chí Minh" → "TP. Hồ Chí Minh"); không chắc → null */
export function guessProvince(text: string | null | undefined): Province | null {
  const t = ` ${fold(text ?? '')} `
  // Lấy tên khớp nằm sau cùng (tỉnh luôn đứng cuối địa chỉ) — tránh "đường Hà Nội, TP. Thủ Đức…"
  let best: { p: Province; at: number } | null = null
  for (const [p, k] of KEYS) {
    const at = t.lastIndexOf(` ${k} `)
    if (at >= 0 && (!best || at > best.at)) best = { p, at }
  }
  return best?.p ?? null
}
