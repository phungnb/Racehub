// Lớp in tự do trên áo / quần: hình học (hộp bao vùng → toạ độ khung) + vẽ lên canvas. Dùng chung cho PaperDoll và trình thiết kế.
import { fontFamily, FONTS, type FontKey } from '@/shared/design/engine'
import { NAME_TOKEN, type PrintLayer } from './catalog'

export interface Box { x0: number; y0: number; w: number; h: number }
/** Hình chữ nhật đã xoay của một lớp, toạ độ khung chuẩn */
export interface LayerRect { cx: number; cy: number; w: number; h: number; rot: number }

export const isFontKey = (f: unknown): f is FontKey => typeof f === 'string' && f in FONTS
const fontOf = (l: PrintLayer): FontKey => (isFontKey(l.font) ? l.font : 'athletic')
export const layerFont = (l: PrintLayer, size: number) => {
  const k = fontOf(l)
  const weight = l.bold === false ? 400 : FONTS[k].weight
  return `${weight} ${size}px ${fontFamily(k)}`
}
/** Chữ hiển thị (thay {TEN} bằng tên người mặc; không có tên thì hiện mẫu) */
export const layerText = (l: PrintLayer, personal: string | null) => (l.text ?? '').split(NAME_TOKEN).join(personal || 'TÊN BẠN')

/** Chữ dùng để tính cỡ: lớp có tên runner tính theo tên mẫu 6 ký tự → cỡ chữ ổn định dù tên dài hay ngắn */
const sizingText = (l: PrintLayer, personal: string | null) =>
  (l.text ?? '').includes(NAME_TOKEN) ? (l.text ?? '').split(NAME_TOKEN).join('RUNNER') : layerText(l, personal)

/** Cỡ chữ để chữ rộng đúng `widthPx` */
function fitSize(c: CanvasRenderingContext2D, l: PrintLayer, text: string, widthPx: number) {
  c.font = layerFont(l, 100)
  const spacing = (l.spacing ?? 0) * 100
  const w = c.measureText(text).width + Math.max(0, text.length - 1) * spacing
  return Math.max(4, (100 * widthPx) / Math.max(1, w))
}

/** Hình chữ nhật của lớp (chữ: cao theo cỡ chữ; ảnh: theo tỉ lệ ảnh) */
export function layerRect(c: CanvasRenderingContext2D, l: PrintLayer, box: Box, personal: string | null, img?: HTMLImageElement | null): LayerRect {
  const w = l.w * box.w
  let h: number
  if (l.type === 'image') h = img && img.naturalWidth ? (w * img.naturalHeight) / img.naturalWidth : w
  else {
    // tên thật dài hơn tên mẫu: thu nhỏ cho vừa 1,6 lần bề rộng lớp
    const size = fitSize(c, l, sizingText(l, personal), w)
    const real = fitSize(c, l, layerText(l, personal), w * 1.6)
    h = Math.min(size, real) * 1.05
  }
  return { cx: box.x0 + l.x * box.w, cy: box.y0 + l.y * box.h, w, h, rot: l.rot }
}

/** Vẽ một lớp lên ctx (toạ độ khung chuẩn) */
export function drawLayer(c: CanvasRenderingContext2D, l: PrintLayer, box: Box, personal: string | null, img?: HTMLImageElement | null) {
  const r = layerRect(c, l, box, personal, img)
  c.save()
  c.globalAlpha = Math.max(0.05, Math.min(1, l.opacity ?? 1))
  c.translate(r.cx, r.cy)
  c.rotate((r.rot * Math.PI) / 180)
  if (l.type === 'image') {
    if (img) c.drawImage(img, -r.w / 2, -r.h / 2, r.w, r.h)
  } else {
    const text = layerText(l, personal)
    const size = r.h / 1.05
    c.font = layerFont(l, size)
    c.textAlign = 'center'
    c.textBaseline = 'middle'
    ;(c as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = `${(l.spacing ?? 0) * size}px`
    if ((l.stroke_w ?? 0) > 0) {
      c.lineJoin = 'round'
      c.lineWidth = (l.stroke_w ?? 0) * size
      c.strokeStyle = l.stroke ?? '#000000'
      c.strokeText(text, 0, 0)
    }
    c.fillStyle = l.color ?? '#ffffff'
    c.fillText(text, 0, 0)
  }
  c.restore()
  return r
}

/** Điểm (x, y) có nằm trong lớp đã xoay không */
export function hitLayer(r: LayerRect, x: number, y: number, pad = 0) {
  const a = (-r.rot * Math.PI) / 180
  const dx = x - r.cx, dy = y - r.cy
  const lx = dx * Math.cos(a) - dy * Math.sin(a), ly = dx * Math.sin(a) + dy * Math.cos(a)
  return Math.abs(lx) <= r.w / 2 + pad && Math.abs(ly) <= r.h / 2 + pad
}

/** Góc của hình chữ nhật đã xoay (toạ độ khung) */
export function rectCorners(r: LayerRect): [number, number][] {
  const a = (r.rot * Math.PI) / 180
  const cos = Math.cos(a), sin = Math.sin(a)
  return ([[-1, -1], [1, -1], [1, 1], [-1, 1]] as const).map(([sx, sy]) => {
    const x = (sx * r.w) / 2, y = (sy * r.h) / 2
    return [r.cx + x * cos - y * sin, r.cy + x * sin + y * cos] as [number, number]
  })
}

export const newLayerId = () => Math.random().toString(36).slice(2, 10)

/** Thiết kế kiểu cũ (logo / chữ lớn / dòng phụ / tên runner theo vùng cố định) → lớp tự do để chỉnh tiếp */
export function legacyToLayers(
  print: { logo_url?: string | null; title?: string | null; subtitle?: string | null; personal?: string; text_color?: string; font?: string },
  zones: Record<'logo' | 'title' | 'subtitle' | 'personal', { cx: number; cy: number; w: number; h: number }>,
  box: Box,
): PrintLayer[] {
  const font = print.font === 'sans' ? 'montserrat' : print.font === 'serif' ? 'serif' : 'athletic'
  const at = (z: { cx: number; cy: number }) => ({ x: (z.cx - box.x0) / box.w, y: (z.cy - box.y0) / box.h })
  const textW = (text: string, z: { w: number; h: number }) => Math.min(z.w, text.length * z.h * 0.52) / box.w
  const out: PrintLayer[] = []
  if (print.logo_url) out.push({ id: 'logo', type: 'image', url: print.logo_url, ...at(zones.logo), w: zones.logo.w / box.w, rot: 0, opacity: 1 })
  const text = (id: string, t: string, z: { cx: number; cy: number; w: number; h: number }) =>
    out.push({ id, type: 'text', text: t, font, color: print.text_color ?? '#ffffff', ...at(z), w: textW(t, z), rot: 0, opacity: 1 })
  if (print.title) text('title', print.title.toUpperCase(), zones.title)
  if (print.subtitle) text('subtitle', print.subtitle, zones.subtitle)
  if (print.personal === 'NAME') text('name', NAME_TOKEN, zones.personal)
  return out
}
