// Giấy chứng nhận hoàn thành giải chạy ảo (migration 004800: BTC tự thiết kế).
// Cùng engine lớp với e-BIB: chọn khổ (dọc chia sẻ MXH / ngang A4 in) + mẫu → bố cục tự động → kéo chỉnh, đổi font, hiệu ứng.
import { distanceLabel, racePace, raceTime } from './race'
import { bibNumber } from './bib'
import {
  artRect, cleanFit, cleanLayers, DEFAULT_FIT, drawCover, drawLayers, imageLayer, isHex, loadImage, qrLayer, shapeLayer, textLayer,
  type ArtFit, type Binds, type ColorKey, type DrawOptions, type FontKey, type ImageLayer, type Layer, type Layout, type Palette, type QrLayer,
} from '@/shared/design/engine'

export type CertFormat = 'portrait' | 'landscape'
export const CERT_FORMATS: Record<CertFormat, { label: string; hint: string; w: number; h: number }> = {
  portrait: { label: 'Dọc 4:5', hint: 'Đẹp khi chia sẻ Facebook / Instagram', w: 1080, h: 1350 },
  landscape: { label: 'Ngang A4', hint: 'In giấy A4, đóng khung', w: 1600, h: 1131 },
}
/** Khổ mặc định (giữ tương thích tên cũ) */
export const CERT_SIZE = CERT_FORMATS.portrait

export type CertTemplate = 'midnight' | 'ivory' | 'bold' | 'minimal'
interface CertTemplateDef { label: string; hint: string; colors: Palette; title: FontKey; name: FontKey; nameSize: number; big: FontKey; upperName: boolean }
export const CERT_TEMPLATES: Record<CertTemplate, CertTemplateDef> = {
  midnight: { label: 'Đêm xanh', hint: 'Nền tối, vệt tốc độ, chữ vàng', title: 'montserrat', name: 'sans', nameSize: 88, big: 'impact', upperName: true,
    colors: { bg: '#0b1018', band: '#b6ff3b', number: '#ffc53d', text: '#f2f5f9', accent: '#8b95a5' } },
  ivory: { label: 'Cổ điển vàng', hint: 'Giấy ngà, viền vàng, chữ ký — trang trọng', title: 'cormorant', name: 'vibes', nameSize: 112, big: 'garamond', upperName: false,
    colors: { bg: '#fbf7ee', band: '#b08d3c', number: '#1e293b', text: '#334155', accent: '#7c2d12' } },
  bold: { label: 'Thể thao', hint: 'Khối màu chéo mạnh, số to', title: 'montserrat', name: 'impact', nameSize: 104, big: 'impact', upperName: true,
    colors: { bg: '#ffffff', band: '#1f4fd8', number: '#1f4fd8', text: '#0f172a', accent: '#ffc21a' } },
  minimal: { label: 'Tối giản', hint: 'Trắng, sạch, một điểm nhấn', title: 'inter', name: 'inter', nameSize: 88, big: 'inter', upperName: false,
    colors: { bg: '#ffffff', band: '#0f172a', number: '#0f172a', text: '#475569', accent: '#e11d48' } },
}
export const CERT_COLOR_LABEL: Record<ColorKey, string> = { bg: 'Nền', band: 'Màu chính', number: 'Tên & số nổi bật', text: 'Chữ', accent: 'Điểm nhấn' }

export const CERT_BINDS: Binds = {
  name: { label: 'Tên VĐV', sample: 'Nguyễn Văn An' },
  race: { label: 'Tên giải', sample: 'Giải chạy ảo mùa thu' },
  org: { label: 'Đơn vị tổ chức', sample: 'Hồ Tây Runners' },
  distance: { label: 'Cự ly', sample: 'Half Marathon' },
  time: { label: 'Thành tích', sample: '1:52:08' },
  pace: { label: 'Pace', sample: '5:19/km' },
  rank: { label: 'Hạng', sample: '12/340' },
  date: { label: 'Ngày hoàn thành', sample: '12 tháng 10, 2026' },
  bib: { label: 'Số BIB', sample: 'BIB 0421' },
}

export interface CertDesign {
  v: 2
  format: CertFormat
  template: CertTemplate
  colors: Partial<Palette>
  bg_url: string | null
  bg_opacity: number
  art_url: string | null
  use_art: boolean
  art_fit: ArtFit
  decor: boolean
  layers: Layer[]
}
export type StoredCert = Partial<Omit<CertDesign, 'layers'>> & { layers?: unknown[] }

export interface CertKeep { logo: ImageLayer | null; signature: ImageLayer | null; qrs: QrLayer[]; extra: Layer[] }
export function keepCertAssets(layers: Layer[]): CertKeep {
  const img = (role: string) => layers.find((l): l is ImageLayer => l.type === 'image' && l.role === role) ?? null
  const logo = img('logo'), signature = img('signature')
  return { logo, signature, qrs: layers.filter((l): l is QrLayer => l.type === 'qr'),
    extra: layers.filter((l) => l.type === 'image' && l !== logo && l !== signature) }
}

/** Bố cục chuẩn: tiêu đề → tên VĐV → cự ly → 3 ô thành tích → ngày, QR xác thực, chữ ký */
export function autoCert(format: CertFormat, template: CertTemplate, keep: CertKeep): Layer[] {
  const t = CERT_TEMPLATES[template]
  const land = format === 'landscape'
  const k = 1
  const Y = land
    ? { logo: 0.09, h1: 0.155, h2: 0.205, race: 0.27, org: 0.305, lead: 0.365, name: 0.43, bib: 0.495, lead2: 0.55, dist: 0.615, stat: 0.755, foot: 0.9 }
    : { logo: 0.08, h1: 0.15, h2: 0.195, race: 0.265, org: 0.3, lead: 0.37, name: 0.435, bib: 0.49, lead2: 0.55, dist: 0.62, stat: 0.745, foot: 0.895 }
  const S = (px: number) => Math.round(px * k)
  const layers: Layer[] = []
  // Mẫu cổ điển: logo nằm giữa vòng nguyệt quế
  if (template === 'ivory') layers.push(shapeLayer({ x: 0.5, y: Y.logo + 0.005, shape: 'laurel', w: land ? 0.1 : 0.16, h: land ? 0.14 : 0.12, fill: 'band', opacity: 0.8 }))
  layers.push(
    { ...(keep.logo ?? imageLayer({ x: 0, y: 0, role: 'logo' })), x: 0.5, y: Y.logo, w: template === 'ivory' ? (land ? 0.06 : 0.09) : land ? 0.1 : 0.14, h: template === 'ivory' ? 0.07 : 0.08, rot: 0 },
    textLayer({ x: 0.5, y: Y.h1, text: 'GIẤY CHỨNG NHẬN', font: t.title, size: S(30), w: 0.8, color: 'accent', spacing: 0.3 }),
    textLayer({ x: 0.5, y: Y.h2, text: template === 'ivory' ? 'Hoàn thành' : 'HOÀN THÀNH', font: t.title, size: S(template === 'ivory' ? 70 : 60), w: 0.8, color: 'band',
      fx: template === 'bold' ? 'slant' : 'none', fx_color: 'accent', italic: template === 'ivory' }),
    textLayer({ x: 0.5, y: Y.race, bind: 'race', font: t.title, size: S(42), w: 0.84, color: 'text', upper: template !== 'ivory' }),
    textLayer({ x: 0.5, y: Y.org, bind: 'org', font: 'sans', size: S(24), w: 0.8, color: 'text', opacity: 0.7 }),
    textLayer({ x: 0.5, y: Y.lead, text: 'Chứng nhận vận động viên', font: template === 'ivory' ? 'garamond' : 'sans', size: S(28), w: 0.8, color: 'text', opacity: 0.75,
      italic: template === 'ivory' }),
    textLayer({ x: 0.5, y: Y.name, bind: 'name', font: t.name, size: S(t.nameSize), w: 0.86, color: 'number', upper: t.upperName,
      fx: template === 'midnight' ? 'glow' : 'none', fx_color: 'number' }),
    textLayer({ x: 0.5, y: Y.bib + (template === 'ivory' ? 0.015 : 0), bind: 'bib', font: 'mono', size: S(28), w: 0.5, color: 'text', opacity: 0.8, spacing: 0.1 }),
    textLayer({ x: 0.5, y: Y.lead2, text: 'đã hoàn thành cự ly', font: template === 'ivory' ? 'garamond' : 'sans', size: S(28), w: 0.8, color: 'text', opacity: 0.75,
      italic: template === 'ivory' }),
    textLayer({ x: 0.5, y: Y.dist, bind: 'distance', font: t.big, size: S(template === 'minimal' ? 90 : 104), w: land ? 0.5 : 0.8, color: 'band', upper: true,
      fx: template === 'bold' ? 'extrude' : 'none', fx_color: 'accent' }),
  )
  // 3 ô thành tích
  const xs = land ? [0.3, 0.5, 0.7] : [0.2, 0.5, 0.8]
  const labels = [['Thành tích', 'time'], ['Pace', 'pace'], ['Hạng', 'rank']] as const
  xs.forEach((x, i) => layers.push(
    shapeLayer({ x, y: Y.stat, shape: 'round', w: land ? 0.18 : 0.27, h: land ? 0.14 : 0.12, fill: template === 'midnight' ? 'text' : 'band',
      opacity: template === 'midnight' ? 0.06 : 0.09 }),
    textLayer({ x, y: Y.stat - (land ? 0.03 : 0.025), text: labels[i][0], font: 'sans', size: S(24), w: 0.24, color: 'text', opacity: 0.7 }),
    textLayer({ x, y: Y.stat + (land ? 0.025 : 0.02), bind: labels[i][1], font: template === 'ivory' ? 'garamond' : 'mono', size: S(50), w: land ? 0.16 : 0.24, color: 'number' }),
  ))
  // Chân: ngày ở giữa, QR xác thực bên trái, chữ ký bên phải
  layers.push(textLayer({ x: 0.5, y: Y.foot, bind: 'date', font: template === 'ivory' ? 'garamond' : 'sans', size: S(26), w: 0.4, color: 'text', opacity: 0.8 }))
  const qr = keep.qrs[0] ?? qrLayer({ x: 0, y: 0, source: 'verify', label: 'Xác thực' })
  layers.push({ ...qr, x: land ? 0.12 : 0.15, y: Y.foot, w: land ? 0.08 : 0.11, rot: 0 })
  const sx = land ? 0.84 : 0.8
  layers.push(
    { ...(keep.signature ?? imageLayer({ x: 0, y: 0, role: 'signature' })), x: sx, y: Y.foot - 0.025, w: land ? 0.16 : 0.24, h: 0.06, rot: 0 },
    shapeLayer({ x: sx, y: Y.foot + 0.012, shape: 'line', w: land ? 0.16 : 0.24, h: 0.002, fill: 'text', opacity: 0.5 }),
    textLayer({ x: sx, y: Y.foot + 0.035, text: 'Ban tổ chức', font: 'sans', size: S(20), w: 0.24, color: 'text', opacity: 0.7 }),
  )
  layers.push(...keep.qrs.slice(1), ...keep.extra)
  return layers
}

export function freshCert(format: CertFormat = 'portrait', template: CertTemplate = 'midnight'): CertDesign {
  return { v: 2, format, template, colors: {}, bg_url: null, bg_opacity: 0.3, art_url: null, use_art: false, art_fit: DEFAULT_FIT, decor: true,
    layers: autoCert(format, template, { logo: null, signature: null, qrs: [], extra: [] }) }
}

const cleanColors = (c: unknown): Partial<Palette> =>
  Object.fromEntries(Object.entries((c && typeof c === 'object' ? c : {}) as Record<string, unknown>)
    .filter(([k, v]) => k in CERT_TEMPLATES.midnight.colors && isHex(v)).map(([k, v]) => [k, (v as string).toLowerCase()]))

export function resolveCert(d: StoredCert | null | undefined): CertDesign & { palette: Palette } {
  let design: CertDesign
  if (!d || d.v !== 2) design = freshCert()
  else {
    const format = d.format && d.format in CERT_FORMATS ? d.format : 'portrait'
    const template = d.template && d.template in CERT_TEMPLATES ? d.template : 'midnight'
    design = {
      v: 2, format, template, colors: cleanColors(d.colors),
      bg_url: d.bg_url ?? null, bg_opacity: typeof d.bg_opacity === 'number' ? Math.min(1, Math.max(0, d.bg_opacity)) : 0.3,
      art_url: d.art_url ?? null, use_art: !!(d.use_art && d.art_url), art_fit: cleanFit(d.art_fit), decor: d.decor !== false,
      layers: cleanLayers(d.layers, CERT_BINDS),
    }
  }
  return { ...design, palette: { ...CERT_TEMPLATES[design.template].colors, ...design.colors } }
}

export function editableCert(d: StoredCert | null | undefined): CertDesign {
  const { palette, ...rest } = resolveCert(d)
  void palette
  return rest
}

export function certPayload(d: CertDesign) {
  const base = CERT_TEMPLATES[d.template].colors
  const colors = Object.fromEntries(Object.entries(d.colors).filter(([k, v]) => v && v.toLowerCase() !== base[k as ColorKey]))
  const layers = d.layers.filter((l) => !(l.type === 'text' && l.bind === 'custom' && !l.text.trim()))
  return { ...d, colors, use_art: d.use_art && !!d.art_url, layers }
}

// ---------------------------------------------------------------------
// Vẽ (trình duyệt)
// ---------------------------------------------------------------------
export interface CertificateData {
  race: string
  organizer: string
  name: string
  bib: string
  distanceKm: number
  timeS: number
  rank: number | null
  finishers: number
  date: string
  /** Link xác thực (trang giải ?bib=…) */
  verifyUrl?: string | null
  raceUrl?: string | null
  clubUrl?: string | null
}

export function certValues(d: CertificateData) {
  return {
    name: d.name, race: d.race, org: d.organizer, distance: distanceLabel(d.distanceKm), time: raceTime(d.timeS),
    pace: d.distanceKm > 0 && d.timeS > 0 ? racePace(d.timeS / d.distanceKm) : '—', rank: d.rank ? `${d.rank}/${d.finishers}` : '—',
    date: d.date, bib: `BIB ${bibNumber(d.bib)}`,
  }
}

function corner(ctx: CanvasRenderingContext2D, x: number, y: number, sx: number, sy: number, s: number) {
  ctx.beginPath()
  ctx.moveTo(x, y + sy * s); ctx.lineTo(x, y); ctx.lineTo(x + sx * s, y)
  ctx.stroke()
  ctx.save(); ctx.translate(x + sx * 18, y + sy * 18); ctx.rotate(Math.PI / 4)
  ctx.fillRect(-7, -7, 14, 14)
  ctx.restore()
}

export function drawCertBackground(ctx: CanvasRenderingContext2D, d: CertDesign, c: Palette, art: HTMLImageElement | null, bg: HTMLImageElement | null) {
  const { w, h } = CERT_FORMATS[d.format]
  ctx.fillStyle = c.bg
  ctx.fillRect(0, 0, w, h)
  if (art) {
    const r = artRect(art.width, art.height, d.art_fit, { w, h })
    ctx.drawImage(art, r.x, r.y, r.w, r.h)
    return
  }
  if (d.decor) {
    switch (d.template) {
      case 'midnight': {
        const g = ctx.createLinearGradient(0, 0, w, h)
        g.addColorStop(0, c.bg); g.addColorStop(1, '#000000')
        ctx.fillStyle = g; ctx.fillRect(0, 0, w, h)
        ctx.save(); ctx.globalAlpha = 0.08; ctx.fillStyle = c.band
        for (let i = 0; i < 8; i++) {
          ctx.beginPath()
          ctx.moveTo(-200 + i * 260, h); ctx.lineTo(80 + i * 260, h); ctx.lineTo(560 + i * 260, 0); ctx.lineTo(280 + i * 260, 0); ctx.fill()
        }
        ctx.restore()
        ctx.strokeStyle = c.band; ctx.globalAlpha = 0.55; ctx.lineWidth = 4; ctx.strokeRect(40, 40, w - 80, h - 80)
        ctx.globalAlpha = 0.18; ctx.lineWidth = 2; ctx.strokeRect(56, 56, w - 112, h - 112)
        ctx.globalAlpha = 1
        break
      }
      case 'ivory': {
        const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) * 0.7)
        g.addColorStop(0, c.bg); g.addColorStop(1, '#efe6d2')
        ctx.fillStyle = g; ctx.fillRect(0, 0, w, h)
        ctx.strokeStyle = c.band; ctx.fillStyle = c.band
        ctx.lineWidth = 6; ctx.strokeRect(36, 36, w - 72, h - 72)
        ctx.lineWidth = 2; ctx.strokeRect(54, 54, w - 108, h - 108)
        ctx.lineWidth = 4
        const s = Math.min(w, h) * 0.08, m = 70
        corner(ctx, m, m, 1, 1, s); corner(ctx, w - m, m, -1, 1, s); corner(ctx, m, h - m, 1, -1, s); corner(ctx, w - m, h - m, -1, -1, s)
        break
      }
      case 'bold':
        ctx.fillStyle = c.band
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(w * 0.42, 0); ctx.lineTo(0, h * 0.3); ctx.closePath(); ctx.fill()
        ctx.beginPath(); ctx.moveTo(w, h); ctx.lineTo(w * 0.8, h); ctx.lineTo(w, h * 0.86); ctx.closePath(); ctx.fill()
        ctx.fillStyle = c.accent
        ctx.beginPath(); ctx.moveTo(w * 0.46, 0); ctx.lineTo(w * 0.5, 0); ctx.lineTo(0, h * 0.36); ctx.lineTo(0, h * 0.33); ctx.closePath(); ctx.fill()
        ctx.beginPath(); ctx.moveTo(w * 0.76, h); ctx.lineTo(w * 0.73, h); ctx.lineTo(w, h * 0.81); ctx.lineTo(w, h * 0.83); ctx.closePath(); ctx.fill()
        break
      case 'minimal':
        ctx.fillStyle = c.accent; ctx.fillRect(0, 0, 18, h)
        ctx.fillStyle = c.band; ctx.globalAlpha = 0.08; ctx.fillRect(w - 18, 0, 18, h); ctx.globalAlpha = 1
        break
    }
  }
  if (bg) { ctx.save(); ctx.globalAlpha = d.bg_opacity; drawCover(ctx, bg, w, h); ctx.restore() }
}

export async function drawCertificate(canvas: HTMLCanvasElement, design: StoredCert | null | undefined, data: CertificateData, opts: DrawOptions = {}): Promise<Layout> {
  const d = resolveCert(design)
  const size = CERT_FORMATS[d.format]
  const [art, bg] = await Promise.all([d.use_art ? loadImage(d.art_url) : null, d.use_art ? null : loadImage(d.bg_url)])
  return drawLayers(canvas, size, (ctx) => drawCertBackground(ctx, d, d.palette, art, bg), d.layers, d.palette,
    { values: certValues(data), qr: { verify: data.verifyUrl, race: data.raceUrl, club: data.clubUrl } }, { binds: CERT_BINDS, ...opts })
}
