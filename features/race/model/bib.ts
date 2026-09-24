// BIB điện tử do ban tổ chức thiết kế (migration 002900). Phần kiểu dữ liệu + mặc định là hàm thuần;
// drawBib vẽ lên canvas ở trình duyệt (khổ 1400×1000 ≈ BIB giấy A5 ngang).
import QRCode from 'qrcode'
import { distanceLabel } from './race'

export type BibTemplate = 'classic' | 'stripe' | 'neon' | 'minimal'
export interface BibColors { bg: string; band: string; number: string; text: string; accent: string }
export interface BibSponsor { name: string; logo_url: string | null }
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
}

export const BIB_SIZE = { w: 1400, h: 1000 }

export const TEMPLATES: Record<BibTemplate, { label: string; hint: string; colors: BibColors }> = {
  classic: { label: 'Cổ điển', hint: 'Dải tên giải phía trên, số lớn ở giữa', colors: { bg: '#ffffff', band: '#1f4fd8', number: '#0a0d12', text: '#0a0d12', accent: '#ffc21a' } },
  stripe: { label: 'Sọc chéo', hint: 'Dải màu chéo phía sau số, năng động', colors: { bg: '#ffffff', band: '#ffc21a', number: '#1f4fd8', text: '#0a0d12', accent: '#ff8a1f' } },
  neon: { label: 'Neon đêm', hint: 'Nền tối, số phát sáng — hợp giải chạy đêm', colors: { bg: '#0a0d12', band: '#b6ff3b', number: '#b6ff3b', text: '#f2f5f9', accent: '#38bdf8' } },
  minimal: { label: 'Tối giản', hint: 'Một màu nền, chữ sạch', colors: { bg: '#f4f6f8', band: '#0a0d12', number: '#0a0d12', text: '#5b6472', accent: '#e11d48' } },
}

export const DEFAULT_BIB: BibDesign = {
  template: 'classic', colors: {}, logo_url: null, bg_url: null, bg_opacity: 0.35, tagline: null, sponsors: [], show_name: true, show_qr: true,
}

/** Thiết kế đã lưu (có thể null / thiếu trường) → đủ trường, màu = màu mẫu + màu BTC chọn */
export function resolveBib(d: Partial<BibDesign> | null | undefined): BibDesign & { palette: BibColors } {
  const template = d?.template && d.template in TEMPLATES ? d.template : 'classic'
  const design: BibDesign = { ...DEFAULT_BIB, ...(d ?? {}), template, colors: { ...(d?.colors ?? {}) }, sponsors: (d?.sponsors ?? []).slice(0, 4) }
  return { ...design, palette: { ...TEMPLATES[template].colors, ...design.colors } }
}

/** Dữ liệu gửi RPC set_race_bib_design (chỉ màu khác mẫu mới lưu) */
export function bibPayload(d: BibDesign) {
  const base = TEMPLATES[d.template].colors
  const colors = Object.fromEntries(Object.entries(d.colors).filter(([k, v]) => v && v.toLowerCase() !== base[k as keyof BibColors]))
  return { ...d, colors, tagline: d.tagline?.trim() || null, sponsors: d.sponsors.filter((s) => s.name.trim() || s.logo_url).map((s) => ({ ...s, name: s.name.trim() })) }
}

export interface BibData {
  race: string
  bib: string
  name: string | null
  distanceKm: number
  dates: string
  qrUrl: string | null
}

// ---------------------------------------------------------------------
// Vẽ (trình duyệt)
// ---------------------------------------------------------------------
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

function fonts() {
  const root = getComputedStyle(document.documentElement)
  return {
    sans: root.getPropertyValue('--font-be-vietnam').trim() || 'system-ui, sans-serif',
    mono: root.getPropertyValue('--font-jetbrains').trim() || 'ui-monospace, monospace',
  }
}

function fitFont(ctx: CanvasRenderingContext2D, text: string, font: (px: number) => string, start: number, maxW: number) {
  let px = start
  ctx.font = font(px)
  while (ctx.measureText(text).width > maxW && px > 16) { px -= 4; ctx.font = font(px) }
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

export async function drawBib(canvas: HTMLCanvasElement, design: Partial<BibDesign> | null | undefined, data: BibData) {
  const d = resolveBib(design)
  const c = d.palette
  const { w, h } = BIB_SIZE
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  const { sans, mono } = fonts()
  const [logo, bg, qr, ...sponsorLogos] = await Promise.all([
    loadImage(d.logo_url), loadImage(d.bg_url),
    d.show_qr && data.qrUrl ? QRCode.toDataURL(data.qrUrl, { margin: 1, width: 360, errorCorrectionLevel: 'M' }).then(loadImage) : Promise.resolve(null),
    ...d.sponsors.map((s) => loadImage(s.logo_url)),
  ])

  // Nền + ảnh nền mờ
  ctx.fillStyle = c.bg
  ctx.fillRect(0, 0, w, h)
  if (bg) { ctx.save(); ctx.globalAlpha = d.bg_opacity; drawCover(ctx, bg, w, h); ctx.restore() }

  const sponsorH = d.sponsors.length ? 150 : 0
  const headerH = d.template === 'classic' ? 210 : 170
  const qrSize = qr ? 230 : 0

  // Trang trí theo mẫu
  if (d.template === 'classic') {
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
  } else {
    ctx.fillStyle = c.band
    ctx.fillRect(60, headerH - 10, w - 120, 4)
  }

  // Đầu BIB: logo + tên giải + khẩu hiệu; cự ly bên phải
  const headColor = d.template === 'classic' ? onColor(c.band) : c.text
  let tx = 70
  if (logo) { drawContain(ctx, logo, 60, 30, 150, headerH - 60); tx = 240 }
  const distText = distanceLabel(data.distanceKm).toUpperCase()
  ctx.font = `800 40px ${sans}`
  const chipW = ctx.measureText(distText).width + 60
  ctx.fillStyle = d.template === 'classic' ? c.accent : c.band
  ctx.beginPath(); ctx.roundRect(w - 60 - chipW, headerH / 2 - 38, chipW, 76, 38); ctx.fill()
  ctx.fillStyle = onColor(d.template === 'classic' ? c.accent : c.band)
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  ctx.fillText(distText, w - 60 - chipW / 2, headerH / 2 + 2)
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = headColor
  const titleMax = w - tx - chipW - 110
  fitFont(ctx, data.race.toUpperCase(), (px) => `900 ${px}px ${sans}`, 62, titleMax)
  ctx.fillText(data.race.toUpperCase(), tx, d.tagline ? headerH / 2 - 4 : headerH / 2 + 20)
  if (d.tagline) {
    ctx.globalAlpha = 0.8
    fitFont(ctx, d.tagline, (px) => `600 ${px}px ${sans}`, 34, titleMax)
    ctx.fillText(d.tagline, tx, headerH / 2 + 42)
    ctx.globalAlpha = 1
  }

  // Số BIB
  const bodyTop = headerH + 30, bodyBottom = h - sponsorH - (d.show_name && data.name ? 120 : 40)
  const numMaxW = w - 140 - (qrSize ? qrSize + 60 : 0)
  const numX = 70 + numMaxW / 2
  const px = fitFont(ctx, data.bib, (p) => `900 ${p}px ${mono}`, 330, numMaxW)
  const numY = bodyTop + (bodyBottom - bodyTop) / 2 + px * 0.35
  ctx.textAlign = 'center'
  ctx.fillStyle = c.number
  if (d.template === 'neon') { ctx.shadowColor = c.number; ctx.shadowBlur = 40 }
  ctx.fillText(data.bib, numX, numY)
  ctx.shadowBlur = 0
  if (d.show_name && data.name) {
    ctx.fillStyle = c.text
    fitFont(ctx, data.name.toUpperCase(), (p) => `800 ${p}px ${sans}`, 64, numMaxW)
    ctx.fillText(data.name.toUpperCase(), numX, numY + 100)
  }

  // Mã QR xác thực (nền trắng để máy quét đọc được)
  if (qr) {
    const qx = w - 60 - qrSize, qy = bodyTop + (bodyBottom - bodyTop) / 2 - qrSize / 2 + 20
    ctx.fillStyle = '#ffffff'
    ctx.beginPath(); ctx.roundRect(qx - 12, qy - 12, qrSize + 24, qrSize + 24, 18); ctx.fill()
    ctx.drawImage(qr, qx, qy, qrSize, qrSize)
    ctx.fillStyle = c.text
    ctx.font = `600 22px ${sans}`
    ctx.fillText('Quét để xác thực', qx + qrSize / 2, qy + qrSize + 48)
  }

  // Dải nhà tài trợ
  if (sponsorH) {
    const y0 = h - sponsorH
    ctx.fillStyle = d.template === 'neon' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)'
    ctx.fillRect(0, y0, w, sponsorH)
    const slot = (w - 120) / d.sponsors.length
    d.sponsors.forEach((s, i) => {
      const x = 60 + i * slot
      const im = sponsorLogos[i]
      if (im) drawContain(ctx, im, x + 20, y0 + 22, slot - 40, sponsorH - 44)
      else {
        ctx.fillStyle = c.text
        fitFont(ctx, s.name, (p) => `800 ${p}px ${sans}`, 40, slot - 40)
        ctx.fillText(s.name, x + slot / 2, y0 + sponsorH / 2 + 14)
      }
    })
  }

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
}
