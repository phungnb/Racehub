'use client'

// Vẽ nhân vật 2D: ảnh thật trong khung chuẩn → đổi màu từng vùng theo mặt nạ (TINT) → xếp các lớp PNG (LAYER).
// Chuẩn tài nguyên: docs/NHAN_VAT.md.
import { useEffect, useRef, useState } from 'react'
import { cn } from '@/shared/lib/cn'
import {
  baseUrl, FRAME, hexToRgb, isTintSlot, layerUrl, luma, maskUrl, TINT_SLOTS, tintPixel,
  type CharacterItem, type Gender, type TintSlot,
} from '../model/catalog'

interface Region { idx: Uint32Array; alpha: Float32Array; mean: number }
interface Prepared { base: ImageData; regions: Partial<Record<TintSlot, Region>> }

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
      return { base: px, regions }
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

/** Vùng chân dung (đầu + vai) trong khung chuẩn, để làm ảnh đại diện */
const PORTRAIT: Record<Gender, { cx: number; cy: number; side: number }> = {
  male: { cx: 474, cy: 175, side: 330 },
  female: { cx: 450, cy: 215, side: 330 },
}

/** Nhân vật đầy đủ (khung chuẩn 900×1350) mặc bộ đồ `items` — dùng cho ảnh chia sẻ, ảnh đại diện */
export async function renderCharacter(gender: Gender, items: CharacterItem[]): Promise<HTMLCanvasElement> {
  const tints = items.filter((i) => i.render_kind === 'TINT' && i.color && isTintSlot(i.slot)).map((i) => [i.slot, i.color!] as [TintSlot, string])
  const urls = items.map((i) => layerUrl(i, gender)).filter((u): u is string => !!u)
  const [p, imgs] = await Promise.all([prepare(gender), Promise.all(urls.map(loadLayer))])
  const full = document.createElement('canvas')
  full.width = FRAME.width
  full.height = FRAME.height
  const fctx = full.getContext('2d')!
  fctx.putImageData(paint(p, tints), 0, 0)
  for (const img of imgs) fctx.drawImage(img, 0, 0, FRAME.width, FRAME.height)
  return full
}

/** Ảnh chân dung vuông của nhân vật đang mặc bộ đồ (JPEG), dùng làm ảnh đại diện */
export async function renderPortrait(gender: Gender, items: CharacterItem[], size = 512): Promise<Blob> {
  const full = await renderCharacter(gender, items)
  const { cx, cy, side } = PORTRAIT[gender]
  const out = document.createElement('canvas')
  out.width = size
  out.height = size
  out.getContext('2d')!.drawImage(full, cx - side / 2, cy - side / 2, side, side, 0, 0, size, size)
  return new Promise((resolve, reject) => out.toBlob((b) => (b ? resolve(b) : reject(new Error('Không tạo được ảnh'))), 'image/jpeg', 0.9))
}

/** Nhân vật mặc bộ đồ `items` (đã theo thứ tự lớp, xem resolveOutfit) */
export function PaperDoll({ gender, items, className, label = 'Nhân vật', fit = 'cover' }: {
  gender: Gender; items: CharacterItem[]; className?: string; label?: string
  /** cover: lấp kín khung (có thể cắt chút đầu/chân); contain: thấy trọn khung ảnh, dùng khi cần soát món đồ */
  fit?: 'cover' | 'contain'
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  // Chỉ vẽ lại khi màu hoặc lớp thực sự đổi
  const spec = JSON.stringify({
    tints: items.filter((i) => i.render_kind === 'TINT' && i.color && isTintSlot(i.slot)).map((i) => [i.slot, i.color]),
    layers: items.map((i) => layerUrl(i, gender)).filter((u): u is string => !!u),
  })

  useEffect(() => {
    let cancelled = false
    const { tints, layers: urls } = JSON.parse(spec) as { tints: [TintSlot, string][]; layers: string[] }
    ;(async () => {
      try {
        const [p, imgs] = await Promise.all([prepare(gender), Promise.all(urls.map(loadLayer))])
        const cv = ref.current
        if (cancelled || !cv) return
        const { width: W, height: H } = FRAME
        cv.width = W + 2 * SIDE
        cv.height = H + TOP
        const ctx = cv.getContext('2d')!
        ctx.putImageData(paint(p, tints), SIDE, TOP)
        for (const img of imgs) ctx.drawImage(img, SIDE, TOP, W, H)
        // Nền mở rộng: kéo dãn hàng/cột mép ảnh (nền xám trơn) để khung nào cũng liền màu
        ctx.drawImage(cv, SIDE, TOP, W, 1, SIDE, 0, W, TOP)
        ctx.drawImage(cv, SIDE, 0, 1, H + TOP, 0, 0, SIDE, H + TOP)
        ctx.drawImage(cv, SIDE + W - 1, 0, 1, H + TOP, SIDE + W, 0, SIDE, H + TOP)
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
