'use client'

// Vẽ nhân vật 2D: ảnh thật trong khung chuẩn → đổi màu từng vùng theo mặt nạ (TINT) → xếp các lớp PNG (LAYER).
// Chuẩn tài nguyên: docs/NHAN_VAT.md.
import { useEffect, useRef, useState } from 'react'
import { cn } from '@/shared/lib/cn'
import { fontFamily, type FontKey } from '@/shared/design/engine'
import {
  baseUrl, FRAME, genderOf, hexToRgb, isTintSlot, jerseyName, layerUrl, LAYER_ORDER, luma, maskUrl, PRINT_ZONES, TINT_SLOTS, tintPixel,
  type Body, type CharacterItem, type ItemPattern, type ItemPrint, type PrintZone, type Slot, type TintSlot,
} from '../model/catalog'
import { shade as shadeHex } from '../model/kit'
import { drawPattern } from '../model/patterns'
import { drawLayer, layerFont, type Box } from '../model/printLayers'

interface Region { idx: Uint32Array; alpha: Float32Array; mean: number; box: Box }
interface Prepared {
  base: ImageData
  regions: Partial<Record<TintSlot, Region>>
}
type Tone = NonNullable<ItemPrint['tone']>
type Texture = NonNullable<ItemPrint['texture']>

/** Phần nền mở rộng mỗi bên (px trong khung): ảnh 2:3 thành canvas vuông, lấp kín khung hiển thị */
export const SIDE = (FRAME.height - FRAME.width) / 2 + 20
/** Nền mở rộng phía trên: chừa chỗ cho mũ khi khung hiển thị cắt bớt trên/dưới */
export const TOP = 70

export const loadImage = (src: string) => new Promise<HTMLImageElement>((resolve, reject) => {
  const img = new Image()
  img.decoding = 'async'
  img.crossOrigin = 'anonymous'          // ảnh lớp trên Supabase Storage (khác tên miền)
  img.onload = () => resolve(img)
  img.onerror = () => reject(new Error(`Không tải được ${src}`))
  img.src = src
})

// Ảnh nền + mặt nạ đã giải mã, dùng chung cho mọi nhân vật cùng dáng
const prepared = new Map<Body, Promise<Prepared>>()
const layers = new Map<string, Promise<HTMLImageElement>>()

function prepare(body: Body): Promise<Prepared> {
  let p = prepared.get(body)
  if (!p) {
    p = (async () => {
      const { width: W, height: H } = FRAME
      const [base, ...masks] = await Promise.all([loadImage(baseUrl(body)), ...TINT_SLOTS.map((s) => loadImage(maskUrl(body, s)))])
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
        let sum = 0, n = 0, x0: number = W, y0: number = H, x1 = 0, y1 = 0
        for (let i = 0; i < W * H; i++) {
          const a = m[i * 4] / 255
          if (a < 0.02) continue
          idx.push(i)
          alpha.push(a)
          if (a > 0.3) { const x = i % W, y = (i - x) / W; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y }
          if (a > 0.5) { sum += luma(px.data[i * 4], px.data[i * 4 + 1], px.data[i * 4 + 2]); n++ }
        }
        regions[slot] = { idx: Uint32Array.from(idx), alpha: Float32Array.from(alpha), mean: n ? sum / n : 128,
          box: { x0, y0, w: Math.max(1, x1 - x0 + 1), h: Math.max(1, y1 - y0 + 1) } }
      })
      return { base: px, regions }
    })()
    p.catch(() => prepared.delete(body))       // lỗi mạng: lần sau thử lại
    prepared.set(body, p)
  }
  return p
}

/** Hộp bao vùng áo / quần / tất / giày của một dáng (toạ độ khung) — trình thiết kế dùng để đặt lớp in */
export async function regionBoxes(body: Body): Promise<Partial<Record<TintSlot, Box>>> {
  const p = await prepare(body)
  return Object.fromEntries(Object.entries(p.regions).map(([k, r]) => [k, r!.box]))
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

/** Hệ số sáng tối của vải tại điểm (so với độ sáng trung bình vùng) */
const fabric = (b: Uint8ClampedArray, o: number, mean: number) => Math.min(1.35, Math.max(0.5, luma(b[o], b[o + 1], b[o + 2]) / Math.max(mean, 1)))

function paint(p: Prepared, tints: [TintSlot, string, Tone | null][], patterns: [TintSlot, ItemPattern][], textures: [TintSlot, Texture, HTMLImageElement][], body: Body): ImageData {
  const out = new ImageData(new Uint8ClampedArray(p.base.data), p.base.width, p.base.height)
  const d = out.data
  const b = p.base.data
  const W = p.base.width
  // Màu nền: độ đậm = trộn với màu gốc; sáng / tối = pha trắng / đen vào màu đích
  for (const [slot, hex, tone] of tints) {
    const region = p.regions[slot]
    const rgb = hexToRgb(tone?.light ? shadeHex(hex, tone.light) : hex)
    if (!region || !rgb) continue
    const k0 = tone?.strength ?? 1
    for (let k = 0; k < region.idx.length; k++) {
      const o = region.idx[k] * 4
      const [r, g, bl] = tintPixel(d[o], d[o + 1], d[o + 2], region.alpha[k] * k0, rgb, region.mean)
      d[o] = r
      d[o + 1] = g
      d[o + 2] = bl
    }
  }
  // Ảnh vải / ảnh áo thật: phủ trong hộp bao vùng (lấp đầy, lặp khi thu nhỏ), nhân sáng tối của vải
  for (const [slot, tex, img] of textures) {
    const region = p.regions[slot]
    if (!region) continue
    const { x0, y0, w, h } = region.box
    const cv = document.createElement('canvas')
    cv.width = w
    cv.height = h
    const c = cv.getContext('2d', { willReadFrequently: true })!
    const k = (Math.max(w / img.naturalWidth, h / img.naturalHeight) * (tex.scale || 1))
    const pat = c.createPattern(img, 'repeat')
    if (!pat) continue
    pat.setTransform(new DOMMatrix([k, 0, 0, k, (w - img.naturalWidth * k) / 2, (h - img.naturalHeight * k) / 2]))
    c.fillStyle = pat
    c.fillRect(0, 0, w, h)
    const t = c.getImageData(0, 0, w, h).data
    for (let n = 0; n < region.idx.length; n++) {
      const i = region.idx[n]
      const x = (i % W) - x0, y = ((i - (i % W)) / W) - y0
      if (x < 0 || y < 0 || x >= w || y >= h) continue
      const q = (y * w + x) * 4
      const a = (t[q + 3] / 255) * region.alpha[n] * tex.opacity
      if (a <= 0) continue
      const o = i * 4
      const f = fabric(b, o, region.mean)
      d[o] = d[o] * (1 - a) + Math.min(255, t[q] * f) * a
      d[o + 1] = d[o + 1] * (1 - a) + Math.min(255, t[q + 1] * f) * a
      d[o + 2] = d[o + 2] * (1 - a) + Math.min(255, t[q + 2] * f) * a
    }
  }
  // Họa tiết: vẽ độ phủ trong hộp bao vùng, rồi đổi màu đúng như TINT (giữ nếp vải) và trộn theo độ phủ
  for (const [slot, pat] of patterns) {
    const region = p.regions[slot]
    const rgb = hexToRgb(pat.color)
    if (!region || !rgb) continue
    const { x0, y0, w, h } = region.box
    const cv = document.createElement('canvas')
    cv.width = w
    cv.height = h
    const c = cv.getContext('2d', { willReadFrequently: true })!
    drawPattern(c, slot, pat.kind, w, h, genderOf(body))
    const cov = c.getImageData(0, 0, w, h).data
    for (let k = 0; k < region.idx.length; k++) {
      const i = region.idx[k]
      const x = (i % W) - x0, y = ((i - (i % W)) / W) - y0
      if (x < 0 || y < 0 || x >= w || y >= h) continue
      const a = cov[(y * w + x) * 4 + 3] / 255
      if (a <= 0) continue
      const o = i * 4
      const [r, g, bl] = tintPixel(b[o], b[o + 1], b[o + 2], region.alpha[k], rgb, region.mean)
      d[o] = d[o] * (1 - a) + r * a
      d[o + 1] = d[o + 1] * (1 - a) + g * a
      d[o + 2] = d[o + 2] * (1 - a) + bl * a
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

const hasLegacy = (pr: ItemPrint) => !!(pr.logo_url || pr.title || pr.subtitle || pr.personal === 'NAME')

/** Hình in của một vùng (áo: logo / chữ kiểu cũ + lớp tự do; quần: lớp tự do): cắt theo mặt nạ, sáng tối theo nếp vải */
async function paintOverlay(p: Prepared, body: Body, slot: TintSlot, print: ItemPrint, personal: string | null, useShade: boolean): Promise<HTMLCanvasElement | null> {
  const region = p.regions[slot]
  if (!region) return null
  const { width: W, height: H } = FRAME
  const off = document.createElement('canvas')
  off.width = W
  off.height = H
  const c = off.getContext('2d', { willReadFrequently: true })!
  const texts = (print.layers ?? []).filter((l) => l.type === 'text')
  const legacy = slot === 'top' && hasLegacy(print)
  if (texts.length || legacy) {
    // Bộ font thiết kế chỉ nạp khi có chữ in (không kéo vào mọi trang có nhân vật)
    await import('@/shared/design/fonts')
    await Promise.all([
      ...(legacy ? [`800 32px ${fontFamily(PRINT_FONT[print.font ?? 'sport'])}`] : []),
      ...texts.map((l) => layerFont(l, 32)),
    ].map((f) => document.fonts?.load(f).catch(() => undefined)))
  }
  if (legacy) {
    const zones = PRINT_ZONES[body]
    const family = fontFamily(PRINT_FONT[print.font ?? 'sport'])
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
  }
  for (const l of print.layers ?? []) {
    const img = l.type === 'image' && l.url ? await loadLayer(l.url).catch(() => null) : null
    drawLayer(c, l, region.box, personal, img)
  }
  if (!useShade) return off
  // Chỉ giữ phần nằm trên vải; mực in hơi trong để thấy nhẹ vân vải
  const { x0, y0, w, h } = region.box
  const src = c.getImageData(x0, y0, w, h).data
  const dst = new ImageData(w, h)
  const d = dst.data
  const b = p.base.data
  for (let k = 0; k < region.idx.length; k++) {
    const i = region.idx[k]
    const x = (i % W) - x0, y = ((i - (i % W)) / W) - y0
    if (x < 0 || y < 0 || x >= w || y >= h) continue
    const q = (y * w + x) * 4
    if (!src[q + 3]) continue
    const f = Math.pow(fabric(b, i * 4, region.mean), 0.85)
    d[q] = Math.min(255, src[q] * f); d[q + 1] = Math.min(255, src[q + 1] * f); d[q + 2] = Math.min(255, src[q + 2] * f)
    d[q + 3] = src[q + 3] * region.alpha[k] * 0.94
  }
  c.clearRect(0, 0, W, H)
  c.putImageData(dst, x0, y0)
  return off
}

interface Overlay { slot: TintSlot; print: ItemPrint; shade: boolean }
interface DrawSpec {
  tints: [TintSlot, string, Tone | null][]
  patterns: [TintSlot, ItemPattern][]
  textures: [TintSlot, Texture][]
  overlays: Overlay[]
  layers: { slot: Slot; url: string }[]
  personal: string | null
}

function specOf(body: Body, items: CharacterItem[], personalName?: string | null): DrawSpec {
  const tint = items.filter((i) => i.render_kind === 'TINT' && isTintSlot(i.slot)) as (CharacterItem & { slot: TintSlot })[]
  const overlays: Overlay[] = []
  for (const i of items) {
    if (!i.print || !(i.slot === 'top' || i.slot === 'bottom')) continue
    if ((i.slot === 'top' && hasLegacy(i.print)) || (i.print.layers?.length ?? 0) > 0) overlays.push({ slot: i.slot, print: i.print, shade: i.render_kind !== 'LAYER' })
  }
  return {
    tints: tint.filter((i) => i.color).map((i) => [i.slot, i.color!, i.print?.tone ?? null]),
    patterns: tint.filter((i) => i.print?.pattern).map((i) => [i.slot, i.print!.pattern!]),
    textures: tint.filter((i) => i.print?.texture?.url).map((i) => [i.slot, i.print!.texture!]),
    overlays,
    layers: items.map((i) => ({ slot: i.slot, url: layerUrl(i, body) })).filter((x): x is { slot: Slot; url: string } => !!x.url),
    personal: jerseyName(personalName) || null,
  }
}

/** Vẽ nhân vật hoàn chỉnh vào ctx tại (ox, oy): nền đã đổi màu → lớp dưới áo → hình in → lớp trên */
async function compose(ctx: CanvasRenderingContext2D, body: Body, spec: DrawSpec, ox: number, oy: number, isCancelled?: () => boolean) {
  const { width: W, height: H } = FRAME
  const [p, imgs, texImgs] = await Promise.all([prepare(body), Promise.all(spec.layers.map((l) => loadLayer(l.url))),
    Promise.all(spec.textures.map(([, t]) => loadLayer(t.url).catch(() => null)))])
  const overlays = await Promise.all(spec.overlays.map((o) => paintOverlay(p, body, o.slot, o.print, spec.personal, o.shade)))
  if (isCancelled?.()) return false
  const textures = spec.textures.map(([s, t], k) => [s, t, texImgs[k]] as const).filter((x): x is [TintSlot, Texture, HTMLImageElement] => !!x[2])
  ctx.putImageData(paint(p, spec.tints, spec.patterns, textures, body), ox, oy)
  const topAt = LAYER_ORDER.indexOf('top')
  const under = spec.layers.map((l, k) => ({ ...l, img: imgs[k] })).filter((l) => LAYER_ORDER.indexOf(l.slot) <= topAt)
  const over = spec.layers.map((l, k) => ({ ...l, img: imgs[k] })).filter((l) => LAYER_ORDER.indexOf(l.slot) > topAt)
  for (const l of under) ctx.drawImage(l.img, ox, oy, W, H)
  for (const o of overlays) if (o) ctx.drawImage(o, ox, oy, W, H)
  for (const l of over) ctx.drawImage(l.img, ox, oy, W, H)
  return true
}

/** Vùng chân dung (đầu + vai) trong khung chuẩn, để làm ảnh đại diện */
const PORTRAIT: Record<Body, { cx: number; cy: number; side: number }> = {
  male: { cx: 474, cy: 175, side: 330 },
  female: { cx: 450, cy: 215, side: 330 },
  male_relax: { cx: 452, cy: 160, side: 330 },
  male_run: { cx: 522, cy: 166, side: 330 },
  female_tee: { cx: 455, cy: 190, side: 320 },
  female_run: { cx: 560, cy: 175, side: 320 },
}

/** Nhân vật đầy đủ (khung chuẩn 900×1350) mặc bộ đồ `items` — dùng cho ảnh chia sẻ, ảnh đại diện */
export async function renderCharacter(gender: Body, items: CharacterItem[], personalName?: string | null): Promise<HTMLCanvasElement> {
  const full = document.createElement('canvas')
  full.width = FRAME.width
  full.height = FRAME.height
  await compose(full.getContext('2d')!, gender, specOf(gender, items, personalName), 0, 0)
  return full
}

/** Ảnh chân dung vuông của nhân vật đang mặc bộ đồ (JPEG), dùng làm ảnh đại diện */
export async function renderPortrait(gender: Body, items: CharacterItem[], size = 512, personalName?: string | null): Promise<Blob> {
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
  gender: Body; items: CharacterItem[]; className?: string; label?: string
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
