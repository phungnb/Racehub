// Vinh danh thử thách (migration 004900): hạng mục, khổ ảnh, 10 nền tự vẽ, bố cục tự động ảnh nhóm / ảnh cá nhân.
// Dùng chung engine lớp với BIB (shared/design/engine) + lớp khung ảnh runner ('photo').
import {
  cleanLayers, drawCover, drawLayers, imageLayer, isHex, loadImage, photoLayer, qrLayer, shapeLayer, textLayer,
  type Binds, type ColorKey, type DrawData, type DrawOptions, type FontKey, type Layer, type Layout, type Palette, type TextFx,
} from '@/shared/design/engine'
import { formatScore } from './challenge'

export type HonorKind = 'TOP' | 'KM' | 'DAYS' | 'STREAK' | 'BREAKTHROUGH' | 'SUPPORTED' | 'CUSTOM1' | 'CUSTOM2' | 'CUSTOM3' | 'CUSTOM4' | 'CUSTOM5'
export const HONOR_KINDS: Record<'TOP' | 'KM' | 'DAYS' | 'STREAK' | 'BREAKTHROUGH' | 'SUPPORTED', { title: string; hint: string }> = {
  TOP: { title: 'Top thành tích', hint: 'Theo bảng xếp hạng của thử thách' },
  KM: { title: 'Nhiều km nhất', hint: 'Tổng km hợp lệ trong thử thách' },
  DAYS: { title: 'Chạy đều nhất', hint: 'Nhiều ngày có chạy nhất' },
  STREAK: { title: 'Chuỗi ngày dài nhất', hint: 'Nhiều ngày chạy liên tiếp nhất (từ 2 ngày)' },
  BREAKTHROUGH: { title: 'Bứt phá nhất', hint: 'Km tăng nhiều nhất so với cùng khoảng thời gian trước thử thách (≥ 5 km)' },
  SUPPORTED: { title: 'Được tiếp sức nhiều nhất', hint: 'Nhận nhiều quà nhất trong thời gian thử thách' },
}
export interface HonorCategory { key: HonorKind; title: string; count: number; users?: string[] | null }
export const MAX_CATEGORIES = 8

export function honorValue(key: string, value: number | null | undefined, objective: string | null | undefined) {
  if (value == null) return ''
  const v = Number(value)
  switch (key) {
    case 'TOP': return formatScore(objective, v)
    case 'KM': return `${v.toLocaleString('vi-VN', { maximumFractionDigits: 1 })} km`
    case 'DAYS': return `${v} ngày chạy`
    case 'STREAK': return `${v} ngày liên tiếp`
    case 'BREAKTHROUGH': return `+${v.toLocaleString('vi-VN', { maximumFractionDigits: 1 })} km`
    case 'SUPPORTED': return `${v.toLocaleString('vi-VN')} Tỏa sáng`
    default: return ''
  }
}

// ---------------------------------------------------------------------
// Khổ ảnh + nền
// ---------------------------------------------------------------------
export type HonorFormat = 'portrait' | 'square' | 'story' | 'wide'
export const HONOR_FORMATS: Record<HonorFormat, { label: string; hint: string; w: number; h: number }> = {
  portrait: { label: 'Dọc 4:5', hint: 'Bài đăng Facebook / Instagram', w: 1080, h: 1350 },
  square: { label: 'Vuông 1:1', hint: 'Bài đăng, Zalo', w: 1080, h: 1080 },
  story: { label: 'Story 9:16', hint: 'Tin Facebook / Instagram / TikTok', w: 1080, h: 1920 },
  wide: { label: 'Ngang 16:9', hint: 'Ảnh bìa, màn chiếu lễ trao giải', w: 1600, h: 900 },
}

export type HonorTemplate = 'podium' | 'rays' | 'confetti' | 'speed' | 'gold' | 'neon' | 'paper' | 'gradient' | 'stadium' | 'minimal'
interface TemplateDef { label: string; colors: Palette; title: FontKey; name: FontKey; titleFx: TextFx }
export const HONOR_TEMPLATES: Record<HonorTemplate, TemplateDef> = {
  podium: { label: 'Sân khấu', title: 'montserrat', name: 'sans', titleFx: 'gold',
    colors: { bg: '#0b1020', band: '#1d4ed8', number: '#ffffff', text: '#e2e8f0', accent: '#fbbf24' } },
  gold: { label: 'Nhũ vàng', title: 'cormorant', name: 'serif', titleFx: 'gold',
    colors: { bg: '#0a0a0a', band: '#d4a017', number: '#ffffff', text: '#e5e5e5', accent: '#d4a017' } },
  rays: { label: 'Tia nắng', title: 'unbounded', name: 'montserrat', titleFx: 'none',
    colors: { bg: '#fef3c7', band: '#f59e0b', number: '#111827', text: '#1f2937', accent: '#b45309' } },
  confetti: { label: 'Pháo giấy', title: 'paytone', name: 'montserrat', titleFx: 'none',
    colors: { bg: '#ffffff', band: '#ec4899', number: '#0f172a', text: '#334155', accent: '#6366f1' } },
  speed: { label: 'Tốc độ', title: 'kanit', name: 'kanit', titleFx: 'none',
    colors: { bg: '#0f172a', band: '#f97316', number: '#ffffff', text: '#e2e8f0', accent: '#38bdf8' } },
  stadium: { label: 'Đường chạy', title: 'athletic', name: 'athletic', titleFx: 'stroke',
    colors: { bg: '#14532d', band: '#b91c1c', number: '#ffffff', text: '#ecfdf5', accent: '#fde047' } },
  neon: { label: 'Neon', title: 'tech', name: 'tech', titleFx: 'glow',
    colors: { bg: '#05010f', band: '#a855f7', number: '#ffffff', text: '#e9d5ff', accent: '#22d3ee' } },
  gradient: { label: 'Chuyển màu', title: 'unbounded', name: 'montserrat', titleFx: 'none',
    colors: { bg: '#4f46e5', band: '#db2777', number: '#ffffff', text: '#ffffff', accent: '#facc15' } },
  paper: { label: 'Giấy khen', title: 'garamond', name: 'vibes', titleFx: 'none',
    colors: { bg: '#fbf7ee', band: '#b08d3c', number: '#1e293b', text: '#334155', accent: '#7c2d12' } },
  minimal: { label: 'Tối giản', title: 'inter', name: 'inter', titleFx: 'none',
    colors: { bg: '#ffffff', band: '#0f172a', number: '#0f172a', text: '#475569', accent: '#e11d48' } },
}
export const HONOR_COLOR_LABEL: Record<ColorKey, string> = { bg: 'Nền', band: 'Màu chính', number: 'Tên nổi bật', text: 'Chữ', accent: 'Điểm nhấn' }

// ---------------------------------------------------------------------
// Trường dữ liệu
// ---------------------------------------------------------------------
const SAMPLE_NAMES = ['Nguyễn Văn An', 'Trần Thị Bình', 'Lê Minh Châu', 'Phạm Quốc Dũng', 'Hoàng Thu Hà', 'Vũ Đức Huy', 'Đỗ Mai Lan', 'Bùi Anh Khoa', 'Ngô Thảo My', 'Đặng Gia Nam']
export const HONOR_BINDS: Binds = {
  category: { label: 'Tên hạng mục', sample: 'Top thành tích' },
  challenge: { label: 'Tên thử thách', sample: 'Thử thách tháng 9' },
  org: { label: 'Đơn vị tổ chức', sample: 'Hồ Tây Runners' },
  date: { label: 'Ngày kết thúc', sample: '30/09/2026' },
  me_name: { label: 'Tên người được vinh danh (ảnh cá nhân)', sample: 'Nguyễn Văn An' },
  me_value: { label: 'Thành tích (ảnh cá nhân)', sample: '312,5 km' },
  me_rank: { label: 'Thứ hạng (ảnh cá nhân)', sample: 'Hạng 1' },
  ...Object.fromEntries(Array.from({ length: 10 }, (_, i) => [
    [`r${i + 1}_name`, { label: `Tên hạng ${i + 1}`, sample: SAMPLE_NAMES[i] }],
    [`r${i + 1}_value`, { label: `Thành tích hạng ${i + 1}`, sample: `${(320 - i * 23).toLocaleString('vi-VN')} km` }],
  ]).flat()),
}
export const HONOR_PHOTO_BINDS: Record<string, string> = {
  me: 'Người được vinh danh (ảnh cá nhân)',
  ...Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`r${i + 1}`, `Hạng ${i + 1}`])),
}
/** Trường ảnh cũng phải có trong danh sách trường để làm sạch */
const ALL_BINDS: Binds = { ...HONOR_BINDS, ...Object.fromEntries(Object.entries(HONOR_PHOTO_BINDS).map(([k, v]) => [k, { label: v, sample: '' }])) }

// ---------------------------------------------------------------------
// Thiết kế
// ---------------------------------------------------------------------
export interface HonorDesign {
  v: 2
  format: HonorFormat
  template: HonorTemplate
  colors: Partial<Palette>
  bg_url: string | null
  bg_opacity: number
  decor: boolean
  layers: Layer[]
}
export type StoredHonorDesign = Partial<Omit<HonorDesign, 'layers'>> & { layers?: unknown[] }
export type HonorMode = 'poster' | 'card'
export const MAX_HONOR_LAYERS = 60

interface Geo {
  head: [number, number, number, number]          // logo, "VINH DANH", hạng mục, thử thách
  p: [{ x: number; y: number; w: number }, { x: number; y: number; w: number }, { x: number; y: number; w: number }]
  list: number; gap: number; cols: 1 | 2; foot: number; k: number
}
const GEO: Record<HonorFormat, Geo> = {
  portrait: { head: [0.06, 0.12, 0.175, 0.225], p: [{ x: 0.5, y: 0.41, w: 0.3 }, { x: 0.19, y: 0.47, w: 0.22 }, { x: 0.81, y: 0.47, w: 0.22 }],
    list: 0.72, gap: 0.045, cols: 1, foot: 0.95, k: 1 },
  square: { head: [0.065, 0.13, 0.19, 0.245], p: [{ x: 0.5, y: 0.45, w: 0.25 }, { x: 0.2, y: 0.5, w: 0.18 }, { x: 0.8, y: 0.5, w: 0.18 }],
    list: 0.76, gap: 0.052, cols: 2, foot: 0.95, k: 0.92 },
  story: { head: [0.07, 0.115, 0.155, 0.195], p: [{ x: 0.5, y: 0.36, w: 0.36 }, { x: 0.2, y: 0.44, w: 0.26 }, { x: 0.8, y: 0.44, w: 0.26 }],
    list: 0.6, gap: 0.035, cols: 1, foot: 0.95, k: 1.1 },
  wide: { head: [0.08, 0.15, 0.225, 0.295], p: [{ x: 0.5, y: 0.52, w: 0.16 }, { x: 0.29, y: 0.57, w: 0.12 }, { x: 0.71, y: 0.57, w: 0.12 }],
    list: 0.84, gap: 0.06, cols: 2, foot: 0.95, k: 0.8 },
}

/** Ảnh nhóm: đầu trang → bục top 3 (ảnh + tên + thành tích + huy hiệu hạng) → danh sách hạng 4..n → chân (ngày, BTC, QR) */
export function autoHonorPoster(format: HonorFormat, template: HonorTemplate, n: number, keep: { logo?: Layer | null } = {}): Layer[] {
  const t = HONOR_TEMPLATES[template]
  const { w: W, h: H } = HONOR_FORMATS[format]
  const g = GEO[format]
  const S = (f: number) => Math.round(W * f * g.k)
  const sq = (w: number) => (w * W) / H
  const layers: Layer[] = []
  layers.push(
    { ...(keep.logo ?? imageLayer({ x: 0, y: 0, role: 'logo' })), x: 0.5, y: g.head[0], w: 0.14 * g.k, h: 0.05 * (1350 / H) * 1.2, rot: 0 } as Layer,
    textLayer({ x: 0.5, y: g.head[1], text: 'VINH DANH', font: 'montserrat', size: S(0.028), w: 0.8, color: 'accent', spacing: 0.45 }),
    textLayer({ x: 0.5, y: g.head[2], bind: 'category', font: t.title, size: S(format === 'wide' ? 0.05 : 0.07), w: 0.9, color: 'number', upper: true,
      fx: t.titleFx, fx_color: template === 'neon' ? 'band' : 'band' }),
    textLayer({ x: 0.5, y: g.head[3], bind: 'challenge', font: 'sans', size: S(0.032), w: 0.86, color: 'text', opacity: 0.85 }),
  )
  const slots = Math.min(3, Math.max(1, n))
  const spots = slots === 1 ? [{ x: 0.5, y: g.p[0].y + 0.02, w: g.p[0].w * 1.3 }]
    : slots === 2 ? [{ x: 0.33, y: g.p[0].y, w: g.p[0].w }, { x: 0.67, y: g.p[0].y + 0.03, w: g.p[1].w * 1.1 }]
    : g.p
  const medal: ColorKey[] = ['accent', 'text', 'band']
  spots.forEach((s, i) => {
    const r = i + 1
    const ph = sq(s.w)
    layers.push(
      photoLayer({ x: s.x, y: s.y, bind: `r${r}`, w: s.w, h: ph, border: r === 1 ? 10 : 7, border_color: medal[i], shape: 'circle' }),
      textLayer({ x: s.x + s.w * 0.36, y: s.y + ph * 0.36, text: String(r), font: 'montserrat', size: S(r === 1 ? 0.04 : 0.032), w: 0.1,
        color: 'bg', fx: 'pill', fx_color: medal[i] }),
      textLayer({ x: s.x, y: s.y + ph / 2 + 0.035 * g.k * (1350 / H), bind: `r${r}_name`, font: t.name, size: S(r === 1 ? 0.04 : 0.032),
        w: slots === 3 ? (r === 1 ? 0.36 : 0.28) : 0.42, color: 'number', upper: t.name !== 'vibes' }),
      textLayer({ x: s.x, y: s.y + ph / 2 + 0.07 * g.k * (1350 / H), bind: `r${r}_value`, font: 'sans', size: S(r === 1 ? 0.03 : 0.026),
        w: 0.3, color: 'accent' }),
    )
  })
  // Hạng 4..n
  const rest = Math.max(0, Math.min(10, n) - 3)
  const perCol = g.cols === 2 ? Math.ceil(rest / 2) : rest
  const maxRows = Math.max(0, Math.floor((g.foot - 0.05 - g.list) / g.gap) + 1)
  for (let i = 0; i < rest; i++) {
    const col = g.cols === 2 ? Math.floor(i / perCol) : 0
    const row = g.cols === 2 ? i % perCol : i
    if (row >= maxRows) continue
    const r = i + 4
    const x0 = g.cols === 2 ? (col === 0 ? 0.08 : 0.54) : 0.12
    const x1 = g.cols === 2 ? (col === 0 ? 0.46 : 0.92) : 0.88
    const y = g.list + row * g.gap
    layers.push(
      textLayer({ x: x0, y, text: `${r}.`, font: 'montserrat', size: S(0.026), w: 0.06, align: 'left', color: 'accent' }),
      textLayer({ x: x0 + 0.05, y, bind: `r${r}_name`, font: 'sans', size: S(0.026), w: (x1 - x0) * 0.62, align: 'left', color: 'number' }),
      textLayer({ x: x1, y, bind: `r${r}_value`, font: 'sans', size: S(0.024), w: (x1 - x0) * 0.35, align: 'right', color: 'text' }),
    )
  }
  layers.push(
    textLayer({ x: 0.5, y: g.foot, bind: 'date', font: 'sans', size: S(0.022), w: 0.5, color: 'text', opacity: 0.75 }),
    textLayer({ x: 0.5, y: g.foot - 0.03 * (1350 / H) * g.k, bind: 'org', font: 'sans', size: S(0.024), w: 0.6, color: 'text', upper: true, spacing: 0.1 }),
    qrLayer({ x: format === 'wide' ? 0.94 : 0.9, y: format === 'wide' ? 0.12 : g.head[0] + 0.01, source: 'race', w: format === 'wide' ? 0.06 : 0.09,
      label: 'Xem thử thách' }),
  )
  return layers
}

/** Ảnh cá nhân: ảnh lớn + tên + hạng + thành tích — mỗi người được vinh danh một ảnh */
export function autoHonorCard(format: HonorFormat, template: HonorTemplate, keep: { logo?: Layer | null } = {}): Layer[] {
  const t = HONOR_TEMPLATES[template]
  const { w: W, h: H } = HONOR_FORMATS[format]
  const g = GEO[format]
  const S = (f: number) => Math.round(W * f * g.k)
  const pw = format === 'wide' ? 0.26 : format === 'story' ? 0.6 : 0.46
  const py = format === 'wide' ? 0.55 : format === 'story' ? 0.4 : 0.44
  const ph = (pw * W) / H
  const below = py + ph / 2
  return [
    ...(template === 'paper' || template === 'gold'
      ? [shapeLayer({ x: 0.5, y: py, shape: 'laurel', w: pw * 1.35, h: ph * 1.35, fill: 'band', opacity: 0.75 })] : []),
    { ...(keep.logo ?? imageLayer({ x: 0, y: 0, role: 'logo' })), x: 0.5, y: g.head[0], w: 0.14 * g.k, h: 0.05 * (1350 / H) * 1.2, rot: 0 } as Layer,
    textLayer({ x: 0.5, y: g.head[1], text: 'VINH DANH', font: 'montserrat', size: S(0.028), w: 0.8, color: 'accent', spacing: 0.45 }),
    textLayer({ x: 0.5, y: g.head[2], bind: 'category', font: t.title, size: S(format === 'wide' ? 0.05 : 0.068), w: 0.9, color: 'number', upper: true,
      fx: t.titleFx, fx_color: 'band' }),
    photoLayer({ x: 0.5, y: py, bind: 'me', w: pw, h: ph, border: 12, border_color: 'accent', shape: 'circle' }),
    textLayer({ x: 0.5, y: below + 0.05 * (1350 / H) * g.k, bind: 'me_name', font: t.name, size: S(t.name === 'vibes' ? 0.08 : 0.062), w: 0.9,
      color: 'number', upper: t.name !== 'vibes' }),
    textLayer({ x: 0.5, y: below + 0.1 * (1350 / H) * g.k, bind: 'me_rank', font: 'montserrat', size: S(0.03), w: 0.4, color: 'bg', fx: 'pill', fx_color: 'accent',
      upper: true }),
    textLayer({ x: 0.5, y: below + 0.145 * (1350 / H) * g.k, bind: 'me_value', font: 'sans', size: S(0.036), w: 0.6, color: 'accent' }),
    textLayer({ x: 0.5, y: g.foot - 0.06 * (1350 / H) * g.k, bind: 'challenge', font: 'sans', size: S(0.03), w: 0.86, color: 'text' }),
    textLayer({ x: 0.5, y: g.foot - 0.03 * (1350 / H) * g.k, bind: 'org', font: 'sans', size: S(0.024), w: 0.6, color: 'text', upper: true, spacing: 0.1 }),
    textLayer({ x: 0.5, y: g.foot, bind: 'date', font: 'sans', size: S(0.022), w: 0.5, color: 'text', opacity: 0.75 }),
  ]
}

export function freshHonor(mode: HonorMode, n = 3, format: HonorFormat = 'portrait', template: HonorTemplate = 'podium'): HonorDesign {
  return { v: 2, format, template, colors: {}, bg_url: null, bg_opacity: 1, decor: true,
    layers: mode === 'poster' ? autoHonorPoster(format, template, n) : autoHonorCard(format, template) }
}

const cleanColors = (c: unknown): Partial<Palette> =>
  Object.fromEntries(Object.entries((c && typeof c === 'object' ? c : {}) as Record<string, unknown>)
    .filter(([k, v]) => k in HONOR_TEMPLATES.podium.colors && isHex(v)).map(([k, v]) => [k, (v as string).toLowerCase()]))

export function resolveHonor(d: StoredHonorDesign | null | undefined, mode: HonorMode, n = 3): HonorDesign & { palette: Palette } {
  let design: HonorDesign
  if (!d || d.v !== 2) design = freshHonor(mode, n)
  else {
    const format = d.format && d.format in HONOR_FORMATS ? d.format : 'portrait'
    const template = d.template && d.template in HONOR_TEMPLATES ? d.template : 'podium'
    design = { v: 2, format, template, colors: cleanColors(d.colors), bg_url: d.bg_url ?? null,
      bg_opacity: typeof d.bg_opacity === 'number' ? Math.min(1, Math.max(0, d.bg_opacity)) : 1, decor: d.decor !== false,
      layers: cleanLayers(d.layers, ALL_BINDS, MAX_HONOR_LAYERS) }
  }
  return { ...design, palette: { ...HONOR_TEMPLATES[design.template].colors, ...design.colors } }
}

export function honorPayload(d: HonorDesign) {
  const base = HONOR_TEMPLATES[d.template].colors
  const colors = Object.fromEntries(Object.entries(d.colors).filter(([k, v]) => v && v.toLowerCase() !== base[k as ColorKey]))
  return { ...d, colors, layers: d.layers.filter((l) => !(l.type === 'text' && l.bind === 'custom' && !l.text.trim())) }
}

// ---------------------------------------------------------------------
// Nền tự vẽ (không lo bản quyền, đổi màu theo bảng màu)
// ---------------------------------------------------------------------
function rng(seed: number) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}

export function drawHonorBackground(ctx: CanvasRenderingContext2D, d: HonorDesign, c: Palette, bg: HTMLImageElement | null) {
  const { w, h } = HONOR_FORMATS[d.format]
  const m = Math.min(w, h)
  ctx.fillStyle = c.bg
  ctx.fillRect(0, 0, w, h)
  if (d.decor) {
    ctx.save()
    switch (d.template) {
      case 'podium': {
        const g = ctx.createLinearGradient(0, 0, 0, h)
        g.addColorStop(0, c.bg); g.addColorStop(1, '#000000')
        ctx.fillStyle = g; ctx.fillRect(0, 0, w, h)
        // đèn sân khấu
        for (const [x, a] of [[0.15, 0.25], [0.5, 0.32], [0.85, 0.25]] as const) {
          const sg = ctx.createLinearGradient(0, 0, 0, h * 0.8)
          sg.addColorStop(0, `rgba(255,255,255,${a})`); sg.addColorStop(1, 'rgba(255,255,255,0)')
          ctx.fillStyle = sg
          ctx.beginPath(); ctx.moveTo(w * x - m * 0.03, 0); ctx.lineTo(w * x + m * 0.03, 0); ctx.lineTo(w * x + m * 0.28, h * 0.8); ctx.lineTo(w * x - m * 0.28, h * 0.8); ctx.fill()
        }
        const fg = ctx.createRadialGradient(w / 2, h * 0.92, 0, w / 2, h * 0.92, w * 0.6)
        fg.addColorStop(0, c.band); fg.addColorStop(1, 'rgba(0,0,0,0)')
        ctx.globalAlpha = 0.55; ctx.fillStyle = fg; ctx.fillRect(0, h * 0.6, w, h * 0.4)
        break
      }
      case 'gold': {
        const g = ctx.createLinearGradient(0, 0, w, h)
        g.addColorStop(0, '#1a1406'); g.addColorStop(0.5, c.bg); g.addColorStop(1, '#1a1406')
        ctx.fillStyle = g; ctx.fillRect(0, 0, w, h)
        const gold = ctx.createLinearGradient(0, 0, w, h)
        gold.addColorStop(0, '#8a5d0d'); gold.addColorStop(0.3, '#f7d774'); gold.addColorStop(0.5, '#b8861b'); gold.addColorStop(0.7, '#fff3b0'); gold.addColorStop(1, '#8a5d0d')
        ctx.strokeStyle = gold; ctx.lineWidth = m * 0.012; ctx.strokeRect(m * 0.035, m * 0.035, w - m * 0.07, h - m * 0.07)
        ctx.lineWidth = m * 0.003; ctx.strokeRect(m * 0.055, m * 0.055, w - m * 0.11, h - m * 0.11)
        ctx.globalAlpha = 0.06; ctx.fillStyle = '#f7d774'
        for (let i = -2; i < 6; i++) { ctx.beginPath(); ctx.moveTo(i * w * 0.25, 0); ctx.lineTo(i * w * 0.25 + w * 0.08, 0); ctx.lineTo(i * w * 0.25 + w * 0.08 + h * 0.5, h); ctx.lineTo(i * w * 0.25 + h * 0.5, h); ctx.fill() }
        break
      }
      case 'rays': {
        const cx = w / 2, cy = h * 0.42, R = Math.hypot(w, h)
        ctx.fillStyle = c.band; ctx.globalAlpha = 0.28
        for (let i = 0; i < 24; i += 2) {
          const a0 = (Math.PI * 2 * i) / 24, a1 = (Math.PI * 2 * (i + 1)) / 24
          ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a0) * R, cy + Math.sin(a0) * R); ctx.lineTo(cx + Math.cos(a1) * R, cy + Math.sin(a1) * R); ctx.fill()
        }
        ctx.globalAlpha = 1
        const rg = ctx.createRadialGradient(cx, cy, 0, cx, cy, m * 0.6)
        rg.addColorStop(0, 'rgba(255,255,255,0.85)'); rg.addColorStop(1, 'rgba(255,255,255,0)')
        ctx.fillStyle = rg; ctx.fillRect(0, 0, w, h)
        break
      }
      case 'confetti': {
        const r = rng(7)
        const cols = [c.band, c.accent, '#facc15', '#22c55e', '#38bdf8']
        for (let i = 0; i < 140; i++) {
          const x = r() * w, y = r() * h
          if (y > h * 0.22 && y < h * 0.9 && x > w * 0.1 && x < w * 0.9 && r() < 0.75) continue       // chừa vùng giữa cho chữ
          ctx.save(); ctx.translate(x, y); ctx.rotate(r() * Math.PI)
          ctx.fillStyle = cols[i % cols.length]; ctx.globalAlpha = 0.85
          if (i % 3 === 0) { ctx.beginPath(); ctx.arc(0, 0, m * 0.006, 0, Math.PI * 2); ctx.fill() } else ctx.fillRect(-m * 0.012, -m * 0.004, m * 0.024, m * 0.008)
          ctx.restore()
        }
        break
      }
      case 'speed': {
        const r = rng(3)
        for (let i = 0; i < 40; i++) {
          ctx.globalAlpha = 0.08 + r() * 0.2
          ctx.fillStyle = i % 3 ? c.band : c.accent
          const y = r() * h, len = w * (0.3 + r() * 0.5), x = r() * w - len / 2, th = m * (0.003 + r() * 0.01)
          ctx.save(); ctx.translate(x, y); ctx.rotate(-0.35); ctx.fillRect(0, 0, len, th); ctx.restore()
        }
        break
      }
      case 'stadium': {
        // đường chạy điền kinh: các làn cong phía dưới
        ctx.fillStyle = c.band
        ctx.beginPath(); ctx.ellipse(w / 2, h * 1.18, w * 0.95, h * 0.5, 0, 0, Math.PI * 2); ctx.fill()
        ctx.strokeStyle = 'rgba(255,255,255,0.75)'; ctx.lineWidth = m * 0.004
        for (let i = 0; i < 6; i++) { ctx.beginPath(); ctx.ellipse(w / 2, h * 1.18, w * (0.95 - i * 0.05), h * (0.5 - i * 0.035), 0, Math.PI, Math.PI * 2); ctx.stroke() }
        ctx.fillStyle = c.bg
        ctx.beginPath(); ctx.ellipse(w / 2, h * 1.18, w * 0.64, h * 0.29, 0, 0, Math.PI * 2); ctx.fill()
        const tg = ctx.createLinearGradient(0, 0, 0, h * 0.6)
        tg.addColorStop(0, 'rgba(0,0,0,0.35)'); tg.addColorStop(1, 'rgba(0,0,0,0)')
        ctx.fillStyle = tg; ctx.fillRect(0, 0, w, h * 0.6)
        break
      }
      case 'neon': {
        ctx.strokeStyle = c.band; ctx.globalAlpha = 0.22; ctx.lineWidth = 1.5
        const hy = h * 0.72
        for (let i = -12; i <= 12; i++) { ctx.beginPath(); ctx.moveTo(w / 2, hy); ctx.lineTo(w / 2 + i * w * 0.12, h); ctx.stroke() }
        for (let i = 0; i < 8; i++) { const y = hy + (h - hy) * Math.pow(i / 8, 1.8); ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke() }
        ctx.globalAlpha = 1
        ctx.shadowColor = c.accent; ctx.shadowBlur = m * 0.03; ctx.strokeStyle = c.accent; ctx.lineWidth = m * 0.004
        ctx.strokeRect(m * 0.04, m * 0.04, w - m * 0.08, h - m * 0.08)
        break
      }
      case 'gradient': {
        const g = ctx.createLinearGradient(0, 0, w, h)
        g.addColorStop(0, c.bg); g.addColorStop(1, c.band)
        ctx.fillStyle = g; ctx.fillRect(0, 0, w, h)
        ctx.globalAlpha = 0.2; ctx.fillStyle = c.accent
        ctx.beginPath(); ctx.arc(w * 0.9, h * 0.1, m * 0.45, 0, Math.PI * 2); ctx.fill()
        ctx.beginPath(); ctx.arc(w * 0.05, h * 0.92, m * 0.35, 0, Math.PI * 2); ctx.fill()
        break
      }
      case 'paper': {
        ctx.strokeStyle = c.band; ctx.lineWidth = m * 0.008; ctx.strokeRect(m * 0.035, m * 0.035, w - m * 0.07, h - m * 0.07)
        ctx.lineWidth = m * 0.002; ctx.strokeRect(m * 0.052, m * 0.052, w - m * 0.104, h - m * 0.104)
        break
      }
      case 'minimal':
        ctx.fillStyle = c.accent; ctx.fillRect(0, 0, w, m * 0.018)
        ctx.fillStyle = c.band; ctx.fillRect(0, h - m * 0.018, w, m * 0.018)
        break
    }
    ctx.restore()
  }
  if (bg) { ctx.save(); ctx.globalAlpha = d.bg_opacity; drawCover(ctx, bg, w, h); ctx.restore() }
}

// ---------------------------------------------------------------------
// Dữ liệu vẽ
// ---------------------------------------------------------------------
export interface HonoreeLite { rank: number; display_name: string; value: number | null; photo_url: string | null; avatar_url: string | null; hidden?: boolean }
export interface HonorContext { challenge: string; org: string; date: string; objective: string | null; challengeUrl: string | null }

export function honorData(ctx: HonorContext, cat: { key: string; title: string }, rows: HonoreeLite[], me?: HonoreeLite | null): DrawData {
  const values: Record<string, string | null> = { category: cat.title, challenge: ctx.challenge, org: ctx.org, date: ctx.date }
  const photos: Record<string, string | null> = {}
  for (const r of rows) {
    values[`r${r.rank}_name`] = r.display_name
    values[`r${r.rank}_value`] = honorValue(cat.key, r.value, ctx.objective)
    photos[`r${r.rank}`] = r.hidden ? null : r.photo_url ?? r.avatar_url
  }
  if (me) {
    values.me_name = me.display_name
    values.me_value = honorValue(cat.key, me.value, ctx.objective)
    values.me_rank = cat.key.startsWith('CUSTOM') ? cat.title : `Hạng ${me.rank}`
    photos.me = me.photo_url ?? me.avatar_url
  }
  return { values, photos, qr: { race: ctx.challengeUrl } }
}

export async function drawHonor(canvas: HTMLCanvasElement, design: StoredHonorDesign | null | undefined, mode: HonorMode, data: DrawData,
  opts: DrawOptions = {}, n = 3): Promise<Layout> {
  const d = resolveHonor(design, mode, n)
  const bg = await loadImage(d.bg_url)
  return drawLayers(canvas, HONOR_FORMATS[d.format], (c) => drawHonorBackground(c, d, d.palette, bg), d.layers, d.palette, data,
    { binds: HONOR_BINDS, ...opts })
}
