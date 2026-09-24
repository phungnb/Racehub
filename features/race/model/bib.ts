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
  /** Ảnh BIB có sẵn (Canva / Photoshop…) — chỉ dùng làm khung khi use_art */
  art_url: string | null
  use_art: boolean
  art_fit: ArtFit
  show_header: boolean
  show_sponsors: boolean
  text: BibText
  qr_pos: QrPos
}
export interface ArtFit { zoom: number; x: number; y: number }
export type TextLayout = 'below' | 'above' | 'inline'
export type TextAlign = 'left' | 'center' | 'right'
export type BibFont = 'mono' | 'sans' | 'italic' | 'outline'
export type QrPos = 'right' | 'left' | 'corner'
export interface BibText { layout: TextLayout; align: TextAlign; font: BibFont; y: number; scale: number; name_scale: number }

export const BIB_SIZE = { w: 1400, h: 1000 }

export const TEMPLATES: Record<BibTemplate, { label: string; hint: string; colors: BibColors }> = {
  classic: { label: 'Cổ điển', hint: 'Dải tên giải phía trên, số lớn ở giữa', colors: { bg: '#ffffff', band: '#1f4fd8', number: '#0a0d12', text: '#0a0d12', accent: '#ffc21a' } },
  stripe: { label: 'Sọc chéo', hint: 'Dải màu chéo phía sau số, năng động', colors: { bg: '#ffffff', band: '#ffc21a', number: '#1f4fd8', text: '#0a0d12', accent: '#ff8a1f' } },
  neon: { label: 'Neon đêm', hint: 'Nền tối, số phát sáng — hợp giải chạy đêm', colors: { bg: '#0a0d12', band: '#b6ff3b', number: '#b6ff3b', text: '#f2f5f9', accent: '#38bdf8' } },
  minimal: { label: 'Tối giản', hint: 'Một màu nền, chữ sạch', colors: { bg: '#f4f6f8', band: '#0a0d12', number: '#0a0d12', text: '#5b6472', accent: '#e11d48' } },
}

export const LAYOUTS: Record<TextLayout, string> = { below: 'Tên dưới số', above: 'Tên trên số', inline: 'Cùng hàng' }
export const ALIGNS: Record<TextAlign, string> = { left: 'Trái', center: 'Giữa', right: 'Phải' }
export const FONTS: Record<BibFont, string> = { mono: 'Số đều', sans: 'Đậm', italic: 'Nghiêng thể thao', outline: 'Viền rỗng' }
export const QR_POS: Record<QrPos, string> = { right: 'Bên phải', left: 'Bên trái', corner: 'Góc dưới' }

export const DEFAULT_TEXT: BibText = { layout: 'below', align: 'center', font: 'mono', y: 0.5, scale: 1, name_scale: 1 }
export const DEFAULT_FIT: ArtFit = { zoom: 1, x: 0, y: 0 }

export const DEFAULT_BIB: BibDesign = {
  template: 'classic', colors: {}, logo_url: null, bg_url: null, bg_opacity: 0.35, tagline: null, sponsors: [], show_name: true, show_qr: true,
  art_url: null, use_art: false, art_fit: DEFAULT_FIT, show_header: true, show_sponsors: true, text: DEFAULT_TEXT, qr_pos: 'right',
}

const clamp = (v: unknown, lo: number, hi: number, def: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : def)
const pick = <T extends string>(v: unknown, all: Record<T, string>, def: T): T => (typeof v === 'string' && v in all ? (v as T) : def)

/** Thiết kế đã lưu (có thể null / thiếu trường) → đủ trường, màu = màu mẫu + màu BTC chọn */
export function resolveBib(d: Partial<BibDesign> | null | undefined): BibDesign & { palette: BibColors } {
  const template = d?.template && d.template in TEMPLATES ? d.template : 'classic'
  const t: Partial<BibText> = d?.text ?? {}
  const f: Partial<ArtFit> = d?.art_fit ?? {}
  const design: BibDesign = {
    ...DEFAULT_BIB, ...(d ?? {}), template, colors: { ...(d?.colors ?? {}) }, sponsors: (d?.sponsors ?? []).slice(0, 4),
    art_url: d?.art_url ?? null, use_art: !!(d?.use_art && d?.art_url),
    art_fit: { zoom: clamp(f.zoom, 0.5, 3, 1), x: clamp(f.x, -1, 1, 0), y: clamp(f.y, -1, 1, 0) },
    text: {
      layout: pick(t.layout, LAYOUTS, 'below'), align: pick(t.align, ALIGNS, 'center'), font: pick(t.font, FONTS, 'mono'),
      y: clamp(t.y, 0.15, 0.85, 0.5), scale: clamp(t.scale, 0.5, 1.5, 1), name_scale: clamp(t.name_scale, 0.5, 1.5, 1),
    },
    qr_pos: pick(d?.qr_pos, QR_POS, 'right'),
  }
  return { ...design, palette: { ...TEMPLATES[template].colors, ...design.colors } }
}

/** Bản nháp cho trình thiết kế (bỏ bảng màu tính sẵn) */
export function editableBib(d: Partial<BibDesign> | null | undefined): BibDesign {
  const { palette, ...rest } = resolveBib(d)
  void palette
  return rest
}

/** Dữ liệu gửi RPC set_race_bib_design (chỉ màu khác mẫu mới lưu) */
export function bibPayload(d: BibDesign) {
  const base = TEMPLATES[d.template].colors
  const colors = Object.fromEntries(Object.entries(d.colors).filter(([k, v]) => v && v.toLowerCase() !== base[k as keyof BibColors]))
  return { ...d, colors, tagline: d.tagline?.trim() || null, use_art: d.use_art && !!d.art_url,
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

/** Tên chia 2 dòng cho bố cục cùng hàng: họ + tên đệm / tên */
export function splitName(name: string): string[] {
  const words = name.trim().split(/\s+/).filter(Boolean)
  return words.length < 2 ? words : [words.slice(0, -1).join(' '), words[words.length - 1]]
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
  const t = d.text
  const { w, h } = BIB_SIZE
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  const { sans, mono } = fonts()
  const sponsors = d.show_sponsors ? d.sponsors : []
  const [logo, bg, artIm, qr, ...sponsorLogos] = await Promise.all([
    d.show_header ? loadImage(d.logo_url) : Promise.resolve(null),
    d.use_art ? Promise.resolve(null) : loadImage(d.bg_url),
    d.use_art ? loadImage(d.art_url) : Promise.resolve(null),
    d.show_qr && data.qrUrl ? QRCode.toDataURL(data.qrUrl, { margin: 1, width: 360, errorCorrectionLevel: 'M' }).then(loadImage) : Promise.resolve(null),
    ...sponsors.map((s) => loadImage(s.logo_url)),
  ])
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

  // Vùng số BIB + tên (trừ cột QR nếu QR đặt bên trái / phải)
  const top = headerH ? headerH + 40 : 60
  const bottom = h - sponsorH - footH - (sponsorH ? 24 : 50)
  const qrSize = qr ? (d.qr_pos === 'corner' ? 180 : 230) : 0
  const qrCol = qr && d.qr_pos !== 'corner' ? qrSize + 70 : 0
  const x0 = 70 + (d.qr_pos === 'left' ? qrCol : 0)
  const x1 = w - 70 - (d.qr_pos === 'right' ? qrCol : 0)
  const maxW = x1 - x0
  const cy = top + (bottom - top) * t.y
  drawNumberAndName(ctx, d, { bib: data.bib, name: d.show_name && data.name ? data.name.toUpperCase() : null }, { x0, x1, top, bottom, cy, maxW, sans, mono })

  // Mã QR xác thực (nền trắng + chú thích trong khung → quét được trên mọi nền)
  if (qr) {
    const qx = d.qr_pos === 'left' ? 60 : d.qr_pos === 'right' ? w - 60 - qrSize : w - 50 - qrSize
    const qy = d.qr_pos === 'corner' ? bottom - qrSize - 30 : Math.max(top, Math.min(bottom - qrSize - 40, cy - qrSize / 2 - 16))
    ctx.fillStyle = '#ffffff'
    ctx.beginPath(); ctx.roundRect(qx - 12, qy - 12, qrSize + 24, qrSize + 56, 18); ctx.fill()
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

  if (framed) return                                   // ảnh có sẵn đã có chân / lỗ ghim riêng

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

interface TextBox { x0: number; x1: number; top: number; bottom: number; cy: number; maxW: number; sans: string; mono: string }

/** Số BIB + tên theo bố cục: tên dưới / trên số, hoặc cùng hàng (tên 2 dòng bên cạnh số); căn trái / giữa / phải */
function drawNumberAndName(ctx: CanvasRenderingContext2D, d: BibDesign & { palette: BibColors }, v: { bib: string; name: string | null }, b: TextBox) {
  const t = d.text
  const c = d.palette
  const numFont = (px: number) => (t.font === 'mono' ? `900 ${px}px ${b.mono}` : `${t.font === 'italic' ? 'italic ' : ''}900 ${px}px ${b.sans}`)
  const nameFont = (px: number) => `${t.font === 'italic' ? 'italic ' : ''}800 ${px}px ${b.sans}`
  const avail = b.bottom - b.top
  const CAP = 0.74                                     // chiều cao chữ hoa ≈ 0.74 × cỡ chữ

  const paintNumber = (x: number, y: number, align: CanvasTextAlign, px: number) => {
    ctx.font = numFont(px)
    ctx.textAlign = align
    if (t.font === 'outline') {
      ctx.lineJoin = 'round'
      ctx.lineWidth = Math.max(4, px / 16)
      ctx.strokeStyle = c.number
      ctx.strokeText(v.bib, x, y)
      return
    }
    ctx.fillStyle = c.number
    if (d.template === 'neon' && !d.use_art) { ctx.shadowColor = c.number; ctx.shadowBlur = 40 }
    ctx.fillText(v.bib, x, y)
    ctx.shadowBlur = 0
  }
  const paintName = (line: string, x: number, y: number, align: CanvasTextAlign, px: number) => {
    ctx.font = nameFont(px)
    ctx.textAlign = align
    ctx.fillStyle = c.text
    ctx.fillText(line, x, y)
  }

  if (t.layout === 'inline') {
    const lines = v.name ? splitName(v.name) : []
    const gap = 44
    let numPx = fitFont(ctx, v.bib, numFont, Math.round(300 * t.scale), lines.length ? b.maxW * 0.62 : b.maxW)
    numPx = Math.min(numPx, Math.floor(avail / CAP))
    ctx.font = numFont(numPx)
    const numW = ctx.measureText(v.bib).width
    const nameAvail = Math.max(120, b.maxW - numW - gap)
    const namePx = lines.length ? Math.min(...lines.map((l) => fitFont(ctx, l, nameFont, Math.round(62 * t.name_scale), nameAvail)), Math.floor(numPx * 0.6)) : 0
    ctx.font = nameFont(namePx)
    const nameW = lines.length ? Math.max(...lines.map((l) => ctx.measureText(l).width)) : 0
    const groupW = numW + (lines.length ? gap + nameW : 0)
    const gx = t.align === 'left' ? b.x0 : t.align === 'right' ? b.x1 - groupW : (b.x0 + b.x1) / 2 - groupW / 2
    const cy = Math.max(b.top + (numPx * CAP) / 2, Math.min(b.bottom - (numPx * CAP) / 2, b.cy))
    const nameFirst = t.align === 'right'               // căn phải: tên bên trái số
    const numX = nameFirst ? gx + groupW - numW : gx
    paintNumber(numX, cy + (numPx * CAP) / 2, 'left', numPx)
    const lh = namePx * 1.12
    lines.forEach((l, i) => {
      const y = cy + (namePx * CAP) / 2 + (i - (lines.length - 1) / 2) * lh
      if (nameFirst) paintName(l, gx + nameW, y, 'right', namePx)
      else paintName(l, gx + numW + gap, y, 'left', namePx)
    })
    return
  }

  // Xếp chồng: tên dưới hoặc trên số
  const gap = 34
  const namePx = v.name ? fitFont(ctx, v.name, nameFont, Math.round(64 * t.name_scale), b.maxW) : 0
  const nameBlock = v.name ? gap + namePx * CAP : 0
  let numPx = fitFont(ctx, v.bib, numFont, Math.round(330 * t.scale), b.maxW)
  numPx = Math.min(numPx, Math.floor((avail - nameBlock) / CAP))
  const blockH = numPx * CAP + nameBlock
  const blockTop = Math.max(b.top, Math.min(b.bottom - blockH, b.cy - blockH / 2))
  const x = t.align === 'left' ? b.x0 : t.align === 'right' ? b.x1 : (b.x0 + b.x1) / 2
  if (t.layout === 'above' && v.name) {
    paintName(v.name, x, blockTop + namePx * CAP, t.align, namePx)
    paintNumber(x, blockTop + nameBlock + numPx * CAP, t.align, numPx)
  } else {
    paintNumber(x, blockTop + numPx * CAP, t.align, numPx)
    if (v.name) paintName(v.name, x, blockTop + numPx * CAP + gap + namePx * CAP, t.align, namePx)
  }
}
