'use client'

// Vẽ nhân vật 2D: ảnh thật trong khung chuẩn → đổi màu từng vùng theo mặt nạ (TINT) → xếp các lớp PNG (LAYER).
// Chuẩn tài nguyên: docs/NHAN_VAT.md.
import { useEffect, useRef, useState } from 'react'
import { cn } from '@/shared/lib/cn'
import { fontFamily, type FontKey } from '@/shared/design/engine'
import {
  baseUrl, FRAME, hexToRgb, isTintSlot, jerseyName, layerUrl, LAYER_ORDER, luma, maskUrl, PRINT_ZONES, TINT_SLOTS, tintPixel,
  type CharacterItem, type Gender, type ItemPrint, type PrintZone, type Slot, type TintSlot,
} from '../model/catalog'

interface Region { idx: Uint32Array; alpha: Float32Array; mean: number }
interface Prepared {
  base: ImageData
  regions: Partial<Record<TintSlot, Region>>
  /** Vùng áo: độ phủ mặt nạ + hệ số sáng tối từng điểm (để hình in "ăn" theo nếp vải) */
  topAlpha: Float32Array
  topShade: Float32Array
}

/** Phần nền mở rộng mỗi bên (px trong khung): ảnh 2:3 thành canvas vuông, lấp kín khung hiển thị */
const SIDE = (FRAME.height - FRAME.width) / 2 + 20
/** Nền mở rộng phía trên: chừa chỗ cho mũ khi khung hiển thị cắt bớt trên/dưới */
const TOP = 70

export const loadImage = (src: string) => new Promise<HTMLImageElement>((resolve, reject) => {
  const img = new Image()
  img.decoding = 'async'
  img.crossOrigin = 'anonymous'          // ảnh lớp trên Supabase Storage (khác tên miền)
  img.onload = () => resolve(img)
  img.onerror = () => reject(new Error(`Không tải được ${src}`))
  img.src = src
})

// Ảnh nền + mặt nạ đã giải mã, dùng chung cho mọi nhân vật cùng giới tính
const prepared = new Map<Gender, Promise<Prepared>>()
const layers = new Map<string, Promise<HTMLImageElement>>()

function prepare(gender: Gender): Promise<Prepared> {
  let p = prepared.get(gender)
  if (!p) {
    p = (async () => {
      const { width: W, height: H } = FRAME
      const [base, ...masks] = await Promise.all([loadImage(baseUrl(gender)), ...TINT_SLOTS.map((s) => loadImage(maskUrl(gender, s)))])
      const cv = document.createElement('canvas')
      cv.width = W
      cv.height = H
      const ctx = cv.getContext('2d', { willReadFrequently: true })!
      ctx.drawImage(base, 0, 0, W, H)
      const px = ctx.getImageData(0, 0, W, H)
      const regions: Prepared['regions'] = {}
      TINT_SLOTS.forEach((slot, k) => {
        ctx.clearRect(0, 0, W, H)
        ctx.drawImage(masks[k], 0, 0, W, H)
        const m = ctx.getImageData(0, 0, W, H).data
        const idx: number[] = []
        const alpha: number[] = []
        let sum = 0, n = 0
        for (let i = 0; i < W * H; i++) {
          const a = m[i * 4] / 255
          if (a < 0.02) continue
          idx.push(i)
          alpha.push(a)
          if (a > 0.5) { sum += luma(px.data[i * 4], px.data[i * 4 + 1], px.data[i * 4 + 2]); n++ }
        }
        regions[slot] = { idx: Uint32Array.from(idx), alpha: Float32Array.from(alpha), mean: n ? sum / n : 128 }
      })
      const topAlpha = new Float32Array(W * H)
      const topShade = new Float32Array(W * H)
      const top = regions.top
      if (top) {
        for (let k = 0; k < top.idx.length; k++) {
          const i = top.idx[k]
          topAlpha[i] = top.alpha[k]
          topShade[i] = Math.min(1.35, Math.max(0.55, luma(px.data[i * 4], px.data[i * 4 + 1], px.data[i * 4 + 2]) / Math.max(top.mean, 1)))
        }
      }
      return { base: px, regions, topAlpha, topShade }
    })()
    p.catch(() => prepared.delete(gender))       // lỗi mạng: lần sau thử lại
    prepared.set(gender, p)
  }
  return p
}

function loadLayer(src: string) {
  let p = layers.get(src)
  if (!p) {
    p = loadImage(src)
    p.catch(() => layers.delete(src))
    layers.set(src, p)
  }
  return p
}

function paint(p: Prepared, tints: [TintSlot, string][]): ImageData {
  const out = new ImageData(new Uint8ClampedArray(p.base.data), p.base.width, p.base.height)
  const d = out.data
  for (const [slot, hex] of tints) {
    const region = p.regions[slot]
    const rgb = hexToRgb(hex)
    if (!region || !rgb) continue
    for (let k = 0; k < region.idx.length; k++) {
      const o = region.idx[k] * 4
      const [r, g, b] = tintPixel(d[o], d[o + 1], d[o + 2], region.alpha[k], rgb, region.mean)
      d[o] = r
      d[o + 1] = g
      d[o + 2] = b
    }
  }
  return out
}

const PRINT_FONT: Record<NonNullable<ItemPrint['font']>, FontKey> = { sport: 'athletic', sans: 'montserrat', serif: 'serif' }

/** Chữ vừa khít vùng in: cỡ theo chiều cao vùng, thu nhỏ nếu dài */
function fitText(c: CanvasRenderingContext2D, text: string, z: PrintZone, family: string, color: string) {
  let size = z.h * 0.92
  c.font = `800 ${size}px ${family}`
  const w = c.measureText(text).width
  if (w > z.w) { size = Math.max(6, size * (z.w / w)); c.font = `800 ${size}px ${family}` }
  c.fillStyle = color
  c.textAlign = 'center'
  c.textBaseline = 'middle'
  c.fillText(text, z.cx, z.cy)
}

/** Vẽ hình in (logo, chữ, tên runner) lên áo: chỉ trong vùng áo, sáng tối theo nếp vải */
async function paintPrint(p: Prepared, gender: Gender, print: ItemPrint, personal: string | null, useShade: boolean): Promise<HTMLCanvasElement> {
  const { width: W, height: H } = FRAME
  const zones = PRINT_ZONES[gender]
  const off = document.createElement('canvas')
  off.width = W
  off.height = H
  const c = off.getContext('2d', { willReadFrequently: true })!
  // Bộ font thiết kế chỉ nạp khi áo có chữ in (không kéo vào mọi trang có nhân vật)
  await import('@/shared/design/fonts')
  const family = fontFamily(PRINT_FONT[print.font ?? 'sport'])
  await document.fonts?.load(`800 32px ${family}`).catch(() => undefined)
  const color = print.text_color ?? '#ffffff'
  if (print.logo_url) {
    const img = await loadLayer(print.logo_url).catch(() => null)
    if (img) {
      const z = zones.logo
      const k = Math.min(z.w / img.naturalWidth, z.h / img.naturalHeight)
      c.drawImage(img, z.cx - (img.naturalWidth * k) / 2, z.cy - (img.naturalHeight * k) / 2, img.naturalWidth * k, img.naturalHeight * k)
    }
  }
  if (print.title) fitText(c, print.title.toUpperCase(), zones.title, family, color)
  if (print.subtitle) fitText(c, print.subtitle, zones.subtitle, family, color)
  if (print.personal === 'NAME' && personal) fitText(c, personal, zones.personal, family, color)
  // Cắt theo mặt nạ áo + nhân hệ số sáng tối (bỏ qua với áo lớp ảnh vì mặt nạ không khớp)
  if (useShade) {
    const xs = Object.values(zones)
    const x0 = Math.max(0, Math.floor(Math.min(...xs.map((z) => z.cx - z.w / 2)))), x1 = Math.min(W, Math.ceil(Math.max(...xs.map((z) => z.cx + z.w / 2))))
    const y0 = Math.max(0, Math.floor(Math.min(...xs.map((z) => z.cy - z.h / 2)))), y1 = Math.min(H, Math.ceil(Math.max(...xs.map((z) => z.cy + z.h / 2))))
    const img = c.getImageData(x0, y0, x1 - x0, y1 - y0)
    const d = img.data
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const o = ((y - y0) * (x1 - x0) + (x - x0)) * 4
        if (!d[o + 3]) continue
        const i = y * W + x
        const a = p.topAlpha[i]
        if (a <= 0) { d[o + 3] = 0; continue }
        const f = Math.pow(p.topShade[i], 0.85)
        d[o] = Math.min(255, d[o] * f); d[o + 1] = Math.min(255, d[o + 1] * f); d[o + 2] = Math.min(255, d[o + 2] * f)
        d[o + 3] = d[o + 3] * a * 0.94                    // mực in hơi trong: thấy nhẹ vân vải
      }
    }
    c.putImageData(img, x0, y0)
  }
  return off
}

interface DrawSpec { tints: [TintSlot, string][]; layers: { slot: Slot; url: string }[]; print: ItemPrint | null; printShade: boolean; personal: string | null }

function specOf(gender: Gender, items: CharacterItem[], personalName?: string | null): DrawSpec {
  const top = items.find((i) => i.slot === 'top')
  return {
    tints: items.filter((i) => i.render_kind === 'TINT' && i.color && isTintSlot(i.slot)).map((i) => [i.slot, i.color!] as [TintSlot, string]),
    layers: items.map((i) => ({ slot: i.slot, url: layerUrl(i, gender) })).filter((x): x is { slot: Slot; url: string } => !!x.url),
    print: top?.print ?? null,
    printShade: top?.render_kind !== 'LAYER',
    personal: top?.print?.personal === 'NAME' ? jerseyName(personalName) || null : null,
  }
}

/** Vẽ nhân vật hoàn chỉnh vào ctx tại (ox, oy): nền đã đổi màu → lớp dưới áo → áo + hình in → lớp trên */
async function compose(ctx: CanvasRenderingContext2D, gender: Gender, spec: DrawSpec, ox: number, oy: number, isCancelled?: () => boolean) {
  const { width: W, height: H } = FRAME
  const [p, imgs] = await Promise.all([prepare(gender), Promise.all(spec.layers.map((l) => loadLayer(l.url)))])
  const printCanvas = spec.print ? await paintPrint(p, gender, spec.print, spec.personal, spec.printShade) : null
  if (isCancelled?.()) return false
  ctx.putImageData(paint(p, spec.tints), ox, oy)
  const topAt = LAYER_ORDER.indexOf('top')
  const under = spec.layers.map((l, k) => ({ ...l, img: imgs[k] })).filter((l) => LAYER_ORDER.indexOf(l.slot) <= topAt)
  const over = spec.layers.map((l, k) => ({ ...l, img: imgs[k] })).filter((l) => LAYER_ORDER.indexOf(l.slot) > topAt)
  for (const l of under) ctx.drawImage(l.img, ox, oy, W, H)
  if (printCanvas) ctx.drawImage(printCanvas, ox, oy, W, H)
  for (const l of over) ctx.drawImage(l.img, ox, oy, W, H)
  return true
}

/** Vùng chân dung (đầu + vai) trong khung chuẩn, để làm ảnh đại diện */
const PORTRAIT: Record<Gender, { cx: number; cy: number; side: number }> = {
  male: { cx: 474, cy: 175, side: 330 },
  female: { cx: 450, cy: 215, side: 330 },
}

/** Nhân vật đầy đủ (khung chuẩn 900×1350) mặc bộ đồ `items` — dùng cho ảnh chia sẻ, ảnh đại diện */
export async function renderCharacter(gender: Gender, items: CharacterItem[], personalName?: string | null): Promise<HTMLCanvasElement> {
  const full = document.createElement('canvas')
  full.width = FRAME.width
  full.height = FRAME.height
  await compose(full.getContext('2d')!, gender, specOf(gender, items, personalName), 0, 0)
  return full
}

/** Ảnh chân dung vuông của nhân vật đang mặc bộ đồ (JPEG), dùng làm ảnh đại diện */
export async function renderPortrait(gender: Gender, items: CharacterItem[], size = 512, personalName?: string | null): Promise<Blob> {
  const full = await renderCharacter(gender, items, personalName)
  const { cx, cy, side } = PORTRAIT[gender]
  const out = document.createElement('canvas')
  out.width = size
  out.height = size
  out.getContext('2d')!.drawImage(full, cx - side / 2, cy - side / 2, side, side, 0, 0, size, size)
  return new Promise((resolve, reject) => out.toBlob((b) => (b ? resolve(b) : reject(new Error('Không tạo được ảnh'))), 'image/jpeg', 0.9))
}

/** Nhân vật mặc bộ đồ `items` (đã theo thứ tự lớp, xem resolveOutfit) */
export function PaperDoll({ gender, items, className, label = 'Nhân vật', fit = 'cover', personalName }: {
  gender: Gender; items: CharacterItem[]; className?: string; label?: string
  /** cover: lấp kín khung (có thể cắt chút đầu/chân); contain: thấy trọn khung ảnh, dùng khi cần soát món đồ */
  fit?: 'cover' | 'contain'
  /** Tên người mặc — in lên đồng phục có ô "tên runner" */
  personalName?: string | null
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  // Chỉ vẽ lại khi màu, lớp hoặc hình in thực sự đổi
  const spec = JSON.stringify(specOf(gender, items, personalName))

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const cv = ref.current
        if (!cv) return
        const { width: W, height: H } = FRAME
        const tmp = document.createElement('canvas')
        tmp.width = W + 2 * SIDE
        tmp.height = H + TOP
        const ctx = tmp.getContext('2d')!
        if (!(await compose(ctx, gender, JSON.parse(spec) as DrawSpec, SIDE, TOP, () => cancelled)) || cancelled) return
        // Nền mở rộng: kéo dãn hàng/cột mép ảnh (nền xám trơn) để khung nào cũng liền màu
        ctx.drawImage(tmp, SIDE, TOP, W, 1, SIDE, 0, W, TOP)
        ctx.drawImage(tmp, SIDE, 0, 1, H + TOP, 0, 0, SIDE, H + TOP)
        ctx.drawImage(tmp, SIDE + W - 1, 0, 1, H + TOP, SIDE + W, 0, SIDE, H + TOP)
        cv.width = tmp.width
        cv.height = tmp.height
        cv.getContext('2d')!.drawImage(tmp, 0, 0)
        setStatus('ready')
      } catch (e) {
        console.warn('[Nhân vật] Không vẽ được:', e)
        if (!cancelled) setStatus('error')
      }
    })()
    return () => { cancelled = true }
  }, [gender, spec])

  return (
    <div className={cn('relative', className)}>
      <canvas ref={ref} role="img" aria-label={label} className={cn('size-full', fit === 'cover' ? 'object-cover' : 'object-contain', status !== 'ready' && 'invisible')} />
      {status === 'loading' && <div className="absolute inset-0 animate-pulse bg-surface-2" aria-hidden />}
      {status === 'error' && (
        // eslint-disable-next-line @next/next/no-img-element -- ảnh tĩnh trong /public, dự phòng khi canvas lỗi
        <img src={baseUrl(gender)} alt={label} className="absolute inset-0 size-full object-contain" />
      )}
    </div>
  )
}
