// Victory Studio (migration 011600): mẫu ảnh vinh danh, khổ ảnh, bố cục tự căn theo khổ.
// Dùng engine lớp chung (shared/design/engine) + nền tự vẽ (shared/design/backdrops). Số liệu lấy từ máy chủ, không cho sửa.
import {
  drawLayers, imageLayer, isHex, photoLayer, qrLayer, shapeLayer, textLayer,
  type FontKey, type Layer, type Layout, type Palette, type Size, type TextFx,
} from '@/shared/design/engine'
import { paintBackdrop, rng, type Backdrop } from '@/shared/design/backdrops'

export type VicKind = 'CHALLENGE' | 'RUN' | 'TOTAL_KM' | 'LEVEL' | 'BADGE'
export interface VicStat { key: string; label: string; value: string }
export interface VicPerson { id: string; display_name: string | null; avatar_url: string | null; level: number }
export interface VicFacts {
  kind: VicKind
  ref: string
  state: string
  headline: string
  title: string
  subtitle: string | null
  date: string | null
  club: string | null
  link: string
  icon?: string | null
  stats: VicStat[]
  honors: string[]
  person: VicPerson
  can_award?: boolean
}

export const KIND_LABEL: Record<VicKind, string> = {
  CHALLENGE: 'Thử thách', RUN: 'Thành tích cá nhân', TOTAL_KM: 'Cột mốc km', LEVEL: 'Level', BADGE: 'Huy hiệu',
}

// ---------------------------------------------------------------------
// Khổ ảnh
// ---------------------------------------------------------------------
export type VicFormat = 'story' | 'portrait' | 'square' | 'wide' | 'a4'
export const VIC_FORMATS: Record<VicFormat, { label: string; hint: string; w: number; h: number }> = {
  story: { label: 'Story 9:16', hint: 'Facebook / Instagram Story', w: 1080, h: 1920 },
  portrait: { label: 'Dọc 4:5', hint: 'Bài đăng Facebook / Instagram', w: 1080, h: 1350 },
  square: { label: 'Vuông 1:1', hint: 'Bảng tin, Zalo', w: 1080, h: 1080 },
  wide: { label: 'Ngang 16:9', hint: 'Trang CLB, sự kiện, màn chiếu', w: 1600, h: 900 },
  a4: { label: 'Chứng nhận A4', hint: 'Lưu hoặc in', w: 1240, h: 1754 },
}

// ---------------------------------------------------------------------
// Mẫu
// ---------------------------------------------------------------------
export type VicStyle = 'minimal' | 'sport' | 'game' | 'premium'
export const VIC_STYLES: Record<VicStyle, string> = { minimal: 'Tối giản', sport: 'Thể thao', game: 'Game hóa', premium: 'Cao cấp' }

type Paint = Backdrop | 'arcade' | 'dawn'
interface TemplateDef {
  label: string; style: VicStyle; paint: Paint; colors: Palette
  title: FontKey; name: FontKey; titleFx: TextFx; photo: 'circle' | 'hex' | 'shield' | 'arch' | 'round'; laurel?: boolean
}
export const VIC_TEMPLATES = {
  minimal: { label: 'Tối giản', style: 'minimal', paint: 'minimal', title: 'inter', name: 'inter', titleFx: 'none', photo: 'circle',
    colors: { bg: '#ffffff', band: '#0f172a', number: '#0f172a', text: '#475569', accent: '#e11d48' } },
  gradient: { label: 'Chuyển màu', style: 'minimal', paint: 'gradient', title: 'unbounded', name: 'montserrat', titleFx: 'none', photo: 'round',
    colors: { bg: '#4f46e5', band: '#db2777', number: '#ffffff', text: '#ffffff', accent: '#facc15' } },
  confetti: { label: 'Pháo giấy', style: 'minimal', paint: 'confetti', title: 'paytone', name: 'montserrat', titleFx: 'none', photo: 'circle',
    colors: { bg: '#ffffff', band: '#ec4899', number: '#0f172a', text: '#334155', accent: '#6366f1' } },
  speed: { label: 'Tốc độ', style: 'sport', paint: 'speed', title: 'kanit', name: 'kanit', titleFx: 'none', photo: 'circle',
    colors: { bg: '#0f172a', band: '#f97316', number: '#ffffff', text: '#e2e8f0', accent: '#38bdf8' } },
  stadium: { label: 'Đường chạy', style: 'sport', paint: 'stadium', title: 'athletic', name: 'athletic', titleFx: 'stroke', photo: 'shield',
    colors: { bg: '#14532d', band: '#b91c1c', number: '#ffffff', text: '#ecfdf5', accent: '#fde047' } },
  dawn: { label: 'Bình minh', style: 'sport', paint: 'dawn', title: 'impact', name: 'condensed', titleFx: 'shadow', photo: 'arch',
    colors: { bg: '#1e1b4b', band: '#f97316', number: '#ffffff', text: '#fde68a', accent: '#fbbf24' } },
  rays: { label: 'Tia nắng', style: 'sport', paint: 'rays', title: 'unbounded', name: 'montserrat', titleFx: 'none', photo: 'circle',
    colors: { bg: '#fef3c7', band: '#f59e0b', number: '#111827', text: '#1f2937', accent: '#b45309' } },
  neon: { label: 'Neon', style: 'game', paint: 'neon', title: 'tech', name: 'tech', titleFx: 'glow', photo: 'hex',
    colors: { bg: '#05010f', band: '#a855f7', number: '#ffffff', text: '#e9d5ff', accent: '#22d3ee' } },
  arcade: { label: 'Level up', style: 'game', paint: 'arcade', title: 'bungee', name: 'exo', titleFx: 'extrude', photo: 'hex',
    colors: { bg: '#0b1026', band: '#b6ff3b', number: '#ffffff', text: '#c7d2fe', accent: '#b6ff3b' } },
  podium: { label: 'Sân khấu', style: 'premium', paint: 'podium', title: 'montserrat', name: 'sans', titleFx: 'gold', photo: 'circle',
    colors: { bg: '#0b1020', band: '#1d4ed8', number: '#ffffff', text: '#e2e8f0', accent: '#fbbf24' } },
  gold: { label: 'Nhũ vàng', style: 'premium', paint: 'gold', title: 'cormorant', name: 'serif', titleFx: 'gold', photo: 'circle', laurel: true,
    colors: { bg: '#0a0a0a', band: '#d4a017', number: '#ffffff', text: '#e5e5e5', accent: '#d4a017' } },
  paper: { label: 'Giấy khen', style: 'premium', paint: 'paper', title: 'garamond', name: 'vibes', titleFx: 'none', photo: 'circle', laurel: true,
    colors: { bg: '#fbf7ee', band: '#b08d3c', number: '#1e293b', text: '#334155', accent: '#7c2d12' } },
} as const satisfies Record<string, TemplateDef>
export type VicTemplate = keyof typeof VIC_TEMPLATES

/** Mẫu gợi ý theo loại thành tích (hiện đầu danh sách) */
export const SUGGESTED: Record<VicKind, VicTemplate[]> = {
  CHALLENGE: ['podium', 'gold', 'stadium'], RUN: ['speed', 'dawn', 'rays'], TOTAL_KM: ['stadium', 'gold', 'dawn'],
  LEVEL: ['arcade', 'neon', 'gradient'], BADGE: ['arcade', 'gold', 'confetti'],
}

/** Màu điểm nhấn gợi ý (ngoài màu của mẫu) */
export const ACCENTS = ['#b6ff3b', '#fbbf24', '#f97316', '#ef4444', '#ec4899', '#a855f7', '#38bdf8', '#22c55e']

export const KICKERS = ['VINH DANH', 'CHÚC MỪNG', 'FINISHER', 'TỰ HÀO', 'CHINH PHỤC'] as const

export const MESSAGES: Record<VicKind | 'ANY', string[]> = {
  CHALLENGE: ['Kiên trì từng bước, về đích rực rỡ!', 'Mỗi km là một lời hứa với bản thân.', 'Cảm ơn đồng đội đã cùng chạy!'],
  RUN: ['Hôm nay nhanh hơn hôm qua.', 'Chạy vì yêu, về đích vì kiên trì.', 'Đôi chân mỏi, trái tim vui.'],
  TOTAL_KM: ['Từng bước nhỏ làm nên hành trình lớn.', 'Con đường còn dài, cứ chạy tiếp thôi!'],
  LEVEL: ['Lên cấp rồi! Hành trình mới bắt đầu.', 'Chăm chỉ mỗi ngày sẽ được đền đáp.'],
  BADGE: ['Thêm một huy hiệu vào bộ sưu tập!', 'Thành tích được ghi nhận trên RaceHub.'],
  ANY: ['Không có đích đến nào quá xa.', 'Just keep running 🏃'],
}

export type PhotoMode = 'avatar' | 'character' | 'upload' | 'none'
export interface VicOptions {
  template: VicTemplate
  format: VicFormat
  accent: string | null
  kicker: string
  message: string
  /** Thông số hiện trên ảnh (tối đa 4, theo thứ tự chọn) */
  stats: string[]
  photo: PhotoMode
  showQr: boolean
  showClub: boolean
  showHonor: boolean
}
export const MAX_STATS = 4

/** Thông số mặc định theo loại thành tích: runner đổi được ngay trên màn thiết kế */
export function defaultStats(f: Pick<VicFacts, 'kind' | 'stats' | 'state'>): string[] {
  const keys = f.stats.map((s) => s.key)
  const prefer: Record<VicKind, string[]> = {
    CHALLENGE: f.state === 'IN_PROGRESS' ? ['score', 'goal', 'time'] : ['score', 'rank', 'time'],
    RUN: ['km', 'time', 'pace'], TOTAL_KM: ['km', 'runs', 'since'], LEVEL: ['level', 'title', 'xp'], BADGE: ['tier', 'at'],
  }
  const picked = prefer[f.kind].filter((k) => keys.includes(k))
  return picked.length ? picked : keys.slice(0, 3)
}

export function defaultOptions(f: VicFacts): VicOptions {
  return {
    template: SUGGESTED[f.kind][0], format: 'portrait', accent: null, kicker: f.kind === 'CHALLENGE' && f.state === 'COMPLETED' ? 'FINISHER' : 'VINH DANH',
    message: '', stats: defaultStats(f), photo: 'avatar', showQr: true, showClub: true, showHonor: true,
  }
}

export function paletteOf(o: Pick<VicOptions, 'template' | 'accent'>): Palette {
  const base = VIC_TEMPLATES[o.template].colors
  return o.accent && isHex(o.accent) ? { ...base, accent: o.accent } : { ...base }
}

// ---------------------------------------------------------------------
// Bố cục tự căn theo khổ
// ---------------------------------------------------------------------
interface Geo {
  kicker: number; headline: number; title: number; photo: number; pw: number; name: number; stat: number; honor: number; message: number; foot: number
  k: number
}
const GEO: Record<Exclude<VicFormat, 'wide'>, Geo> = {
  portrait: { kicker: 0.085, headline: 0.14, title: 0.195, photo: 0.375, pw: 0.34, name: 0.57, stat: 0.655, honor: 0.745, message: 0.8, foot: 0.925, k: 1 },
  story: { kicker: 0.12, headline: 0.162, title: 0.205, photo: 0.375, pw: 0.44, name: 0.53, stat: 0.61, honor: 0.69, message: 0.745, foot: 0.905, k: 1.08 },
  square: { kicker: 0.075, headline: 0.132, title: 0.192, photo: 0.365, pw: 0.25, name: 0.53, stat: 0.625, honor: 0.725, message: 0.785, foot: 0.925, k: 0.92 },
  a4: { kicker: 0.1, headline: 0.15, title: 0.198, photo: 0.355, pw: 0.3, name: 0.51, stat: 0.595, honor: 0.675, message: 0.735, foot: 0.9, k: 1.05 },
}

export interface VicAssets {
  /** Ảnh người được vinh danh (ảnh đại diện / ảnh tải lên) */
  photo: string | null
  /** Nhân vật 2D (data URL, nền trong suốt) */
  character: string | null
  /** Đường dẫn trang xác thực (QR) */
  verifyUrl: string | null
  code: string | null
  award: string | null
}

const BRAND = '/icons/rh5-mark-256.png'

export function victoryLayers(f: VicFacts, o: VicOptions, a: VicAssets): Layer[] {
  const t = VIC_TEMPLATES[o.template]
  const { w: W, h: H } = VIC_FORMATS[o.format]
  const wide = o.format === 'wide'
  const g = o.format === 'wide' ? null : GEO[o.format]
  const k = g?.k ?? 0.72
  const S = (x: number) => Math.round(W * x * k)
  const cx = wide ? 0.63 : 0.5
  const colW = wide ? 0.54 : 0.88
  const stats = o.stats.map((key) => f.stats.find((s) => s.key === key)).filter(Boolean).slice(0, MAX_STATS) as VicStat[]
  const honor = a.award ?? (o.showHonor ? f.honors[0] ?? null : null)
  const name = f.person.display_name ?? 'Runner'
  const L: Layer[] = []
  const y = (portrait: keyof Geo, wideY: number) => (g ? g[portrait] : wideY)

  // Thương hiệu RaceHub
  L.push(
    imageLayer({ x: wide ? 0.06 : 0.1, y: wide ? 0.09 : (o.format === 'story' ? 0.06 : 0.045), src: BRAND, w: wide ? 0.04 : 0.07, h: (wide ? 0.04 : 0.07) * W / H }),
    textLayer({ x: wide ? 0.09 : 0.145, y: wide ? 0.09 : (o.format === 'story' ? 0.06 : 0.045), text: 'RACEHUB', font: 'montserrat', size: S(0.026),
      w: 0.3, align: 'left', color: 'text', spacing: 0.25 }),
  )
  // Ảnh / nhân vật
  const pw = wide ? 0.24 : g!.pw
  const ph = (pw * W) / H
  const py = y('photo', 0.54)
  const px = wide ? 0.19 : 0.5
  if ('laurel' in t && t.laurel && o.photo !== 'none' && o.photo !== 'character') L.push(shapeLayer({ x: px, y: py, shape: 'laurel', w: pw * 1.4, h: ph * 1.4, fill: 'band', opacity: 0.8 }))
  if (o.photo === 'character' && a.character) {
    L.push(shapeLayer({ x: px, y: py + ph * 0.1, shape: 'circle', w: pw * 1.15, h: ph * 1.15, fill: 'band', opacity: 0.35 }))
    L.push(imageLayer({ x: px, y: py, src: a.character, w: pw * 1.25, h: ph * 1.5 }))
  } else if (o.photo !== 'none') {
    L.push(photoLayer({ x: px, y: py, bind: 'me', w: pw, h: ph, shape: t.photo, border: Math.round(W * 0.011), border_color: 'accent' }))
  } else if (f.icon) {
    L.push(textLayer({ x: px, y: py, text: f.icon, font: 'sans', size: S(0.22), w: 0.5, color: 'text' }))
  }
  // Tiêu đề
  L.push(
    textLayer({ x: cx, y: y('kicker', 0.17), text: o.kicker, font: 'montserrat', size: S(0.03), w: colW, color: 'accent', spacing: 0.45 }),
    textLayer({ x: cx, y: y('headline', 0.26), text: f.headline, font: t.title, size: S(wide ? 0.07 : 0.075), w: colW, color: 'number', upper: true,
      fx: t.titleFx, fx_color: 'band' }),
    textLayer({ x: cx, y: y('title', 0.35), text: f.title, font: 'sans', size: S(0.04), w: colW, color: 'text' }),
    textLayer({ x: cx, y: y('name', 0.47), text: name, font: t.name, size: S(t.name === 'vibes' ? 0.085 : 0.066), w: colW, color: 'number',
      upper: t.name !== 'vibes' }),
  )
  // Thông số (máy chủ đã định dạng)
  if (stats.length) {
    const n = stats.length
    const span = wide ? 0.5 : 0.84
    const x0 = cx - span / 2
    const big = S((n <= 2 ? 0.07 : n === 3 ? 0.058 : 0.048) * (wide ? 1.15 : 1))
    const sy = y('stat', 0.6)
    stats.forEach((s, i) => {
      const x = x0 + (span * (i + 0.5)) / n
      L.push(
        textLayer({ x, y: sy, text: s.value, font: 'athletic', size: big, w: (span / n) * 0.94, color: 'accent' }),
        textLayer({ x, y: sy + (big * 0.95) / H, text: s.label, font: 'sans', size: S(0.022), w: (span / n) * 0.94, color: 'text', opacity: 0.8, upper: true, spacing: 0.08 }),
      )
      if (i > 0) L.push(shapeLayer({ x: x0 + (span * i) / n, y: sy + (big * 0.35) / H, shape: 'line', w: 0.002, h: (big * 1.4) / H, fill: 'text', opacity: 0.25 }))
    })
  }
  if (honor) {
    L.push(textLayer({ x: cx, y: y('honor', 0.72), text: honor, font: 'montserrat', size: S(0.03), w: colW * 0.9, color: 'bg', fx: 'pill', fx_color: 'accent', upper: true }))
  }
  if (o.message.trim()) {
    L.push(textLayer({ x: cx, y: y('message', 0.8), text: `“${o.message.trim()}”`, font: 'serif', size: S(0.032), w: wide ? 0.46 : colW, color: 'text', italic: true }))
  }
  // Chân: CLB · ngày · QR xác thực
  const foot = [o.showClub ? f.club : null, f.date].filter(Boolean).join(' · ')
  const qx = wide ? 0.92 : 0.86, qy = wide ? 0.83 : g!.foot - 0.01
  const qw = wide ? 0.07 : 0.12
  if (foot) L.push(textLayer({ x: o.showQr ? (wide ? 0.62 : 0.42) : cx, y: y('foot', 0.92), text: foot, font: 'sans', size: S(0.024),
    w: o.showQr ? 0.6 : colW, color: 'text', opacity: 0.85 }))
  if (o.showQr && a.verifyUrl) {
    L.push(qrLayer({ x: qx, y: qy, source: 'verify', w: qw, label: 'Quét xem trên RaceHub', card: true }))
  }
  return L
}

// ---------------------------------------------------------------------
// Nền
// ---------------------------------------------------------------------
function paintExtra(ctx: CanvasRenderingContext2D, p: 'arcade' | 'dawn', c: Palette, { w, h }: Size) {
  const m = Math.min(w, h)
  ctx.save()
  if (p === 'arcade') {
    // lưới lục giác + thanh XP phía dưới
    const r = m * 0.05
    ctx.strokeStyle = c.band; ctx.globalAlpha = 0.12; ctx.lineWidth = 2
    for (let row = 0; row * r * 1.5 < h + r; row++) {
      for (let col = 0; col * r * Math.sqrt(3) < w + r; col++) {
        const x = col * r * Math.sqrt(3) + (row % 2 ? (r * Math.sqrt(3)) / 2 : 0), yy = row * r * 1.5
        ctx.beginPath()
        for (let i = 0; i < 6; i++) { const a = Math.PI / 6 + (Math.PI / 3) * i; ctx.lineTo(x + Math.cos(a) * r, yy + Math.sin(a) * r) }
        ctx.closePath(); ctx.stroke()
      }
    }
    ctx.globalAlpha = 1
    const rg = ctx.createRadialGradient(w / 2, h * 0.4, 0, w / 2, h * 0.4, m * 0.7)
    rg.addColorStop(0, 'rgba(182,255,59,0.18)'); rg.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = rg; ctx.fillRect(0, 0, w, h)
    const r2 = rng(11)
    ctx.fillStyle = c.accent
    for (let i = 0; i < 40; i++) { ctx.globalAlpha = 0.2 + r2() * 0.5; ctx.fillRect(r2() * w, r2() * h, m * 0.006, m * 0.006) }
  } else {
    // bình minh: trời chuyển màu, mặt trời, con đường
    const g = ctx.createLinearGradient(0, 0, 0, h)
    g.addColorStop(0, c.bg); g.addColorStop(0.55, '#7c2d12'); g.addColorStop(0.72, c.band); g.addColorStop(1, '#1c1917')
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h)
    const sun = ctx.createRadialGradient(w / 2, h * 0.72, 0, w / 2, h * 0.72, m * 0.35)
    sun.addColorStop(0, 'rgba(254,240,138,0.95)'); sun.addColorStop(0.35, 'rgba(251,191,36,0.55)'); sun.addColorStop(1, 'rgba(251,191,36,0)')
    ctx.fillStyle = sun; ctx.fillRect(0, 0, w, h)
    ctx.fillStyle = 'rgba(0,0,0,0.55)'
    ctx.beginPath(); ctx.moveTo(w * 0.47, h * 0.74); ctx.lineTo(w * 0.53, h * 0.74); ctx.lineTo(w * 0.85, h); ctx.lineTo(w * 0.15, h); ctx.fill()
    ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = m * 0.006; ctx.setLineDash([m * 0.03, m * 0.03])
    ctx.beginPath(); ctx.moveTo(w / 2, h * 0.76); ctx.lineTo(w / 2, h); ctx.stroke(); ctx.setLineDash([])
  }
  ctx.restore()
}

export function paintVictoryBackground(ctx: CanvasRenderingContext2D, o: VicOptions, c: Palette) {
  const size = VIC_FORMATS[o.format]
  ctx.fillStyle = c.bg
  ctx.fillRect(0, 0, size.w, size.h)
  const p = VIC_TEMPLATES[o.template].paint
  if (p === 'arcade' || p === 'dawn') paintExtra(ctx, p, c, size)
  else paintBackdrop(ctx, p, c, size)
  // Lớp tối nhẹ phía dưới để chữ chân trang luôn đọc được trên nền sáng/tối
  const dark = isDark(c.bg)
  const g = ctx.createLinearGradient(0, size.h * 0.82, 0, size.h)
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, dark ? 'rgba(0,0,0,0.35)' : 'rgba(255,255,255,0.4)')
  ctx.fillStyle = g; ctx.fillRect(0, size.h * 0.82, size.w, size.h * 0.18)
}

function isDark(hex: string) {
  const n = parseInt(hex.slice(1), 16)
  return ((n >> 16) * 299 + ((n >> 8) & 255) * 587 + (n & 255) * 114) / 1000 < 140
}

export async function drawVictory(canvas: HTMLCanvasElement, f: VicFacts, o: VicOptions, a: VicAssets): Promise<Layout> {
  const pal = paletteOf(o)
  return drawLayers(canvas, VIC_FORMATS[o.format], (ctx) => paintVictoryBackground(ctx, o, pal), victoryLayers(f, o, a), pal,
    { values: { me_name: f.person.display_name ?? 'Runner' }, photos: { me: a.photo }, qr: { verify: a.verifyUrl } })
}

export function fileName(f: Pick<VicFacts, 'kind' | 'title'>, code: string | null, ext: 'png' | 'jpg') {
  const slug = f.title.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 40)
  return `racehub-vinh-danh-${slug || f.kind.toLowerCase()}${code ? `-${code}` : ''}.${ext}`
}

/** Khóa thiết kế gọn để máy chủ lưu (không có ảnh / dữ liệu cá nhân) */
export const designPayload = (o: VicOptions) =>
  ({ template: o.template, format: o.format, accent: o.accent, kicker: o.kicker, stats: o.stats, photo: o.photo, qr: o.showQr })
