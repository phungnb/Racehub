// BIB điện tử do ban tổ chức thiết kế (migration 002900 → 003200). Phần kiểu dữ liệu + mặc định là hàm thuần;
// drawBib vẽ lên canvas ở trình duyệt (khổ 1400×1000 ≈ BIB giấy A5 ngang).
// Chữ trên BIB gồm 3 khung: Đơn vị tổ chức, Số BIB, Tên VĐV — mỗi khung tự đặt vị trí, căn lề, font, cỡ, màu.
import QRCode from 'qrcode'
import { distanceLabel } from './race'

export type BibTemplate = 'classic' | 'stripe' | 'neon' | 'minimal'
export interface BibColors { bg: string; band: string; number: string; text: string; accent: string }
export type ColorKey = keyof BibColors
export interface BibSponsor { name: string; logo_url: string | null }
export interface ArtFit { zoom: number; x: number; y: number }
export type TextAlign = 'left' | 'center' | 'right'
export type QrPos = 'right' | 'left' | 'corner'
export type BoxKey = 'org' | 'number' | 'name'
export type BibFont = 'sans' | 'mono' | 'condensed' | 'impact' | 'athletic' | 'tech' | 'slab' | 'stencil' | 'script' | 'serif'
export interface TextBox {
  show: boolean
  /** Tâm khung theo tỉ lệ khổ BIB (0..1) */
  x: number
  y: number
  align: TextAlign
  font: BibFont
  italic: boolean
  outline: boolean
  /** Hệ số cỡ chữ (0.3..2.5) so với cỡ chuẩn của khung */
  size: number
  color: ColorKey
}
export type BibBoxes = Record<BoxKey, TextBox>

export interface BibDesign {
  template: BibTemplate
  colors: Partial<BibColors>
  logo_url: string | null
  bg_url: string | null
  bg_opacity: number
  tagline: string | null
  sponsors: BibSponsor[]
  show_name: boolean
  show_qr: boolean
  /** Ảnh BIB có sẵn (Canva / Photoshop…) — chỉ dùng làm khung khi use_art */
  art_url: string | null
  use_art: boolean
  art_fit: ArtFit
  show_header: boolean
  show_sponsors: boolean
  qr_pos: QrPos
  /** Chữ Đơn vị tổ chức (trống = tên CLB / người tổ chức) */
  org_text: string | null
  boxes: BibBoxes
}

export const BIB_SIZE = { w: 1400, h: 1000 }

export const TEMPLATES: Record<BibTemplate, { label: string; hint: string; colors: BibColors }> = {
  classic: { label: 'Cổ điển', hint: 'Dải tên giải phía trên, số lớn ở giữa', colors: { bg: '#ffffff', band: '#1f4fd8', number: '#0a0d12', text: '#0a0d12', accent: '#ffc21a' } },
  stripe: { label: 'Sọc chéo', hint: 'Dải màu chéo phía sau số, năng động', colors: { bg: '#ffffff', band: '#ffc21a', number: '#1f4fd8', text: '#0a0d12', accent: '#ff8a1f' } },
  neon: { label: 'Neon đêm', hint: 'Nền tối, số phát sáng — hợp giải chạy đêm', colors: { bg: '#0a0d12', band: '#b6ff3b', number: '#b6ff3b', text: '#f2f5f9', accent: '#38bdf8' } },
  minimal: { label: 'Tối giản', hint: 'Một màu nền, chữ sạch', colors: { bg: '#f4f6f8', band: '#0a0d12', number: '#0a0d12', text: '#5b6472', accent: '#e11d48' } },
}

export const BOX_LABEL: Record<BoxKey, string> = { org: 'Đơn vị tổ chức', number: 'Số BIB', name: 'Tên VĐV' }
/** Cỡ chữ chuẩn (px trên BIB 1400×1000) khi size = 1 */
export const BOX_BASE_PX: Record<BoxKey, number> = { org: 44, number: 300, name: 64 }
export const ALIGNS: Record<TextAlign, string> = { left: 'Trái', center: 'Giữa', right: 'Phải' }
export const QR_POS: Record<QrPos, string> = { right: 'Bên phải', left: 'Bên trái', corner: 'Góc dưới' }
export const COLOR_LABEL: Record<ColorKey, string> = { bg: 'Nền', band: 'Dải chính', number: 'Số BIB', text: 'Chữ', accent: 'Điểm nhấn' }
export const FONTS: Record<BibFont, { label: string; weight: number }> = {
  sans: { label: 'Đậm', weight: 900 },
  mono: { label: 'Số đều', weight: 800 },
  condensed: { label: 'Hẹp', weight: 700 },
  impact: { label: 'Khối', weight: 400 },
  athletic: { label: 'Thể thao', weight: 800 },
  tech: { label: 'Kỹ thuật số', weight: 700 },
  slab: { label: 'Chân vuông', weight: 800 },
  stencil: { label: 'Quân đội', weight: 400 },
  script: { label: 'Viết tay', weight: 700 },
  serif: { label: 'Cổ điển', weight: 800 },
}

export type BibPreset = 'below' | 'above' | 'inline' | 'left'
export const PRESETS: Record<BibPreset, string> = { below: 'Tên dưới số', above: 'Tên trên số', inline: 'Cùng hàng', left: 'Căn trái' }

const BASE_BOXES: BibBoxes = {
  org: { show: true, x: 0.42, y: 0.3, align: 'center', font: 'sans', italic: false, outline: false, size: 1, color: 'text' },
  number: { show: true, x: 0.42, y: 0.54, align: 'center', font: 'mono', italic: false, outline: false, size: 1, color: 'number' },
  name: { show: true, x: 0.42, y: 0.72, align: 'center', font: 'sans', italic: false, outline: false, size: 1, color: 'text' },
}

/** Bố cục nhanh: đặt lại vị trí / căn lề / cỡ 3 khung, giữ font + màu đã chọn. Chừa chỗ cho QR. */
export function applyPreset(boxes: BibBoxes, preset: BibPreset, qr: QrPos | null): BibBoxes {
  const cx = qr === 'right' ? 0.42 : qr === 'left' ? 0.58 : 0.5
  const lx = qr === 'left' ? 0.26 : 0.06
  type Spot = [number, number, TextAlign, number]
  const all: Record<BibPreset, Record<BoxKey, Spot>> = {
    below: { org: [cx, 0.3, 'center', 1], number: [cx, 0.54, 'center', 1], name: [cx, 0.72, 'center', 1] },
    above: { org: [cx, 0.3, 'center', 1], name: [cx, 0.44, 'center', 1], number: [cx, 0.64, 'center', 1] },
    inline: { org: [cx, 0.32, 'center', 1], number: [cx + 0.04, 0.56, 'right', 0.8], name: [cx + 0.07, 0.56, 'left', 0.9] },
    left: { org: [lx, 0.3, 'left', 1], number: [lx, 0.54, 'left', 1], name: [lx, 0.72, 'left', 1] },
  }
  const pos = all[preset]
  const out = { ...boxes }
  for (const k of Object.keys(pos) as BoxKey[]) {
    const [x, y, align, size] = pos[k]
    out[k] = { ...boxes[k], x, y, align, size }
  }
  return out
}

export const DEFAULT_FIT: ArtFit = { zoom: 1, x: 0, y: 0 }
export const DEFAULT_BOXES: BibBoxes = applyPreset(BASE_BOXES, 'below', 'right')

export const DEFAULT_BIB: BibDesign = {
  template: 'classic', colors: {}, logo_url: null, bg_url: null, bg_opacity: 0.35, tagline: null, sponsors: [], show_name: true, show_qr: true,
  art_url: null, use_art: false, art_fit: DEFAULT_FIT, show_header: true, show_sponsors: true, qr_pos: 'right',
  org_text: null, boxes: DEFAULT_BOXES,
}

const clamp = (v: unknown, lo: number, hi: number, def: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : def)
const pick = <T extends string>(v: unknown, all: Record<T, unknown>, def: T): T => (typeof v === 'string' && v in all ? (v as T) : def)
const bool = (v: unknown, def: boolean) => (typeof v === 'boolean' ? v : def)

function cleanBox(b: Partial<TextBox> | undefined, def: TextBox): TextBox {
  return {
    show: bool(b?.show, def.show), x: clamp(b?.x, 0, 1, def.x), y: clamp(b?.y, 0, 1, def.y),
    align: pick(b?.align, ALIGNS, def.align), font: pick(b?.font, FONTS, def.font),
    italic: bool(b?.italic, def.italic), outline: bool(b?.outline, def.outline),
    size: clamp(b?.size, 0.3, 2.5, def.size), color: pick(b?.color, COLOR_LABEL, def.color),
  }
}

/** Thiết kế lưu bởi bản 003000 (text.layout …) → 3 khung */
interface LegacyText { layout?: string; align?: string; font?: string; y?: number; scale?: number; name_scale?: number }
function legacyBoxes(t: LegacyText, qr: QrPos): BibBoxes {
  const preset: BibPreset = t.align === 'left' ? 'left' : t.layout === 'above' ? 'above' : t.layout === 'inline' ? 'inline' : 'below'
  const b = applyPreset(DEFAULT_BOXES, preset, qr)
  const style = { italic: t.font === 'italic', outline: t.font === 'outline' }
  const dy = (clamp(t.y, 0.15, 0.85, 0.5) - 0.5) * 0.5
  return {
    org: { ...b.org, y: b.org.y + dy },
    number: { ...b.number, ...style, font: t.font === 'mono' || !t.font ? 'mono' : 'sans', y: b.number.y + dy, size: b.number.size * clamp(t.scale, 0.5, 1.5, 1) },
    name: { ...b.name, italic: style.italic, y: b.name.y + dy, size: b.name.size * clamp(t.name_scale, 0.5, 1.5, 1) },
  }
}

export type StoredDesign = Partial<Omit<BibDesign, 'boxes'>> & { boxes?: Partial<Record<BoxKey, Partial<TextBox>>>; text?: LegacyText }

/** Thiết kế đã lưu (có thể null / thiếu trường) → đủ trường, màu = màu mẫu + màu BTC chọn */
export function resolveBib(d: StoredDesign | null | undefined): BibDesign & { palette: BibColors } {
  const template = d?.template && d.template in TEMPLATES ? d.template : 'classic'
  const f: Partial<ArtFit> = d?.art_fit ?? {}
  const qr_pos = pick(d?.qr_pos, QR_POS, 'right')
  const boxes: BibBoxes = d?.boxes
    ? { org: cleanBox(d.boxes.org, DEFAULT_BOXES.org), number: cleanBox(d.boxes.number, DEFAULT_BOXES.number), name: cleanBox(d.boxes.name, DEFAULT_BOXES.name) }
    : d?.text ? legacyBoxes(d.text, qr_pos) : { ...DEFAULT_BOXES }
  if (!d?.boxes && d?.show_name === false) boxes.name = { ...boxes.name, show: false }
  const design: BibDesign = {
    template, colors: { ...(d?.colors ?? {}) },
    logo_url: d?.logo_url ?? null, bg_url: d?.bg_url ?? null, bg_opacity: clamp(d?.bg_opacity, 0, 1, 0.35),
    tagline: d?.tagline ?? null, sponsors: (d?.sponsors ?? []).slice(0, 4),
    show_name: boxes.name.show, show_qr: bool(d?.show_qr, true),
    art_url: d?.art_url ?? null, use_art: !!(d?.use_art && d?.art_url),
    art_fit: { zoom: clamp(f.zoom, 0.5, 3, 1), x: clamp(f.x, -1, 1, 0), y: clamp(f.y, -1, 1, 0) },
    show_header: bool(d?.show_header, true), show_sponsors: bool(d?.show_sponsors, true),
    qr_pos, org_text: d?.org_text?.trim() || null, boxes,
  }
  return { ...design, palette: { ...TEMPLATES[template].colors, ...design.colors } }
}

/** Bản nháp cho trình thiết kế (bỏ bảng màu tính sẵn) */
export function editableBib(d: StoredDesign | null | undefined): BibDesign {
  const { palette, ...rest } = resolveBib(d)
  void palette
  return rest
}

/** Dữ liệu gửi RPC set_race_bib_design (chỉ màu khác mẫu mới lưu) */
export function bibPayload(d: BibDesign) {
  const base = TEMPLATES[d.template].colors
  const colors = Object.fromEntries(Object.entries(d.colors).filter(([k, v]) => v && v.toLowerCase() !== base[k as keyof BibColors]))
  return { ...d, colors, tagline: d.tagline?.trim() || null, org_text: d.org_text?.trim() || null, use_art: d.use_art && !!d.art_url,
    show_name: d.boxes.name.show,
    sponsors: d.sponsors.filter((s) => s.name.trim() || s.logo_url).map((s) => ({ ...s, name: s.name.trim() })) }
}

/** Vị trí ảnh khung trên BIB: phủ kín × zoom, x / y ∈ [-1, 1] dịch tới mép ảnh (1 = sang phải / xuống) */
export function artRect(iw: number, ih: number, fit: ArtFit) {
  const { w, h } = BIB_SIZE
  const s = Math.max(w / iw, h / ih) * fit.zoom
  const dw = iw * s, dh = ih * s
  return { x: ((w - dw) / 2) * (1 - fit.x), y: ((h - dh) / 2) * (1 - fit.y), w: dw, h: dh }
}

/** Kéo ảnh khung dxc / dyc (px trên BIB) → art_fit mới; trục nào ảnh vừa khít thì không dịch */
export function panArt(fit: ArtFit, dxc: number, dyc: number, iw: number, ih: number): ArtFit {
  const r = artRect(iw, ih, fit)
  const move = (v: number, d: number, span: number) => (Math.abs(span) < 1 ? v : Math.min(1, Math.max(-1, v + (2 * d) / span)))
  return { ...fit, x: move(fit.x, dxc, r.w - BIB_SIZE.w), y: move(fit.y, dyc, r.h - BIB_SIZE.h) }
}

/** Kéo một khung chữ dxc / dyc (px trên BIB) */
export function moveBox(b: TextBox, dxc: number, dyc: number): TextBox {
  return { ...b, x: Math.min(1, Math.max(0, b.x + dxc / BIB_SIZE.w)), y: Math.min(1, Math.max(0, b.y + dyc / BIB_SIZE.h)) }
}

export interface Rect { x: number; y: number; w: number; h: number }
export interface BibLayout { boxes: Partial<Record<BoxKey, Rect>> }

/** Khung chữ dưới điểm (px trên BIB); ưu tiên khung nhỏ (tên, đơn vị) khi chồng nhau */
export function hitBox(layout: BibLayout | null, x: number, y: number, pad = 16): BoxKey | null {
  if (!layout) return null
  for (const k of ['name', 'org', 'number'] as BoxKey[]) {
    const r = layout.boxes[k]
    if (r && x >= r.x - pad && x <= r.x + r.w + pad && y >= r.y - pad && y <= r.y + r.h + pad) return k
  }
  return null
}

export interface BibData {
  race: string
  bib: string
  name: string | null
  /** Tên CLB / người tổ chức (khi BTC chưa nhập chữ riêng) */
  org: string | null
  distanceKm: number
  dates: string
  qrUrl: string | null
}

// ---------------------------------------------------------------------
// Vẽ (trình duyệt)
// ---------------------------------------------------------------------
const families: Partial<Record<BibFont, string>> = {}
/** bibFonts.ts (next/font) đăng ký tên font thật */
export function registerBibFonts(map: Partial<Record<BibFont, string>>) {
  Object.assign(families, map)
  return map
}

const images = new Map<string, Promise<HTMLImageElement | null>>()
function loadImage(src: string | null | undefined): Promise<HTMLImageElement | null> {
  if (!src) return Promise.resolve(null)
  if (!images.has(src)) {
    images.set(src, new Promise((resolve) => {
      const im = new Image()
      im.crossOrigin = 'anonymous'                 // ảnh Supabase Storage có CORS → canvas vẫn xuất PNG được
      im.onload = () => resolve(im)
      im.onerror = () => resolve(null)
      im.src = src
    }))
  }
  return images.get(src)!
}

const qrs = new Map<string, Promise<HTMLImageElement | null>>()
function loadQr(url: string) {
  if (!qrs.has(url)) qrs.set(url, QRCode.toDataURL(url, { margin: 1, width: 360, errorCorrectionLevel: 'M' }).then(loadImage))
  return qrs.get(url)!
}

function baseFonts() {
  const root = getComputedStyle(document.documentElement)
  return {
    sans: root.getPropertyValue('--font-be-vietnam').trim() || 'system-ui, sans-serif',
    mono: root.getPropertyValue('--font-jetbrains').trim() || 'ui-monospace, monospace',
  }
}

function fitFont(ctx: CanvasRenderingContext2D, text: string, font: (px: number) => string, start: number, maxW: number) {
  let px = start
  ctx.font = font(px)
  while (ctx.measureText(text).width > maxW && px > 16) { px -= Math.max(2, Math.round(px / 40)); ctx.font = font(px) }
  return px
}

function drawContain(ctx: CanvasRenderingContext2D, im: HTMLImageElement, x: number, y: number, w: number, h: number) {
  const s = Math.min(w / im.width, h / im.height)
  const dw = im.width * s, dh = im.height * s
  ctx.drawImage(im, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh)
}

function drawCover(ctx: CanvasRenderingContext2D, im: HTMLImageElement, w: number, h: number) {
  const s = Math.max(w / im.width, h / im.height)
  ctx.drawImage(im, (w - im.width * s) / 2, (h - im.height * s) / 2, im.width * s, im.height * s)
}

/** Màu chữ đọc được trên nền `hex` */
function onColor(hex: string) {
  const n = parseInt(hex.slice(1), 16)
  const l = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255
  return l > 0.6 ? '#0a0d12' : '#ffffff'
}

export async function drawBib(canvas: HTMLCanvasElement, design: StoredDesign | null | undefined, data: BibData): Promise<BibLayout> {
  const d = resolveBib(design)
  const c = d.palette
  const { w, h } = BIB_SIZE
  const ctx = canvas.getContext('2d')!
  const { sans, mono } = baseFonts()
  const family = (f: BibFont) => (f === 'mono' ? mono : f === 'sans' ? sans : families[f] ? `${families[f]}, ${sans}` : sans)
  const fontCss = (b: TextBox, px: number) => `${b.italic ? 'italic ' : ''}${FONTS[b.font].weight} ${px}px ${family(b.font)}`
  const texts: Record<BoxKey, string | null> = {
    org: d.org_text ?? data.org,
    number: data.bib,
    name: data.name ? data.name.toUpperCase() : null,
  }
  const shown = (Object.keys(texts) as BoxKey[]).filter((k) => d.boxes[k].show && texts[k])
  const sponsors = d.show_sponsors ? d.sponsors : []
  const [logo, bg, artIm, qr, ...sponsorLogos] = await Promise.all([
    d.show_header ? loadImage(d.logo_url) : Promise.resolve(null),
    d.use_art ? Promise.resolve(null) : loadImage(d.bg_url),
    d.use_art ? loadImage(d.art_url) : Promise.resolve(null),
    d.show_qr && data.qrUrl ? loadQr(data.qrUrl) : Promise.resolve(null),
    ...sponsors.map((s) => loadImage(s.logo_url)),
    // Font Google chỉ tải khi cần: chờ tải xong mới vẽ để chữ đúng font ngay lần đầu
    ...shown.map((k) => Promise.resolve(document.fonts?.load(fontCss(d.boxes[k], 100), texts[k]!)).catch(() => null).then(() => null)),
  ])
  canvas.width = w
  canvas.height = h
  const framed = !!artIm                              // dùng ảnh BIB có sẵn làm khung → bỏ trang trí của mẫu

  // Nền: ảnh khung (phủ kín × zoom, dịch theo art_fit) hoặc màu nền + ảnh nền mờ
  ctx.fillStyle = c.bg
  ctx.fillRect(0, 0, w, h)
  if (artIm) {
    const r = artRect(artIm.width, artIm.height, d.art_fit)
    ctx.drawImage(artIm, r.x, r.y, r.w, r.h)
  } else if (bg) { ctx.save(); ctx.globalAlpha = d.bg_opacity; drawCover(ctx, bg, w, h); ctx.restore() }

  const sponsorH = sponsors.length ? 150 : 0
  const headerH = d.show_header ? (d.template === 'classic' && !framed ? 210 : 170) : 0
  const footH = framed ? 0 : 56

  // Trang trí theo mẫu
  if (!framed) {
    if (d.template === 'classic' && headerH) {
      ctx.fillStyle = c.band
      ctx.fillRect(0, 0, w, headerH)
      ctx.fillStyle = c.accent
      ctx.fillRect(0, headerH, w, 12)
    } else if (d.template === 'stripe') {
      ctx.save()
      ctx.fillStyle = c.band
      ctx.beginPath(); ctx.moveTo(0, h * 0.78); ctx.lineTo(w, h * 0.18); ctx.lineTo(w, h * 0.52); ctx.lineTo(0, h * 1.12); ctx.closePath(); ctx.fill()
      ctx.fillStyle = c.accent
      ctx.beginPath(); ctx.moveTo(0, h * 0.74); ctx.lineTo(w, h * 0.14); ctx.lineTo(w, h * 0.18); ctx.lineTo(0, h * 0.78); ctx.closePath(); ctx.fill()
      ctx.restore()
    } else if (d.template === 'neon') {
      ctx.fillStyle = c.band
      ctx.fillRect(0, 0, w, 10)
      ctx.fillRect(0, h - 10, w, 10)
    } else if (d.template === 'minimal' && headerH) {
      ctx.fillStyle = c.band
      ctx.fillRect(60, headerH - 10, w - 120, 4)
    }
  }

  // Đầu BIB: logo + tên giải + khẩu hiệu; cự ly bên phải
  if (headerH) {
    const banded = d.template === 'classic' && !framed
    let tx = 70
    if (logo) { drawContain(ctx, logo, 60, 30, 150, headerH - 60); tx = 240 }
    const distText = distanceLabel(data.distanceKm).toUpperCase()
    ctx.font = `800 40px ${sans}`
    const chipW = ctx.measureText(distText).width + 60
    const chipC = banded ? c.accent : c.band
    ctx.fillStyle = chipC
    ctx.beginPath(); ctx.roundRect(w - 60 - chipW, headerH / 2 - 38, chipW, 76, 38); ctx.fill()
    ctx.fillStyle = onColor(chipC)
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.fillText(distText, w - 60 - chipW / 2, headerH / 2 + 2)
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'
    ctx.fillStyle = banded ? onColor(c.band) : c.text
    const titleMax = w - tx - chipW - 110
    fitFont(ctx, data.race.toUpperCase(), (px) => `900 ${px}px ${sans}`, 62, titleMax)
    ctx.fillText(data.race.toUpperCase(), tx, d.tagline ? headerH / 2 - 4 : headerH / 2 + 20)
    if (d.tagline) {
      ctx.globalAlpha = 0.8
      fitFont(ctx, d.tagline, (px) => `600 ${px}px ${sans}`, 34, titleMax)
      ctx.fillText(d.tagline, tx, headerH / 2 + 42)
      ctx.globalAlpha = 1
    }
  }

  // Mã QR: vị trí tính trước để khung chữ tự thu nhỏ, không đè lên QR
  const top = headerH ? headerH + 30 : 50
  const bottom = h - sponsorH - footH - 20
  const qrSize = qr ? (d.qr_pos === 'corner' ? 180 : 230) : 0
  let qrRect: Rect | null = null
  if (qr) {
    const qx = d.qr_pos === 'left' ? 60 : d.qr_pos === 'right' ? w - 60 - qrSize : w - 50 - qrSize
    const qy = d.qr_pos === 'corner' ? bottom - qrSize - 40
      : Math.max(top, Math.min(bottom - qrSize - 44, d.boxes.number.y * h - qrSize / 2 - 16))
    qrRect = { x: qx - 12, y: qy - 12, w: qrSize + 24, h: qrSize + 56 }
  }

  // 3 khung chữ
  const layout: BibLayout = { boxes: {} }
  const CAP = 0.74                                     // chiều cao chữ hoa ≈ 0.74 × cỡ chữ
  for (const k of ['org', 'number', 'name'] as BoxKey[]) {
    const b = d.boxes[k]
    const text = texts[k]
    if (!b.show || !text) continue
    const X = b.x * w, Y = b.y * h
    const start = Math.round(BOX_BASE_PX[k] * b.size)
    let L = 40, R = w - 40
    if (qrRect && Y + start * 0.4 > qrRect.y && Y - start * 0.4 < qrRect.y + qrRect.h) {
      if (qrRect.x + qrRect.w / 2 > X) R = Math.min(R, qrRect.x - 24)
      else L = Math.max(L, qrRect.x + qrRect.w + 24)
    }
    const maxW = Math.max(80, b.align === 'left' ? R - X : b.align === 'right' ? X - L : 2 * Math.min(X - L, R - X))
    const px = fitFont(ctx, text, (p) => fontCss(b, p), start, maxW)
    ctx.textAlign = b.align
    const base = Y + (px * CAP) / 2
    const color = c[b.color]
    if (b.outline) {
      ctx.lineJoin = 'round'
      ctx.lineWidth = Math.max(2, px / 16)
      ctx.strokeStyle = color
      ctx.strokeText(text, X, base)
    } else {
      ctx.fillStyle = color
      if (k === 'number' && d.template === 'neon' && !framed) { ctx.shadowColor = color; ctx.shadowBlur = 40 }
      ctx.fillText(text, X, base)
      ctx.shadowBlur = 0
    }
    const tw = ctx.measureText(text).width
    layout.boxes[k] = { x: b.align === 'left' ? X : b.align === 'right' ? X - tw : X - tw / 2, y: Y - (px * CAP) / 2, w: tw, h: px * CAP }
  }

  // Mã QR xác thực (nền trắng + chú thích trong khung → quét được trên mọi nền)
  if (qr && qrRect) {
    const qx = qrRect.x + 12, qy = qrRect.y + 12
    ctx.fillStyle = '#ffffff'
    ctx.beginPath(); ctx.roundRect(qrRect.x, qrRect.y, qrRect.w, qrRect.h, 18); ctx.fill()
    ctx.drawImage(qr, qx, qy, qrSize, qrSize)
    ctx.fillStyle = '#0a0d12'
    ctx.textAlign = 'center'
    fitFont(ctx, 'Quét để xác thực', (p) => `600 ${p}px ${sans}`, 22, qrSize)
    ctx.fillText('Quét để xác thực', qx + qrSize / 2, qy + qrSize + 30)
  }

  // Dải nhà tài trợ
  if (sponsorH) {
    const y0 = h - sponsorH
    ctx.fillStyle = framed ? 'rgba(255,255,255,0.88)' : d.template === 'neon' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)'
    ctx.fillRect(0, y0, w, sponsorH)
    const slot = (w - 120) / sponsors.length
    ctx.textAlign = 'center'
    sponsors.forEach((s, i) => {
      const x = 60 + i * slot
      const im = sponsorLogos[i]
      if (im) drawContain(ctx, im, x + 20, y0 + 22, slot - 40, sponsorH - 44)
      else {
        ctx.fillStyle = framed ? '#0a0d12' : c.text
        fitFont(ctx, s.name, (p) => `800 ${p}px ${sans}`, 40, slot - 40)
        ctx.fillText(s.name, x + slot / 2, y0 + sponsorH / 2 + 14)
      }
    })
  }

  if (framed) return layout                            // ảnh có sẵn đã có chân / lỗ ghim riêng

  // Chân: ngày giải + nhãn e-BIB
  ctx.textAlign = 'left'
  ctx.fillStyle = c.text
  ctx.globalAlpha = 0.65
  ctx.font = `600 24px ${sans}`
  ctx.fillText(`${data.dates} · e-BIB RaceHub`, 70, h - sponsorH - 28)
  ctx.globalAlpha = 1

  // Lỗ ghim 4 góc (như BIB giấy)
  for (const [x, y] of [[34, 34], [w - 34, 34], [34, h - 34], [w - 34, h - 34]]) {
    ctx.beginPath(); ctx.arc(x, y, 11, 0, Math.PI * 2)
    ctx.fillStyle = d.template === 'neon' ? '#1d2330' : '#d9dde3'
    ctx.fill()
  }
  return layout
}
