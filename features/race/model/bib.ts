// BIB điện tử do ban tổ chức thiết kế (migration 002900 → 004800). Khổ 1400×1000 ≈ BIB giấy A5 ngang.
// Bản 2: mọi thứ trên BIB là lớp kéo thả (engine design.ts). Nền = mẫu (dải màu trang trí) hoặc ảnh BIB có sẵn.
// "Tự động": chọn mẫu → app dựng bố cục chuẩn (dải đầu, số lớn, tên, QR, dải tài trợ); BTC kéo chỉnh tiếp.
import { distanceLabel } from './race'
import {
  artRect, cleanFit, cleanLayers, DEFAULT_FIT, distribute, drawCover, drawLayers, imageLayer, isHex, loadImage, qrLayer, textLayer,
  type ArtFit, type Binds, type ColorKey, type DrawOptions, type FontKey, type ImageLayer, type Layer, type Layout, type Palette, type QrLayer,
} from '@/shared/design/engine'

export type BibTemplate = 'classic' | 'marathon' | 'stripe' | 'split' | 'gradient' | 'speed' | 'neon' | 'minimal'
export type BibColors = Palette
export const BIB_SIZE = { w: 1400, h: 1000 }
/** Dải nhà tài trợ phía dưới (tỉ lệ chiều cao) */
export const STRIP_H = 0.15

interface TemplateDef {
  label: string; hint: string; colors: BibColors; head: ColorKey; numberFont: FontKey
  /** Nhãn cự ly: [màu chữ, màu nền viên thuốc] */
  pill: [ColorKey, ColorKey]
}
export const TEMPLATES: Record<BibTemplate, TemplateDef> = {
  classic: { label: 'Cổ điển', hint: 'Dải tên giải phía trên, số lớn giữa', head: 'bg', numberFont: 'impact', pill: ['text', 'accent'],
    colors: { bg: '#ffffff', band: '#1f4fd8', number: '#0a0d12', text: '#0a0d12', accent: '#ffc21a' } },
  marathon: { label: 'Marathon', hint: 'Kiểu giải lớn: dải đầu + dải chân màu', head: 'bg', numberFont: 'athletic', pill: ['band', 'bg'],
    colors: { bg: '#ffffff', band: '#e11d48', number: '#111827', text: '#111827', accent: '#111827' } },
  stripe: { label: 'Sọc chéo', hint: 'Dải màu chéo phía sau số, năng động', head: 'text', numberFont: 'impact', pill: ['text', 'accent'],
    colors: { bg: '#ffffff', band: '#ffc21a', number: '#1f4fd8', text: '#0a0d12', accent: '#ff8a1f' } },
  split: { label: 'Chia khối', hint: 'Khối màu bên trái chứa logo + cự ly', head: 'bg', numberFont: 'condensed', pill: ['text', 'accent'],
    colors: { bg: '#ffffff', band: '#0f766e', number: '#0f172a', text: '#0f172a', accent: '#f59e0b' } },
  gradient: { label: 'Chuyển màu', hint: 'Nền chuyển màu rực rỡ, chữ trắng', head: 'text', numberFont: 'unbounded', pill: ['bg', 'accent'],
    colors: { bg: '#4f46e5', band: '#db2777', number: '#ffffff', text: '#ffffff', accent: '#facc15' } },
  speed: { label: 'Tốc độ', hint: 'Vệt tốc độ chéo + góc màu, cảm giác lao nhanh', head: 'text', numberFont: 'kanit', pill: ['bg', 'band'],
    colors: { bg: '#f8fafc', band: '#f97316', number: '#0f172a', text: '#0f172a', accent: '#0ea5e9' } },
  neon: { label: 'Neon đêm', hint: 'Nền tối, số phát sáng — hợp giải chạy đêm', head: 'text', numberFont: 'tech', pill: ['bg', 'band'],
    colors: { bg: '#0a0d12', band: '#b6ff3b', number: '#b6ff3b', text: '#f2f5f9', accent: '#38bdf8' } },
  minimal: { label: 'Tối giản', hint: 'Một màu nền, chữ sạch', head: 'text', numberFont: 'inter', pill: ['bg', 'accent'],
    colors: { bg: '#f4f6f8', band: '#0a0d12', number: '#0a0d12', text: '#5b6472', accent: '#e11d48' } },
}
export const COLOR_LABEL: Record<ColorKey, string> = { bg: 'Nền', band: 'Dải chính', number: 'Số BIB', text: 'Chữ', accent: 'Điểm nhấn' }

/** Trường dữ liệu in lên BIB (mỗi VĐV một giá trị) */
export const BIB_BINDS: Binds = {
  number: { label: 'Số BIB', sample: '0421' },
  name: { label: 'Tên VĐV', sample: 'NGUYỄN VĂN AN' },
  org: { label: 'Đơn vị tổ chức', sample: 'Hồ Tây Runners' },
  race: { label: 'Tên giải', sample: 'Giải chạy ảo' },
  distance: { label: 'Cự ly', sample: '21 km' },
  dates: { label: 'Ngày thi đấu', sample: '01/10 – 31/10' },
}

export interface BibDesign {
  v: 2
  template: BibTemplate
  colors: Partial<BibColors>
  bg_url: string | null
  bg_opacity: number
  /** Ảnh BIB có sẵn (Canva / Photoshop…) — thay nền mẫu khi use_art */
  art_url: string | null
  use_art: boolean
  art_fit: ArtFit
  /** Vẽ dải màu trang trí của mẫu */
  decor: boolean
  /** Dải nền nhà tài trợ phía dưới */
  strip: boolean
  /** Lỗ ghim 4 góc */
  pins: boolean
  layers: Layer[]
}

/** Số BIB in lên BIB: bỏ tiền tố chữ viết tắt (HT-0421 → 0421); mã đầy đủ vẫn dùng để tra cứu / QR */
export const bibNumber = (bib: string) => (bib.includes('-') ? bib.slice(bib.lastIndexOf('-') + 1) : bib)

// ---------------------------------------------------------------------
// Bố cục tự động
// ---------------------------------------------------------------------
export interface KeepAssets { logo: ImageLayer | null; sponsors: ImageLayer[]; qrs: QrLayer[]; extra: Layer[] }

/** Giữ lại ảnh / QR BTC đã thêm khi dựng lại bố cục */
export function keepAssets(layers: Layer[]): KeepAssets {
  const logo = layers.find((l): l is ImageLayer => l.type === 'image' && l.role === 'logo') ?? null
  return {
    logo,
    sponsors: layers.filter((l): l is ImageLayer => l.type === 'image' && l.role === 'sponsor'),
    qrs: layers.filter((l): l is QrLayer => l.type === 'qr'),
    extra: layers.filter((l) => l.type === 'image' && l !== logo && l.role !== 'sponsor'),
  }
}

/** Dàn logo nhà tài trợ đều trong dải dưới */
export function arrangeSponsors(layers: Layer[], x0 = 0.06): Layer[] {
  const sp = layers.filter((l): l is ImageLayer => l.type === 'image' && l.role === 'sponsor')
  if (!sp.length) return layers
  const placed = new Map(distribute(sp, x0, 0.94, 1 - STRIP_H / 2, STRIP_H * 0.62).map((l) => [l.id, { ...l, rot: 0 }]))
  return layers.map((l) => placed.get(l.id) ?? l)
}

export function autoBib(template: BibTemplate, keep: KeepAssets, opts: { tagline?: string | null; strip?: boolean } = {}): Layer[] {
  const t = TEMPLATES[template]
  const split = template === 'split'
  const strip = opts.strip ?? keep.sponsors.length > 0
  const bottom = strip ? 1 - STRIP_H : 1
  const qrs = keep.qrs.length ? keep.qrs : [qrLayer({ x: 0, y: 0, source: 'verify', label: 'Quét để xác thực' })]
  // Vùng chính (giữa dải đầu và dải tài trợ); QR xếp dọc bên phải
  const mainTop = 0.22, mainBottom = bottom - 0.04
  const qrW = qrs.length > 1 ? 0.12 : 0.15
  const cx = split ? 0.58 : 0.42
  const layers: Layer[] = []

  if (split) {
    layers.push(
      { ...(keep.logo ?? imageLayer({ x: 0, y: 0, role: 'logo' })), x: 0.15, y: 0.2, w: 0.2, h: 0.2, rot: 0 },
      textLayer({ x: 0.15, y: 0.46, bind: 'distance', font: 'impact', size: 80, w: 0.24, color: 'bg', upper: true }),
      textLayer({ x: 0.15, y: 0.58, bind: 'dates', font: 'condensed', size: 30, w: 0.24, color: 'bg', opacity: 0.85 }),
      textLayer({ x: 0.34, y: 0.1, bind: 'race', font: 'montserrat', size: 56, w: 0.6, align: 'left', color: 'text', upper: true }),
      textLayer({ x: 0.34, y: 0.18, bind: 'org', font: 'sans', size: 34, w: 0.6, align: 'left', color: 'accent', upper: true }),
    )
  } else {
    layers.push(
      { ...(keep.logo ?? imageLayer({ x: 0, y: 0, role: 'logo' })), x: 0.1, y: 0.105, w: 0.13, h: 0.15, rot: 0 },
      textLayer({ x: 0.19, y: opts.tagline ? 0.085 : 0.105, bind: 'race', font: 'montserrat', size: 58, w: 0.5, align: 'left', color: t.head, upper: true }),
      textLayer({ x: 0.94, y: 0.105, bind: 'distance', font: 'sans', size: 40, w: 0.2, align: 'right', color: t.pill[0], fx: 'pill', fx_color: t.pill[1], upper: true }),
    )
    if (opts.tagline) layers.push(textLayer({ x: 0.19, y: 0.15, text: opts.tagline, font: 'sans', size: 30, w: 0.5, align: 'left', color: t.head, opacity: 0.85 }))
    layers.push(textLayer({ x: cx, y: mainTop + 0.07, bind: 'org', font: 'sans', size: 40, w: 0.6, color: 'text', upper: true, spacing: 0.08 }))
  }
  const numY = split ? 0.5 : (mainTop + mainBottom) / 2 + 0.02
  layers.push(
    textLayer({ x: cx, y: numY, bind: 'number', font: t.numberFont, size: 340, w: split ? 0.4 : 0.66, color: 'number',
      fx: template === 'neon' ? 'glow' : 'none', fx_color: 'number' }),
    textLayer({ x: cx, y: Math.min(mainBottom - 0.04, numY + 0.23), bind: 'name', font: 'sans', size: 62, w: split ? 0.44 : 0.62, color: 'text', upper: true,
      fx: template === 'marathon' ? 'box' : 'none', fx_color: 'band' }),
  )
  if (!split) layers.push(textLayer({ x: 0.95, y: bottom - (template === 'marathon' ? 0.075 : 0.045), bind: 'dates', font: 'sans', size: 24, w: 0.3, align: 'right', color: 'text', opacity: 0.65 }))

  // QR: cột bên phải, căn giữa vùng chính
  const qh = qrW * (BIB_SIZE.w / BIB_SIZE.h) * 1.3
  const gap = 0.02
  const total = qrs.length * qh + (qrs.length - 1) * gap
  const y0 = Math.max(mainTop, (mainTop + mainBottom) / 2 - total / 2)
  qrs.slice(0, 3).forEach((q, i) => layers.push({ ...q, x: 0.87, y: y0 + qh / 2 + i * (qh + gap), w: qrW, rot: 0 }))

  layers.push(...keep.extra)
  return arrangeSponsors([...layers, ...keep.sponsors], split ? 0.34 : 0.06)
}

export const DEFAULT_BIB: BibDesign = {
  v: 2, template: 'classic', colors: {}, bg_url: null, bg_opacity: 0.35, art_url: null, use_art: false, art_fit: DEFAULT_FIT,
  decor: true, strip: false, pins: true, layers: [],
}

/** Thiết kế mới: bố cục tự động của mẫu cổ điển */
export function freshBib(): BibDesign {
  return { ...DEFAULT_BIB, layers: autoBib('classic', { logo: null, sponsors: [], qrs: [], extra: [] }) }
}

// ---------------------------------------------------------------------
// Thiết kế bản 1 (003200: 3 khung chữ + đầu BIB + QR cố định) → lớp
// ---------------------------------------------------------------------
type V1Box = { show?: boolean; x?: number; y?: number; align?: string; font?: string; italic?: boolean; outline?: boolean; size?: number; color?: string }
export interface StoredV1 {
  template?: string; colors?: Partial<BibColors>; logo_url?: string | null; bg_url?: string | null; bg_opacity?: number; tagline?: string | null
  sponsors?: { name: string; logo_url: string | null }[]; show_name?: boolean; show_qr?: boolean; art_url?: string | null; use_art?: boolean
  art_fit?: Partial<ArtFit>; show_header?: boolean; show_sponsors?: boolean; qr_pos?: string; org_text?: string | null
  boxes?: Partial<Record<'org' | 'number' | 'name', V1Box>>
  text?: { layout?: string; align?: string; font?: string; y?: number; scale?: number; name_scale?: number }
}
export type StoredDesign = (Partial<Omit<BibDesign, 'layers'>> & { layers?: unknown[] }) | StoredV1

const V1_BASE = { org: 44, number: 300, name: 64 }
const V1_POS = { org: [0.42, 0.3], number: [0.42, 0.54], name: [0.42, 0.72] } as const

export function fromV1(d: StoredV1): BibDesign {
  const template = (d.template && d.template in TEMPLATES ? d.template : 'classic') as BibTemplate
  const framed = !!(d.use_art && d.art_url)
  const header = d.show_header !== false
  const sponsors = d.show_sponsors === false ? [] : (d.sponsors ?? []).slice(0, 4)
  const layers: Layer[] = []
  const headY = template === 'classic' && !framed ? 0.105 : 0.085
  if (header) {
    if (d.logo_url) layers.push(imageLayer({ x: 0.096, y: headY, role: 'logo', src: d.logo_url, w: 0.107, h: 0.15 }))
    const tx = d.logo_url ? 0.17 : 0.05
    layers.push(textLayer({ x: tx, y: d.tagline ? headY - 0.02 : headY, bind: 'race', font: 'sans', size: 62, w: 0.6, align: 'left',
      color: template === 'classic' && !framed ? 'bg' : 'text', upper: true }))
    if (d.tagline) layers.push(textLayer({ x: tx, y: headY + 0.045, text: d.tagline, font: 'sans', size: 34, w: 0.6, align: 'left',
      color: template === 'classic' && !framed ? 'bg' : 'text', opacity: 0.8 }))
    layers.push(textLayer({ x: 0.957, y: headY, bind: 'distance', font: 'sans', size: 40, w: 0.25, align: 'right', color: 'text',
      fx: 'pill', fx_color: template === 'classic' && !framed ? 'accent' : 'band', upper: true }))
  }
  for (const k of ['org', 'number', 'name'] as const) {
    const b = d.boxes?.[k] ?? {}
    const show = k === 'name' ? (b.show ?? d.show_name ?? true) : (b.show ?? true)
    const layer = textLayer({
      x: typeof b.x === 'number' ? b.x : V1_POS[k][0], y: typeof b.y === 'number' ? b.y : V1_POS[k][1],
      bind: k, font: ((b.font as FontKey) ?? (k === 'number' ? 'mono' : 'sans')),
      size: Math.round(V1_BASE[k] * (typeof b.size === 'number' ? b.size : 1)), w: 0.8,
      align: (b.align as 'left' | 'center' | 'right') ?? 'center', color: (b.color as ColorKey) ?? (k === 'number' ? 'number' : 'text'),
      italic: !!b.italic, upper: k === 'name', fx: b.outline ? 'outline' : k === 'number' && template === 'neon' && !framed ? 'glow' : 'none',
      fx_color: 'number', hidden: !show,
    })
    if (k === 'org' && d.org_text) { layer.bind = 'custom'; layer.text = d.org_text }
    layers.push(layer)
  }
  if (d.show_qr !== false) {
    const pos = d.qr_pos === 'left' ? [0.125, 0.5] : d.qr_pos === 'corner' ? [0.9, 0.62] : [0.875, 0.5]
    layers.push(qrLayer({ x: pos[0], y: pos[1], source: 'verify', w: d.qr_pos === 'corner' ? 0.13 : 0.165, label: 'Quét để xác thực' }))
  }
  if (!framed) layers.push(textLayer({ x: 0.05, y: sponsors.length ? 0.78 : 0.93, bind: 'dates', font: 'sans', size: 24, w: 0.5, align: 'left', color: 'text', opacity: 0.65 }))
  sponsors.forEach((s) => layers.push(imageLayer({ x: 0.5, y: 0.925, role: 'sponsor', src: s.logo_url, name: s.name, w: 0.2, h: 0.1 })))
  return {
    v: 2, template, colors: { ...(d.colors ?? {}) }, bg_url: d.bg_url ?? null, bg_opacity: typeof d.bg_opacity === 'number' ? d.bg_opacity : 0.35,
    art_url: d.art_url ?? null, use_art: framed, art_fit: cleanFit(d.art_fit), decor: true, strip: sponsors.length > 0, pins: !framed,
    layers: arrangeSponsors(layers),
  }
}

// ---------------------------------------------------------------------
// Đọc / lưu
// ---------------------------------------------------------------------
const cleanColors = (c: unknown): Partial<BibColors> =>
  Object.fromEntries(Object.entries((c && typeof c === 'object' ? c : {}) as Record<string, unknown>)
    .filter(([k, v]) => k in TEMPLATES.classic.colors && isHex(v)).map(([k, v]) => [k, (v as string).toLowerCase()]))

/** Thiết kế đã lưu (null / bản 1 / bản 2 thiếu trường) → đủ trường + bảng màu */
export function resolveBib(d: StoredDesign | null | undefined): BibDesign & { palette: BibColors } {
  let design: BibDesign
  if (!d) design = freshBib()
  else if (!('v' in d) || d.v !== 2) design = fromV1(d as StoredV1)
  else {
    const x = d as Partial<BibDesign> & { layers?: unknown[] }
    const template = (x.template && x.template in TEMPLATES ? x.template : 'classic') as BibTemplate
    design = {
      v: 2, template, colors: cleanColors(x.colors),
      bg_url: x.bg_url ?? null, bg_opacity: typeof x.bg_opacity === 'number' ? Math.min(1, Math.max(0, x.bg_opacity)) : 0.35,
      art_url: x.art_url ?? null, use_art: !!(x.use_art && x.art_url), art_fit: cleanFit(x.art_fit),
      decor: x.decor !== false, strip: !!x.strip, pins: x.pins !== false,
      layers: cleanLayers(x.layers, BIB_BINDS),
    }
  }
  return { ...design, palette: { ...TEMPLATES[design.template].colors, ...design.colors } }
}

export function editableBib(d: StoredDesign | null | undefined): BibDesign {
  const { palette, ...rest } = resolveBib(d)
  void palette
  return rest
}

/** Dữ liệu gửi RPC set_race_bib_design (chỉ màu khác mẫu mới lưu) */
export function bibPayload(d: BibDesign) {
  const base = TEMPLATES[d.template].colors
  const colors = Object.fromEntries(Object.entries(d.colors).filter(([k, v]) => v && v.toLowerCase() !== base[k as ColorKey]))
  const layers = d.layers.filter((l) => !(l.type === 'text' && l.bind === 'custom' && !l.text.trim()))
    .map((l) => (l.type === 'text' ? { ...l, text: l.text.trim() } : l.type === 'image' ? { ...l, name: l.name.trim() } : l))
  return { ...d, colors, use_art: d.use_art && !!d.art_url, layers }
}

// ---------------------------------------------------------------------
// Vẽ (trình duyệt)
// ---------------------------------------------------------------------
export interface BibData {
  race: string
  /** Mã BIB đầy đủ (HT-0421) — in lên chỉ phần số */
  bib: string
  name: string | null
  /** Tên CLB / người tổ chức */
  org: string | null
  distanceKm: number
  dates: string
  /** Nội dung QR tự sinh: xác thực VĐV, trang giải, trang CLB */
  qr: { verify?: string | null; race?: string | null; club?: string | null }
}

export function drawBibBackground(ctx: CanvasRenderingContext2D, d: BibDesign, c: BibColors, art: HTMLImageElement | null, bg: HTMLImageElement | null) {
  const { w, h } = BIB_SIZE
  const framed = !!art
  ctx.fillStyle = c.bg
  ctx.fillRect(0, 0, w, h)
  if (art) {
    const r = artRect(art.width, art.height, d.art_fit, BIB_SIZE)
    ctx.drawImage(art, r.x, r.y, r.w, r.h)
  }
  const stripY = h * (1 - STRIP_H)
  if (!framed && d.decor) {
    switch (d.template) {
      case 'classic':
        ctx.fillStyle = c.band; ctx.fillRect(0, 0, w, h * 0.21)
        ctx.fillStyle = c.accent; ctx.fillRect(0, h * 0.21, w, 12)
        break
      case 'marathon': {
        ctx.fillStyle = c.band; ctx.fillRect(0, 0, w, h * 0.21)
        const y = d.strip ? stripY - 26 : h - 70
        ctx.fillStyle = c.band; ctx.fillRect(0, y, w, 26)
        ctx.fillStyle = c.accent; ctx.fillRect(0, h * 0.21, w, 6)
        break
      }
      case 'stripe':
        ctx.fillStyle = c.band
        ctx.beginPath(); ctx.moveTo(0, h * 0.78); ctx.lineTo(w, h * 0.18); ctx.lineTo(w, h * 0.52); ctx.lineTo(0, h * 1.12); ctx.closePath(); ctx.fill()
        ctx.fillStyle = c.accent
        ctx.beginPath(); ctx.moveTo(0, h * 0.74); ctx.lineTo(w, h * 0.14); ctx.lineTo(w, h * 0.18); ctx.lineTo(0, h * 0.78); ctx.closePath(); ctx.fill()
        break
      case 'split':
        ctx.fillStyle = c.band; ctx.fillRect(0, 0, w * 0.3, h)
        ctx.fillStyle = c.accent; ctx.fillRect(w * 0.3, 0, 12, h)
        break
      case 'gradient': {
        const g = ctx.createLinearGradient(0, 0, w, h)
        g.addColorStop(0, c.bg); g.addColorStop(1, c.band)
        ctx.fillStyle = g; ctx.fillRect(0, 0, w, h)
        ctx.save(); ctx.globalAlpha = 0.18; ctx.fillStyle = c.accent
        ctx.beginPath(); ctx.arc(w * 0.9, h * 0.1, h * 0.5, 0, Math.PI * 2); ctx.fill()
        ctx.beginPath(); ctx.arc(w * 0.05, h * 0.95, h * 0.35, 0, Math.PI * 2); ctx.fill()
        ctx.restore()
        break
      }
      case 'speed':
        ctx.save(); ctx.globalAlpha = 0.12; ctx.fillStyle = c.accent
        for (let i = 0; i < 9; i++) {
          const x = -200 + i * 190
          ctx.beginPath(); ctx.moveTo(x, h); ctx.lineTo(x + 40, h); ctx.lineTo(x + 440, 0); ctx.lineTo(x + 400, 0); ctx.closePath(); ctx.fill()
        }
        ctx.restore()
        ctx.fillStyle = c.band
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(w * 0.62, 0); ctx.lineTo(w * 0.55, h * 0.2); ctx.lineTo(0, h * 0.2); ctx.closePath(); ctx.fill()
        ctx.fillStyle = c.accent
        ctx.beginPath(); ctx.moveTo(w * 0.64, 0); ctx.lineTo(w * 0.68, 0); ctx.lineTo(w * 0.61, h * 0.2); ctx.lineTo(w * 0.57, h * 0.2); ctx.closePath(); ctx.fill()
        break
      case 'neon':
        ctx.fillStyle = c.band; ctx.fillRect(0, 0, w, 10); ctx.fillRect(0, h - 10, w, 10)
        break
      case 'minimal':
        ctx.fillStyle = c.band; ctx.fillRect(60, h * 0.19, w - 120, 4)
        break
    }
  }
  if (bg && !framed) { ctx.save(); ctx.globalAlpha = d.bg_opacity; drawCover(ctx, bg, w, h); ctx.restore() }
  if (d.strip) {
    ctx.fillStyle = framed ? 'rgba(255,255,255,0.9)' : d.template === 'neon' || d.template === 'gradient' ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)'
    ctx.fillRect(0, stripY, w, h - stripY)
  }
  if (d.pins && !framed) {
    for (const [x, y] of [[34, 34], [w - 34, 34], [34, h - 34], [w - 34, h - 34]]) {
      ctx.beginPath(); ctx.arc(x, y, 11, 0, Math.PI * 2)
      ctx.fillStyle = d.template === 'neon' ? '#1d2330' : 'rgba(0,0,0,0.14)'
      ctx.fill()
    }
  }
}

export function bibValues(data: BibData) {
  return {
    number: bibNumber(data.bib), name: data.name, org: data.org, race: data.race,
    distance: distanceLabel(data.distanceKm), dates: data.dates,
  }
}

export async function drawBib(canvas: HTMLCanvasElement, design: StoredDesign | null | undefined, data: BibData, opts: DrawOptions = {}): Promise<Layout> {
  const d = resolveBib(design)
  const [art, bg] = await Promise.all([d.use_art ? loadImage(d.art_url) : null, d.use_art ? null : loadImage(d.bg_url)])
  return drawLayers(canvas, BIB_SIZE, (ctx) => drawBibBackground(ctx, d, d.palette, art, bg), d.layers, d.palette,
    { values: bibValues(data), qr: data.qr }, { binds: BIB_BINDS, ...opts })
}
