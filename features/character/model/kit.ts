// Bộ đồng phục (migration 005900): áo + quần + tất + giày cùng thiết kế; hút màu từ ảnh áo thật / logo CLB; phối màu.
import { hexToRgb, luma, NAME_TOKEN, type CharacterItem, type ItemPattern, type ItemPrint, type Slot } from './catalog'

export type KitPartSlot = 'bottom' | 'socks' | 'shoes'
export interface KitPart {
  color: string
  pattern: ItemPattern | null
  /** Độ đậm / sáng tối, ảnh vải, lớp in tự do (quần) — migration 006000 */
  tone?: ItemPrint['tone']
  texture?: ItemPrint['texture']
  layers?: ItemPrint['layers']
}
/** Thiết kế của quần / tất / giày gửi lên máy chủ (null = trơn) */
export function partPrint(p: KitPart): ItemPrint | null {
  const out: ItemPrint = {}
  if (p.pattern) out.pattern = p.pattern
  if (p.tone && (p.tone.strength < 1 || p.tone.light !== 0)) out.tone = p.tone
  if (p.texture?.url) out.texture = p.texture
  if (p.layers?.length) out.layers = p.layers
  return Object.keys(out).length ? out : null
}
export interface KitDesign {
  /** Màu áo */
  top: string
  /** In + họa tiết áo */
  print: ItemPrint
  /** null = bộ không có món này (người mặc giữ đồ đang mặc) */
  bottom: KitPart | null
  socks: KitPart | null
  shoes: KitPart | null
}
export const KIT_PARTS: { slot: KitPartSlot; label: string }[] = [
  { slot: 'bottom', label: 'Quần' }, { slot: 'socks', label: 'Tất' }, { slot: 'shoes', label: 'Giày' },
]

const toHex = (r: number, g: number, b: number) => '#' + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')
const dist = (a: readonly number[], b: readonly number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])

/** Trộn về trắng (t > 0) hoặc đen (t < 0) */
export function shade(hex: string, t: number): string {
  const c = hexToRgb(hex)
  if (!c) return hex
  const to = t > 0 ? 255 : 0
  const k = Math.abs(t)
  return toHex(c[0] + (to - c[0]) * k, c[1] + (to - c[1]) * k, c[2] + (to - c[2]) * k)
}

/** Chênh độ sáng giữa hai màu (0–255) */
export function lumaGap(a: string, b: string): number {
  const x = hexToRgb(a), y = hexToRgb(b)
  return x && y ? Math.abs(luma(x[0], x[1], x[2]) - luma(y[0], y[1], y[2])) : 0
}

/** Chữ trắng hay đen đọc rõ hơn trên nền này */
export function contrastText(bg: string): string {
  const c = hexToRgb(bg)
  return c && luma(c[0], c[1], c[2]) > 150 ? '#111111' : '#ffffff'
}

/**
 * Màu chủ đạo của ảnh (áo đấu thật, logo): k-means trên điểm ảnh đã thu nhỏ; bỏ nền (màu 4 góc) và điểm trong suốt.
 * `px` là RGBA. Trả tối đa `k` màu, nhiều nhất trước, đã gộp các màu gần nhau.
 */
export function extractPalette(px: Uint8ClampedArray, width: number, height: number, k = 6): string[] {
  const at = (x: number, y: number) => { const o = (y * width + x) * 4; return [px[o], px[o + 1], px[o + 2], px[o + 3]] }
  const corners = [at(0, 0), at(width - 1, 0), at(0, height - 1), at(width - 1, height - 1)].filter((c) => c[3] > 200)
  // Nền: ≥ 3 góc gần nhau → coi là phông, bỏ các điểm giống nó
  const bg = corners.length >= 3 && corners.every((c) => dist(c, corners[0]) < 40) ? corners[0] : null
  const pts: number[][] = []
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] < 160) continue
    const c = [px[i], px[i + 1], px[i + 2]]
    if (bg && dist(c, bg) < 38) continue
    pts.push(c)
  }
  if (!pts.length) return []
  // Khởi tạo k-means++ (xác định: chọn điểm xa nhất)
  const cent: number[][] = [pts[Math.floor(pts.length / 2)]]
  while (cent.length < Math.min(k, pts.length)) {
    let best = pts[0], bd = -1
    for (const p of pts) { const d = Math.min(...cent.map((c) => dist(p, c))); if (d > bd) { bd = d; best = p } }
    if (bd < 12) break
    cent.push(best)
  }
  let count = new Array(cent.length).fill(0)
  for (let it = 0; it < 8; it++) {
    const sum = cent.map(() => [0, 0, 0])
    count = new Array(cent.length).fill(0)
    for (const p of pts) {
      let j = 0, bd = Infinity
      for (let c = 0; c < cent.length; c++) { const d = dist(p, cent[c]); if (d < bd) { bd = d; j = c } }
      sum[j][0] += p[0]; sum[j][1] += p[1]; sum[j][2] += p[2]; count[j]++
    }
    for (let c = 0; c < cent.length; c++) if (count[c]) cent[c] = sum[c].map((v) => v / count[c])
  }
  const order = cent.map((c, j) => ({ c, n: count[j] })).filter((x) => x.n / pts.length > 0.015).sort((a, b) => b.n - a.n)
  // Bỏ màu gần nhau và màu PHA ở mép (nằm trên đoạn nối hai màu lớn hơn hoặc màu nền, vd đỏ + nền xám = hồng)
  const out: number[][] = []
  for (const { c } of order) {
    if (out.some((o) => dist(o, c) < 45)) continue
    const anchors = bg ? [...out, bg.slice(0, 3)] : out
    let blend = false
    for (let i = 0; i < anchors.length && !blend; i++) for (let j = i + 1; j < anchors.length && !blend; j++) {
      const [a, b] = [anchors[i], anchors[j]]
      const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
      const len2 = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2
      if (!len2) continue
      const t = ((c[0] - a[0]) * ab[0] + (c[1] - a[1]) * ab[1] + (c[2] - a[2]) * ab[2]) / len2
      if (t > 0.12 && t < 0.88 && dist(c, [a[0] + ab[0] * t, a[1] + ab[1] * t, a[2] + ab[2] * t]) < 22) blend = true
    }
    if (!blend) out.push(c)
  }
  return out.map((c) => toHex(c[0], c[1], c[2]))
}

/** Phối màu gợi ý từ màu chính + màu phụ */
export interface KitScheme { key: string; label: string; apply: (primary: string, secondary: string) => Omit<KitDesign, 'print'> & { accent: string } }
const dark = '#111827', white = '#f8fafc'
export const KIT_SCHEMES: KitScheme[] = [
  { key: 'classic', label: 'Cổ điển', apply: (p, s) => ({ top: p, accent: s, bottom: { color: dark, pattern: { kind: 'sides', color: p } }, socks: { color: white, pattern: { kind: 'band', color: p } }, shoes: { color: dark, pattern: null } }) },
  { key: 'mono', label: 'Đồng bộ', apply: (p, s) => ({ top: p, accent: s, bottom: { color: shade(p, -0.35), pattern: null }, socks: { color: p, pattern: { kind: 'band', color: s } }, shoes: { color: shade(p, -0.5), pattern: null } }) },
  { key: 'contrast', label: 'Tương phản', apply: (p, s) => ({ top: p, accent: s, bottom: { color: s, pattern: { kind: 'sides', color: p } }, socks: { color: p, pattern: { kind: 'hoops', color: s } }, shoes: { color: s, pattern: null } }) },
  { key: 'light', label: 'Sáng', apply: (p, s) => ({ top: p, accent: s, bottom: { color: white, pattern: { kind: 'hem', color: p } }, socks: { color: white, pattern: null }, shoes: { color: white, pattern: null } }) },
]

/** Màu chính / phụ từ bảng màu: chính = nhiều nhất; phụ = màu khác biệt nhất trong phần còn lại */
export function pickPrimarySecondary(palette: string[]): [string, string] {
  const p = palette[0] ?? '#1d4ed8'
  const pr = hexToRgb(p)!
  const rest = palette.slice(1)
  const s = rest.sort((a, b) => dist(hexToRgb(b)!, pr) - dist(hexToRgb(a)!, pr))[0] ?? contrastText(p)
  return [p, s]
}

/** Áp phối màu vào thiết kế đang có (giữ nội dung in; chỉ đổi màu chữ cho dễ đọc; giữ món đã tắt) */
export function applyScheme(kit: KitDesign, scheme: KitScheme, primary: string, secondary: string): KitDesign {
  const r = scheme.apply(primary, secondary)
  const pat = kit.print.pattern ? { ...kit.print.pattern, color: secondary } : { kind: 'sides' as const, color: secondary }
  // chữ: dùng màu phụ nếu đủ tương phản với áo, không thì trắng / đen
  const text = lumaGap(r.top, secondary) > 90 ? secondary : contrastText(r.top)
  const keep = (next: KitPart | null, old: KitPart | null) => (old && next ? { ...old, color: next.color, pattern: next.pattern } : null)
  return {
    top: r.top,
    print: { ...kit.print, pattern: pat, text_color: text, layers: kit.print.layers?.map((l) => (l.type === 'text' ? { ...l, color: text } : l)) },
    bottom: keep(r.bottom, kit.bottom), socks: keep(r.socks, kit.socks), shoes: keep(r.shoes, kit.shoes),
  }
}

/** Lớp in mặc định: tên CLB giữa ngực + tên runner bên dưới */
export const defaultLayers = (clubName: string): NonNullable<ItemPrint['layers']> => [
  ...(clubName.trim() ? [{ id: 'title', type: 'text' as const, text: clubName.toUpperCase().slice(0, 24), font: 'athletic', color: '#ffffff', x: 0.5, y: 0.68, w: 0.5, rot: 0, opacity: 1, spacing: 0.04 }] : []),
  { id: 'name', type: 'text' as const, text: NAME_TOKEN, font: 'athletic', color: '#ffffff', x: 0.5, y: 0.8, w: 0.28, rot: 0, opacity: 1, spacing: 0.08 },
]

export const defaultKit = (clubName: string, accent?: string | null): KitDesign => {
  const p = accent && /^#[0-9a-f]{6}$/i.test(accent) ? accent : '#1d4ed8'
  const base: KitDesign = { top: p, print: { pattern: null, layers: defaultLayers(clubName) }, bottom: { color: dark, pattern: null }, socks: { color: white, pattern: null }, shoes: { color: dark, pattern: null } }
  return applyScheme(base, KIT_SCHEMES[0], p, '#f8fafc')
}

/** Vật phẩm xem thử của cả bộ */
export function kitItems(kit: KitDesign, name = 'Đồng phục'): CharacterItem[] {
  const one = (slot: Slot, color: string, print: ItemPrint | null): CharacterItem => ({
    code: `kit_preview_${slot}`, name, description: null, slot, rarity: 'rare', render_kind: 'TINT', layer_urls: null,
    color, price_xu: 0, unlock_level: 1, is_default: false, print,
  })
  const items = [one('top', kit.top, kit.print)]
  for (const { slot } of KIT_PARTS) {
    const part = kit[slot]
    if (part) items.push(one(slot, part.color, partPrint(part)))
  }
  return items
}

/** Phần gửi lên máy chủ: {bottom: {color, print: {pattern}}, ...} */
export function kitParts(kit: KitDesign) {
  const out: Partial<Record<KitPartSlot, { color: string; print: ItemPrint | null }>> = {}
  for (const { slot } of KIT_PARTS) {
    const part = kit[slot]
    if (part) out[slot] = { color: part.color, print: partPrint(part) }
  }
  return out
}

/** Dựng lại thiết kế từ yêu cầu đã gửi (để sửa và gửi lại) */
export function kitFromRequest(r: { color: string; print: ItemPrint; parts?: Partial<Record<KitPartSlot, { color: string; print?: ItemPrint | null }>> | null }): KitDesign {
  const part = (s: KitPartSlot): KitPart | null => {
    const p = r.parts?.[s]
    return p ? { color: p.color, pattern: p.print?.pattern ?? null, tone: p.print?.tone ?? null, texture: p.print?.texture ?? null, layers: p.print?.layers ?? null } : null
  }
  return { top: r.color, print: r.print, bottom: part('bottom'), socks: part('socks'), shoes: part('shoes') }
}
