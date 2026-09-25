// Engine thiết kế theo lớp dùng chung cho e-BIB và Giấy chứng nhận (hàm thuần + vẽ canvas ở trình duyệt).
// Mọi phần tử (chữ, ảnh / logo, mã QR, hình trang trí) là một lớp: kéo thả, xoay, phóng to, đổi thứ tự, ẩn / khóa.
// Vị trí lưu theo tỉ lệ khổ (0..1) nên đổi khổ vẫn giữ bố cục.
import QRCode from 'qrcode'

// ---------------------------------------------------------------------
// Màu
// ---------------------------------------------------------------------
export type ColorKey = 'bg' | 'band' | 'number' | 'text' | 'accent'
export type Palette = Record<ColorKey, string>
/** Một màu trong bảng màu thiết kế hoặc mã hex tự chọn */
export type Paint = string
export const COLOR_KEYS: ColorKey[] = ['bg', 'band', 'number', 'text', 'accent']
const HEX = /^#[0-9a-fA-F]{6}$/
export const isHex = (v: unknown): v is string => typeof v === 'string' && HEX.test(v)
export const isColorKey = (v: unknown): v is ColorKey => typeof v === 'string' && (COLOR_KEYS as string[]).includes(v)
export const paint = (p: Paint, pal: Palette) => (isColorKey(p) ? pal[p] : isHex(p) ? p : pal.text)

/** Màu chữ đọc được trên nền `hex` */
export function onColor(hex: string) {
  if (!isHex(hex)) return '#ffffff'
  const n = parseInt(hex.slice(1), 16)
  const l = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255
  return l > 0.6 ? '#0a0d12' : '#ffffff'
}

// ---------------------------------------------------------------------
// Font (đều có bộ chữ tiếng Việt; nhúng sẵn trong app → VĐV nào mở cũng thấy đúng font)
// ---------------------------------------------------------------------
export const FONT_GROUPS = {
  display: 'Đậm & khối',
  condensed: 'Chữ hẹp (số BIB)',
  sport: 'Thể thao & kỹ thuật',
  serif: 'Có chân · sang trọng',
  hand: 'Viết tay & phá cách',
} as const
export type FontGroup = keyof typeof FONT_GROUPS

export const FONTS = {
  sans: { label: 'Be Vietnam', group: 'display', weight: 800 },
  montserrat: { label: 'Montserrat', group: 'display', weight: 900 },
  inter: { label: 'Inter Tight', group: 'display', weight: 900 },
  lexend: { label: 'Lexend', group: 'display', weight: 800 },
  unbounded: { label: 'Unbounded', group: 'display', weight: 800 },
  impact: { label: 'Anton', group: 'display', weight: 400 },
  dela: { label: 'Dela Gothic', group: 'display', weight: 400 },
  paytone: { label: 'Paytone', group: 'display', weight: 400 },
  sigmar: { label: 'Sigmar', group: 'display', weight: 400 },
  bungee: { label: 'Bungee', group: 'display', weight: 400 },
  bungee_shade: { label: 'Bungee Shade', group: 'display', weight: 400 },
  rowdies: { label: 'Rowdies', group: 'display', weight: 700 },
  condensed: { label: 'Oswald', group: 'condensed', weight: 700 },
  athletic: { label: 'Barlow Cond.', group: 'condensed', weight: 800 },
  saira: { label: 'Saira Cond.', group: 'condensed', weight: 800 },
  roboto_c: { label: 'Roboto Cond.', group: 'condensed', weight: 800 },
  asap_c: { label: 'Asap Cond.', group: 'condensed', weight: 800 },
  fjalla: { label: 'Fjalla', group: 'condensed', weight: 400 },
  mono: { label: 'JetBrains Mono', group: 'sport', weight: 800 },
  tech: { label: 'Chakra Petch', group: 'sport', weight: 700 },
  exo: { label: 'Exo 2', group: 'sport', weight: 800 },
  kanit: { label: 'Kanit', group: 'sport', weight: 800 },
  tourney: { label: 'Tourney', group: 'sport', weight: 800 },
  protest: { label: 'Protest Strike', group: 'sport', weight: 400 },
  stencil: { label: 'Black Ops', group: 'sport', weight: 400 },
  slab: { label: 'Roboto Slab', group: 'serif', weight: 800 },
  alfa: { label: 'Alfa Slab', group: 'serif', weight: 400 },
  serif: { label: 'Playfair', group: 'serif', weight: 800 },
  cormorant: { label: 'Cormorant', group: 'serif', weight: 700 },
  garamond: { label: 'EB Garamond', group: 'serif', weight: 700 },
  yeseva: { label: 'Yeseva', group: 'serif', weight: 400 },
  script: { label: 'Dancing Script', group: 'hand', weight: 700 },
  vibes: { label: 'Great Vibes', group: 'hand', weight: 400 },
  allura: { label: 'Allura', group: 'hand', weight: 400 },
  pacifico: { label: 'Pacifico', group: 'hand', weight: 400 },
  lobster: { label: 'Lobster', group: 'hand', weight: 400 },
  graffiti: { label: 'Graffiti', group: 'hand', weight: 400 },
  brush: { label: 'Protest Rev.', group: 'hand', weight: 400 },
  bangers: { label: 'Bangers', group: 'hand', weight: 400 },
  patrick: { label: 'Patrick Hand', group: 'hand', weight: 400 },
} as const satisfies Record<string, { label: string; group: FontGroup; weight: number }>
export type FontKey = keyof typeof FONTS

const families: Partial<Record<FontKey, string>> = {}
/** designFonts.ts (next/font) đăng ký tên font thật */
export function registerFonts(map: Partial<Record<FontKey, string>>) {
  Object.assign(families, map)
  return map
}
function baseFonts() {
  if (typeof document === 'undefined') return { sans: 'system-ui, sans-serif', mono: 'ui-monospace, monospace' }
  const root = getComputedStyle(document.documentElement)
  return {
    sans: root.getPropertyValue('--font-be-vietnam').trim() || 'system-ui, sans-serif',
    mono: root.getPropertyValue('--font-jetbrains').trim() || 'ui-monospace, monospace',
  }
}
export function fontFamily(f: FontKey) {
  const { sans, mono } = baseFonts()
  if (f === 'sans') return sans
  if (f === 'mono') return `${mono}, ${sans}`
  return families[f] ? `${families[f]}, ${sans}` : sans
}

// ---------------------------------------------------------------------
// Lớp
// ---------------------------------------------------------------------
export type TextAlign = 'left' | 'center' | 'right'
export const ALIGNS: Record<TextAlign, string> = { left: 'Trái', center: 'Giữa', right: 'Phải' }

export const TEXT_FX = {
  none: 'Thường',
  outline: 'Viền rỗng',
  stroke: 'Viền dày',
  shadow: 'Đổ bóng',
  glow: 'Phát sáng',
  extrude: 'Nổi khối 3D',
  marker: 'Bôi dạ quang',
  box: 'Nền khối',
  pill: 'Nền bo tròn',
  slant: 'Băng chéo',
  underline: 'Gạch chân đậm',
} as const
export type TextFx = keyof typeof TEXT_FX

export const QR_SOURCES = {
  verify: 'Xác thực VĐV',
  race: 'Trang giải',
  club: 'Đơn vị tổ chức',
  fee: 'Phí tham gia',
  link: 'Đường link',
  image: 'Ảnh QR tải lên',
} as const
export type QrSource = keyof typeof QR_SOURCES

export const SHAPES = { rect: 'Chữ nhật', round: 'Bo góc', pill: 'Viên thuốc', circle: 'Tròn', line: 'Đường kẻ', slash: 'Băng chéo', laurel: 'Nguyệt quế', seal: 'Con dấu' } as const
export type ShapeKind = keyof typeof SHAPES

export const IMAGE_ROLES = { logo: 'Logo', sponsor: 'Nhà tài trợ', image: 'Ảnh', signature: 'Chữ ký' } as const
export type ImageRole = keyof typeof IMAGE_ROLES

interface LayerBase {
  id: string
  /** Tâm / điểm neo theo tỉ lệ khổ (0..1) */
  x: number
  y: number
  /** Góc xoay (độ) */
  rot: number
  opacity: number
  hidden: boolean
  locked: boolean
}
export interface TextLayer extends LayerBase {
  type: 'text'
  /** Nguồn chữ: một trường dữ liệu (số BIB, tên VĐV…) hoặc 'custom' = chữ tự nhập */
  bind: string
  text: string
  font: FontKey
  /** Cỡ chữ (px trên khổ thiết kế) */
  size: number
  /** Bề ngang tối đa (tỉ lệ khổ) — chữ dài tự co lại */
  w: number
  align: TextAlign
  color: Paint
  italic: boolean
  upper: boolean
  /** Giãn chữ (em) */
  spacing: number
  fx: TextFx
  fx_color: Paint
}
export interface ImageLayer extends LayerBase {
  type: 'image'
  role: ImageRole
  src: string | null
  /** Chữ thay thế khi chưa có ảnh (tên nhà tài trợ) */
  name: string
  w: number
  h: number
}
export interface QrLayer extends LayerBase {
  type: 'qr'
  source: QrSource
  /** Ảnh QR (phí tham gia đã lưu / ảnh tải lên) */
  src: string | null
  /** Nội dung QR (đường link, mã chuyển khoản VietQR) */
  url: string
  /** Cạnh QR (tỉ lệ bề ngang khổ) */
  w: number
  label: string
  card: boolean
}
export interface ShapeLayer extends LayerBase {
  type: 'shape'
  shape: ShapeKind
  w: number
  h: number
  fill: Paint
}
export type Layer = TextLayer | ImageLayer | QrLayer | ShapeLayer
export type LayerType = Layer['type']
export const MAX_LAYERS = 40

export interface Bind { label: string; sample: string }
export type Binds = Record<string, Bind>

export const newId = () => Math.random().toString(36).slice(2, 10)
const BASE = { rot: 0, opacity: 1, hidden: false, locked: false }

export function textLayer(p: Partial<TextLayer> & Pick<TextLayer, 'x' | 'y'>): TextLayer {
  return { ...BASE, id: newId(), type: 'text', bind: 'custom', text: '', font: 'sans', size: 48, w: 0.8, align: 'center', color: 'text',
    italic: false, upper: false, spacing: 0, fx: 'none', fx_color: 'accent', ...p }
}
export function imageLayer(p: Partial<ImageLayer> & Pick<ImageLayer, 'x' | 'y'>): ImageLayer {
  return { ...BASE, id: newId(), type: 'image', role: 'image', src: null, name: '', w: 0.16, h: 0.12, ...p }
}
export function qrLayer(p: Partial<QrLayer> & Pick<QrLayer, 'x' | 'y'>): QrLayer {
  return { ...BASE, id: newId(), type: 'qr', source: 'verify', src: null, url: '', w: 0.14, label: 'Quét để xác thực', card: true, ...p }
}
export function shapeLayer(p: Partial<ShapeLayer> & Pick<ShapeLayer, 'x' | 'y'>): ShapeLayer {
  return { ...BASE, id: newId(), type: 'shape', shape: 'rect', w: 0.3, h: 0.1, fill: 'band', ...p }
}

// ---------------------------------------------------------------------
// Làm sạch (dữ liệu lưu có thể thiếu / hỏng) — máy chủ làm sạch lại lần nữa khi lưu
// ---------------------------------------------------------------------
const num = (v: unknown, lo: number, hi: number, def: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : def)
const bool = (v: unknown, def: boolean) => (typeof v === 'boolean' ? v : def)
const pick = <T extends string>(v: unknown, all: Record<T, unknown>, def: T): T => (typeof v === 'string' && v in all ? (v as T) : def)
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '')
const paintOr = (v: unknown, def: Paint): Paint => (isHex(v) ? v.toLowerCase() : isColorKey(v) ? v : def)
const url = (v: unknown) => (typeof v === 'string' && /^https:\/\//.test(v) ? v.slice(0, 500) : null)

export function cleanLayer(raw: unknown, binds: Binds): Layer | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const base = {
    id: typeof r.id === 'string' && /^[A-Za-z0-9_-]{1,24}$/.test(r.id) ? r.id : newId(),
    x: num(r.x, -0.2, 1.2, 0.5), y: num(r.y, -0.2, 1.2, 0.5), rot: num(r.rot, -180, 180, 0), opacity: num(r.opacity, 0.05, 1, 1),
    hidden: bool(r.hidden, false), locked: bool(r.locked, false),
  }
  switch (r.type) {
    case 'text':
      return { ...base, type: 'text', bind: typeof r.bind === 'string' && (r.bind in binds || r.bind === 'custom') ? r.bind : 'custom',
        text: str(r.text, 120), font: pick(r.font, FONTS, 'sans'), size: num(r.size, 8, 800, 48), w: num(r.w, 0.03, 1.2, 0.8),
        align: pick(r.align, ALIGNS, 'center'), color: paintOr(r.color, 'text'), italic: bool(r.italic, false), upper: bool(r.upper, false),
        spacing: num(r.spacing, -0.1, 1, 0), fx: pick(r.fx, TEXT_FX, 'none'), fx_color: paintOr(r.fx_color, 'accent') }
    case 'image':
      return { ...base, type: 'image', role: pick(r.role, IMAGE_ROLES, 'image'), src: url(r.src), name: str(r.name, 40),
        w: num(r.w, 0.02, 1.2, 0.16), h: num(r.h, 0.02, 1.2, 0.12) }
    case 'qr':
      return { ...base, type: 'qr', source: pick(r.source, QR_SOURCES, 'verify'), src: url(r.src), url: str(r.url, 400),
        w: num(r.w, 0.05, 0.6, 0.14), label: str(r.label, 40), card: bool(r.card, true) }
    case 'shape':
      return { ...base, type: 'shape', shape: pick(r.shape, SHAPES, 'rect'), w: num(r.w, 0.005, 1.5, 0.3), h: num(r.h, 0.003, 1.5, 0.1),
        fill: paintOr(r.fill, 'band') }
    default:
      return null
  }
}

export function cleanLayers(raw: unknown, binds: Binds): Layer[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: Layer[] = []
  for (const r of raw.slice(0, MAX_LAYERS)) {
    const l = cleanLayer(r, binds)
    if (!l) continue
    if (seen.has(l.id)) l.id = newId()
    seen.add(l.id)
    out.push(l)
  }
  return out
}

// ---------------------------------------------------------------------
// Chỉnh sửa
// ---------------------------------------------------------------------
export interface Size { w: number; h: number }
export interface Hit { cx: number; cy: number; w: number; h: number; rot: number }
export type Layout = Record<string, Hit>

const SNAP = 8   // px trên khổ thiết kế

/** Kéo một lớp dx / dy (px trên khổ); tự hít vào đường giữa khổ. Trả về lớp mới + đường gióng đang hít */
export function moveLayer<L extends Layer>(l: L, dx: number, dy: number, size: Size): { layer: L; guideX: boolean; guideY: boolean } {
  let x = Math.min(1.2, Math.max(-0.2, l.x + dx / size.w))
  let y = Math.min(1.2, Math.max(-0.2, l.y + dy / size.h))
  const guideX = l.type !== 'text' || l.align === 'center' ? Math.abs(x - 0.5) * size.w < SNAP : false
  const guideY = Math.abs(y - 0.5) * size.h < SNAP
  if (guideX) x = 0.5
  if (guideY) y = 0.5
  return { layer: { ...l, x, y }, guideX, guideY }
}

/** Phóng to / thu nhỏ một lớp theo hệ số k */
export function scaleLayer<L extends Layer>(l: L, k: number): L {
  const s = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v * k))
  switch (l.type) {
    case 'text': return { ...l, size: Math.round(s(l.size, 8, 800)), w: s(l.w, 0.03, 1.2) }
    case 'image': return { ...l, w: s(l.w, 0.02, 1.2), h: s(l.h, 0.02, 1.2) }
    case 'qr': return { ...l, w: s(l.w, 0.05, 0.6) }
    case 'shape': return { ...l, w: s(l.w, 0.005, 1.5), h: l.shape === 'line' ? l.h : s(l.h, 0.003, 1.5) }
  }
}

/** Lớp trên cùng dưới điểm (px trên khổ); lớp ẩn bỏ qua */
export function hitTest(layers: Layer[], layout: Layout, x: number, y: number, pad = 10): string | null {
  for (let i = layers.length - 1; i >= 0; i--) {
    const l = layers[i]
    const h = layout[l.id]
    if (l.hidden || !h) continue
    const a = (-h.rot * Math.PI) / 180
    const dx = x - h.cx, dy = y - h.cy
    const lx = dx * Math.cos(a) - dy * Math.sin(a), ly = dx * Math.sin(a) + dy * Math.cos(a)
    if (Math.abs(lx) <= h.w / 2 + pad && Math.abs(ly) <= h.h / 2 + pad) return l.id
  }
  return null
}

export function moveInStack(layers: Layer[], id: string, dir: 'up' | 'down' | 'top' | 'bottom'): Layer[] {
  const i = layers.findIndex((l) => l.id === id)
  if (i < 0) return layers
  const out = [...layers]
  const [l] = out.splice(i, 1)
  const j = dir === 'top' ? out.length : dir === 'bottom' ? 0 : dir === 'up' ? Math.min(out.length, i + 1) : Math.max(0, i - 1)
  out.splice(j, 0, l)
  return out
}

export function duplicateLayer(layers: Layer[], id: string): Layer[] {
  const i = layers.findIndex((l) => l.id === id)
  if (i < 0 || layers.length >= MAX_LAYERS) return layers
  const copy = { ...layers[i], id: newId(), x: layers[i].x + 0.03, y: layers[i].y + 0.03, locked: false }
  return [...layers.slice(0, i + 1), copy, ...layers.slice(i + 1)]
}

/** Dàn đều các lớp theo chiều ngang trong khoảng [x0, x1] tại tâm dọc y (dùng cho logo nhà tài trợ) */
export function distribute<L extends Layer>(items: L[], x0: number, x1: number, y: number, h?: number): L[] {
  if (!items.length) return items
  const slot = (x1 - x0) / items.length
  return items.map((l, i) => {
    const x = x0 + slot * (i + 0.5)
    if (l.type === 'image' && h) {
      const w = Math.min(slot * 0.8, l.w / l.h * h)
      return { ...l, x, y, w, h: h } as L
    }
    return { ...l, x, y }
  })
}

// ---------------------------------------------------------------------
// Vẽ (trình duyệt)
// ---------------------------------------------------------------------
const images = new Map<string, Promise<HTMLImageElement | null>>()
export function loadImage(src: string | null | undefined): Promise<HTMLImageElement | null> {
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
function loadQr(text: string) {
  if (!qrs.has(text)) qrs.set(text, QRCode.toDataURL(text, { margin: 1, width: 480, errorCorrectionLevel: 'M' }).then(loadImage).catch(() => null))
  return qrs.get(text)!
}

export function drawContain(ctx: CanvasRenderingContext2D, im: HTMLImageElement, x: number, y: number, w: number, h: number) {
  const s = Math.min(w / im.width, h / im.height)
  const dw = im.width * s, dh = im.height * s
  ctx.drawImage(im, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh)
}

export function drawCover(ctx: CanvasRenderingContext2D, im: HTMLImageElement, w: number, h: number) {
  const s = Math.max(w / im.width, h / im.height)
  ctx.drawImage(im, (w - im.width * s) / 2, (h - im.height * s) / 2, im.width * s, im.height * s)
}

/** Ảnh khung tự thiết kế: phủ kín × zoom, x / y ∈ [-1, 1] dịch tới mép ảnh */
export interface ArtFit { zoom: number; x: number; y: number }
export const DEFAULT_FIT: ArtFit = { zoom: 1, x: 0, y: 0 }
export function artRect(iw: number, ih: number, fit: ArtFit, size: Size) {
  const s = Math.max(size.w / iw, size.h / ih) * fit.zoom
  const dw = iw * s, dh = ih * s
  return { x: ((size.w - dw) / 2) * (1 - fit.x), y: ((size.h - dh) / 2) * (1 - fit.y), w: dw, h: dh }
}
export function panArt(fit: ArtFit, dxc: number, dyc: number, iw: number, ih: number, size: Size): ArtFit {
  const r = artRect(iw, ih, fit, size)
  const move = (v: number, d: number, span: number) => (Math.abs(span) < 1 ? v : Math.min(1, Math.max(-1, v + (2 * d) / span)))
  return { ...fit, x: move(fit.x, dxc, r.w - size.w), y: move(fit.y, dyc, r.h - size.h) }
}
export const cleanFit = (f: Partial<ArtFit> | null | undefined): ArtFit =>
  ({ zoom: num(f?.zoom, 0.5, 3, 1), x: num(f?.x, -1, 1, 0), y: num(f?.y, -1, 1, 0) })

export interface DrawData {
  /** Giá trị các trường (số BIB, tên VĐV…) */
  values: Record<string, string | null | undefined>
  /** Nội dung QR tự sinh theo nguồn (xác thực VĐV, trang giải, trang CLB) */
  qr: Partial<Record<QrSource, string | null>>
}
export interface DrawOptions {
  /** Đang ở trình thiết kế: hiện khung giữ chỗ cho ảnh / QR chưa có, chữ mẫu cho trường trống */
  editing?: boolean
  binds?: Binds
}

const CAP = 0.72     // chiều cao chữ hoa ≈ 0.72 × cỡ chữ

export function textOf(l: TextLayer, data: DrawData, opts: DrawOptions) {
  const raw = l.bind === 'custom' ? l.text : data.values[l.bind] ?? (opts.editing ? opts.binds?.[l.bind]?.sample : null)
  if (!raw || !raw.trim()) return null
  return l.upper ? raw.toLocaleUpperCase('vi') : raw
}

function textCss(l: TextLayer, px: number) {
  return `${l.italic ? 'italic ' : ''}${FONTS[l.font].weight} ${px}px ${fontFamily(l.font)}`
}

function setSpacing(ctx: CanvasRenderingContext2D, em: number, px: number) {
  const c = ctx as CanvasRenderingContext2D & { letterSpacing?: string }
  if ('letterSpacing' in c) c.letterSpacing = `${Math.round(em * px * 10) / 10}px`
}

function hitAt(X: number, Y: number, rot: number, lcx: number, lcy: number, w: number, h: number): Hit {
  const a = (rot * Math.PI) / 180
  return { cx: X + lcx * Math.cos(a) - lcy * Math.sin(a), cy: Y + lcx * Math.sin(a) + lcy * Math.cos(a), w, h, rot }
}

function drawText(ctx: CanvasRenderingContext2D, l: TextLayer, text: string, pal: Palette, size: Size): Hit {
  const X = l.x * size.w, Y = l.y * size.h
  const maxW = l.w * size.w
  let px = l.size
  const apply = () => { ctx.font = textCss(l, px); setSpacing(ctx, l.spacing, px) }
  apply()
  while (ctx.measureText(text).width > maxW && px > 10) { px -= Math.max(1, Math.round(px / 30)); apply() }
  const tw = ctx.measureText(text).width
  const cap = px * CAP
  const color = paint(l.color, pal), fxc = paint(l.fx_color, pal)
  const left = l.align === 'left' ? 0 : l.align === 'right' ? -tw : -tw / 2
  const padX = px * 0.28, padY = px * 0.22
  let bx = left, by = -cap / 2, bw = tw, bh = cap

  ctx.save()
  ctx.translate(X, Y)
  ctx.rotate((l.rot * Math.PI) / 180)
  ctx.globalAlpha = l.opacity

  // Nền / trang trí phía sau chữ
  ctx.fillStyle = fxc
  if (l.fx === 'box' || l.fx === 'pill') {
    bx = left - padX; by = -cap / 2 - padY; bw = tw + padX * 2; bh = cap + padY * 2
    ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, l.fx === 'pill' ? bh / 2 : px * 0.06); ctx.fill()
  } else if (l.fx === 'slant') {
    const sk = (cap + padY * 2) * 0.35
    bx = left - padX - sk; by = -cap / 2 - padY; bw = tw + (padX + sk) * 2; bh = cap + padY * 2
    ctx.beginPath()
    ctx.moveTo(left - padX, by); ctx.lineTo(left + tw + padX + sk, by)
    ctx.lineTo(left + tw + padX, by + bh); ctx.lineTo(left - padX - sk, by + bh); ctx.closePath(); ctx.fill()
  } else if (l.fx === 'marker') {
    // vệt bút dạ quang: lệch nhẹ, mép răng cưa, phủ nửa dưới chữ
    const y0 = -cap * 0.1, y1 = cap / 2 + padY * 0.7
    const x0 = left - padX * 0.7, x1 = left + tw + padX * 0.7
    ctx.save()
    ctx.globalAlpha = l.opacity * 0.9
    ctx.beginPath()
    ctx.moveTo(x0 + px * 0.05, y0 - px * 0.04)
    const steps = 7
    for (let i = 1; i <= steps; i++) ctx.lineTo(x0 + ((x1 - x0) * i) / steps, y0 + (i % 2 ? -1 : 1) * px * 0.03 - (i / steps) * px * 0.05)
    ctx.lineTo(x1 - px * 0.04, y1)
    for (let i = steps - 1; i >= 0; i--) ctx.lineTo(x0 + ((x1 - x0) * i) / steps, y1 + (i % 2 ? 1 : -1) * px * 0.03 + (i / steps) * px * 0.04)
    ctx.closePath(); ctx.fill()
    ctx.restore()
    bx = x0; bw = x1 - x0; by = -cap / 2; bh = y1 + cap / 2
  } else if (l.fx === 'underline') {
    ctx.fillRect(left, cap / 2 + px * 0.1, tw, Math.max(3, px * 0.12))
    bh = cap + px * 0.22
  }

  ctx.textAlign = l.align
  ctx.textBaseline = 'alphabetic'
  const base = cap / 2
  ctx.lineJoin = 'round'
  if (l.fx === 'outline') {
    ctx.lineWidth = Math.max(2, px / 18)
    ctx.strokeStyle = color
    ctx.strokeText(text, 0, base)
  } else {
    if (l.fx === 'stroke') {
      ctx.lineWidth = Math.max(3, px / 7)
      ctx.strokeStyle = fxc
      ctx.strokeText(text, 0, base)
    } else if (l.fx === 'shadow') {
      ctx.shadowColor = fxc; ctx.shadowOffsetX = px * 0.05; ctx.shadowOffsetY = px * 0.06; ctx.shadowBlur = px * 0.05
    } else if (l.fx === 'glow') {
      ctx.shadowColor = fxc; ctx.shadowBlur = px * 0.35
      ctx.fillStyle = color
      ctx.fillText(text, 0, base)
    } else if (l.fx === 'extrude') {
      const depth = Math.max(3, Math.round(px * 0.07))
      ctx.fillStyle = fxc
      for (let i = depth; i > 0; i--) ctx.fillText(text, i, base + i)
    }
    ctx.fillStyle = color
    ctx.fillText(text, 0, base)
  }
  ctx.restore()
  setSpacing(ctx, 0, px)
  return hitAt(X, Y, l.rot, bx + bw / 2, by + bh / 2, bw, bh)
}

function placeholder(ctx: CanvasRenderingContext2D, w: number, h: number, label: string) {
  ctx.fillStyle = 'rgba(127,127,127,0.18)'
  ctx.fillRect(-w / 2, -h / 2, w, h)
  ctx.setLineDash([Math.max(6, w / 20), Math.max(4, w / 30)])
  ctx.strokeStyle = 'rgba(127,127,127,0.8)'
  ctx.lineWidth = 3
  ctx.strokeRect(-w / 2, -h / 2, w, h)
  ctx.setLineDash([])
  ctx.fillStyle = 'rgba(90,90,90,0.95)'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = `700 ${Math.max(14, Math.min(w, h) * 0.16)}px ${baseFonts().sans}`
  ctx.fillText(label, 0, 0, w * 0.9)
}

/** Tên nhà tài trợ khi chưa có logo */
function drawName(ctx: CanvasRenderingContext2D, name: string, w: number, h: number, color: string) {
  let px = h * 0.5
  const f = () => `800 ${px}px ${baseFonts().sans}`
  ctx.font = f()
  while (ctx.measureText(name).width > w && px > 10) { px -= 2; ctx.font = f() }
  ctx.fillStyle = color
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(name, 0, 0)
}

function laurel(ctx: CanvasRenderingContext2D, w: number, h: number) {
  // hai cành nguyệt quế ôm vòng cung, lá hình giọt
  const r = Math.min(w, h) / 2
  for (const side of [-1, 1]) {
    ctx.save()
    ctx.scale(side, 1)
    ctx.lineWidth = Math.max(2, r * 0.035)
    ctx.beginPath(); ctx.arc(0, 0, r * 0.82, Math.PI * 0.62, Math.PI * 1.32); ctx.stroke()
    const n = 9
    for (let i = 0; i < n; i++) {
      const a = Math.PI * 0.64 + (Math.PI * 0.66 * i) / (n - 1)
      const cx = Math.cos(a) * r * 0.82, cy = Math.sin(a) * r * 0.82
      for (const off of [-1, 1]) {
        ctx.save()
        ctx.translate(cx, cy)
        ctx.rotate(a + Math.PI / 2 + off * 0.55)
        ctx.beginPath(); ctx.ellipse(0, -r * 0.1 * off, r * 0.05, r * 0.12, 0, 0, Math.PI * 2); ctx.fill()
        ctx.restore()
      }
    }
    ctx.restore()
  }
}

function seal(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const r = Math.min(w, h) / 2, n = 24
  ctx.beginPath()
  for (let i = 0; i <= n * 2; i++) {
    const a = (Math.PI * i) / n
    const rr = i % 2 ? r * 0.9 : r
    ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr)
  }
  ctx.closePath(); ctx.fill()
  ctx.save()
  ctx.globalCompositeOperation = 'destination-out'
  ctx.lineWidth = Math.max(2, r * 0.03)
  ctx.beginPath(); ctx.arc(0, 0, r * 0.76, 0, Math.PI * 2); ctx.stroke()
  ctx.restore()
}

function drawShape(ctx: CanvasRenderingContext2D, l: ShapeLayer, pal: Palette, size: Size): Hit {
  const X = l.x * size.w, Y = l.y * size.h
  const w = l.w * size.w, h = l.shape === 'line' ? Math.max(2, l.h * size.h) : l.h * size.h
  const c = paint(l.fill, pal)
  ctx.save()
  ctx.translate(X, Y)
  ctx.rotate((l.rot * Math.PI) / 180)
  ctx.globalAlpha = l.opacity
  ctx.fillStyle = c
  ctx.strokeStyle = c
  ctx.beginPath()
  switch (l.shape) {
    case 'rect': case 'line': ctx.rect(-w / 2, -h / 2, w, h); ctx.fill(); break
    case 'round': ctx.roundRect(-w / 2, -h / 2, w, h, Math.min(w, h) * 0.18); ctx.fill(); break
    case 'pill': ctx.roundRect(-w / 2, -h / 2, w, h, Math.min(w, h) / 2); ctx.fill(); break
    case 'circle': ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2); ctx.fill(); break
    case 'slash': {
      const sk = h * 0.6
      ctx.moveTo(-w / 2 + sk, -h / 2); ctx.lineTo(w / 2, -h / 2); ctx.lineTo(w / 2 - sk, h / 2); ctx.lineTo(-w / 2, h / 2); ctx.closePath(); ctx.fill()
      break
    }
    case 'laurel': laurel(ctx, w, h); break
    case 'seal': seal(ctx, w, h); break
  }
  ctx.restore()
  return { cx: X, cy: Y, w, h, rot: l.rot }
}

function qrContent(l: QrLayer, data: DrawData) {
  if (l.source === 'link' || (l.source === 'fee' && !l.src)) return l.url.trim() || null
  if (l.source === 'verify' || l.source === 'race' || l.source === 'club') return data.qr[l.source] ?? null
  return null
}

async function loadLayerAssets(layers: Layer[], data: DrawData, opts: DrawOptions) {
  const out = new Map<string, HTMLImageElement | null>()
  await Promise.all(layers.map(async (l) => {
    if (l.hidden) return
    if (l.type === 'image') out.set(l.id, await loadImage(l.src))
    else if (l.type === 'qr') {
      const text = qrContent(l, data)
      out.set(l.id, l.src && (l.source === 'fee' || l.source === 'image') ? await loadImage(l.src) : text ? await loadQr(text) : null)
    } else if (l.type === 'text' && typeof document !== 'undefined') {
      const t = textOf(l, data, opts)
      // Font Google chỉ tải khi cần: chờ tải xong mới vẽ để chữ đúng font ngay lần đầu
      if (t) await Promise.resolve(document.fonts?.load(textCss(l, 100), t)).catch(() => null)
    }
  }))
  return out
}

/**
 * Vẽ toàn bộ thiết kế: nền (do BIB / chứng nhận tự vẽ) rồi lần lượt từng lớp từ dưới lên.
 * Trả về vị trí từng lớp (để chạm chọn / kéo trong trình thiết kế).
 */
export async function drawLayers(canvas: HTMLCanvasElement, size: Size, background: (ctx: CanvasRenderingContext2D) => Promise<void> | void,
  layers: Layer[], pal: Palette, data: DrawData, opts: DrawOptions = {}): Promise<Layout> {
  const assets = await loadLayerAssets(layers, data, opts)
  canvas.width = size.w
  canvas.height = size.h
  const ctx = canvas.getContext('2d')!
  await background(ctx)
  const layout: Layout = {}
  for (const l of layers) {
    if (l.hidden) continue
    if (l.type === 'text') {
      const t = textOf(l, data, opts)
      if (t) layout[l.id] = drawText(ctx, l, t, pal, size)
      else if (opts.editing) layout[l.id] = { cx: l.x * size.w, cy: l.y * size.h, w: 120, h: l.size * CAP, rot: l.rot }
    } else if (l.type === 'shape') {
      layout[l.id] = drawShape(ctx, l, pal, size)
    } else if (l.type === 'image') {
      const im = assets.get(l.id)
      const w = l.w * size.w, h = l.h * size.h
      if (!im && !l.name && !opts.editing) continue
      ctx.save()
      ctx.translate(l.x * size.w, l.y * size.h)
      ctx.rotate((l.rot * Math.PI) / 180)
      ctx.globalAlpha = l.opacity
      if (im) drawContain(ctx, im, -w / 2, -h / 2, w, h)
      else if (l.name) drawName(ctx, l.name, w, h, pal.text)
      else placeholder(ctx, w, h, IMAGE_ROLES[l.role])
      ctx.restore()
      layout[l.id] = { cx: l.x * size.w, cy: l.y * size.h, w, h, rot: l.rot }
    } else {
      const im = assets.get(l.id)
      if (!im && !opts.editing) continue
      const s = l.w * size.w
      const pad = l.card ? s * 0.07 : 0
      const lab = l.card && l.label ? s * 0.11 : 0
      const cw = s + pad * 2, ch = s + pad * 2 + (lab ? lab * 1.5 : 0)
      ctx.save()
      ctx.translate(l.x * size.w, l.y * size.h)
      ctx.rotate((l.rot * Math.PI) / 180)
      ctx.globalAlpha = l.opacity
      if (l.card) {
        ctx.fillStyle = '#ffffff'
        ctx.beginPath(); ctx.roundRect(-cw / 2, -ch / 2, cw, ch, s * 0.08); ctx.fill()
      }
      const qy = -ch / 2 + pad
      if (im) drawContain(ctx, im, -s / 2, qy, s, s)
      else { ctx.save(); ctx.translate(0, qy + s / 2); placeholder(ctx, s, s, `QR ${QR_SOURCES[l.source]}`); ctx.restore() }
      if (lab) {
        ctx.fillStyle = '#0a0d12'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        let px = lab
        ctx.font = `700 ${px}px ${baseFonts().sans}`
        while (ctx.measureText(l.label).width > s && px > 8) { px -= 1; ctx.font = `700 ${px}px ${baseFonts().sans}` }
        ctx.fillText(l.label, 0, qy + s + lab * 0.85)
      }
      ctx.restore()
      layout[l.id] = { cx: l.x * size.w, cy: l.y * size.h, w: cw, h: ch, rot: l.rot }
    }
  }
  return layout
}

/** Tên hiển thị của lớp trong danh sách lớp */
export function layerLabel(l: Layer, binds: Binds) {
  switch (l.type) {
    case 'text': return l.bind === 'custom' ? `Chữ: ${l.text || '(trống)'}` : binds[l.bind]?.label ?? 'Chữ'
    case 'image': return l.name ? `${IMAGE_ROLES[l.role]}: ${l.name}` : IMAGE_ROLES[l.role]
    case 'qr': return `QR ${QR_SOURCES[l.source]}`
    case 'shape': return `Hình: ${SHAPES[l.shape]}`
  }
}
