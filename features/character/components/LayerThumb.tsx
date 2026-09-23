'use client'

// Ảnh thu nhỏ của món lớp: chân dung nhỏ nhân vật đang mặc món đó, cắt quanh món đồ
// (ảnh lớp là cả khung 900x1350; có món kèm phần nền vẽ lại để che tóc, nên phải ghép lên ảnh nền mới đẹp).
import { useEffect, useRef, useState } from 'react'
import { cn } from '@/shared/lib/cn'
import { baseUrl, type Gender } from '../model/catalog'
import { loadImage } from './PaperDoll'

type Box = [number, number, number, number]
const boxes = new Map<string, Promise<Box | null>>()

/** Khung bao phần đậm của lớp (alpha > 160, bỏ viền bóng mờ); đọc ở 1/4 độ phân giải cho nhanh */
function bbox(src: string) {
  let p = boxes.get(src)
  if (!p) {
    p = loadImage(src).then((img) => {
      const w = Math.max(1, Math.round(img.naturalWidth / 4)), h = Math.max(1, Math.round(img.naturalHeight / 4))
      const c = document.createElement('canvas')
      c.width = w
      c.height = h
      const ctx = c.getContext('2d', { willReadFrequently: true })!
      ctx.drawImage(img, 0, 0, w, h)
      const d = ctx.getImageData(0, 0, w, h).data
      let x0 = w, y0 = h, x1 = -1, y1 = -1
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        if (d[(y * w + x) * 4 + 3] > 160) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y }
      }
      if (x1 < 0) return null
      const k = img.naturalWidth / w
      return [x0 * k, y0 * k, (x1 + 1) * k, (y1 + 1) * k] as Box
    })
    p.catch(() => boxes.delete(src))
    boxes.set(src, p)
  }
  return p
}

export function LayerThumb({ src, gender, className }: { src: string; gender: Gender; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let cancelled = false
    Promise.all([loadImage(baseUrl(gender)), loadImage(src), bbox(src)]).then(([base, img, b]) => {
      const cv = ref.current
      if (cancelled || !cv || !b) return
      const size = 128
      cv.width = size
      cv.height = size
      const [x0, y0, x1, y1] = b
      const side = Math.max(x1 - x0, y1 - y0) * 1.5 + 24          // vuông, chừa lề để thấy người mặc
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2 + side * 0.12
      const sx = cx - side / 2, sy = cy - side / 2
      const ctx = cv.getContext('2d')!
      ctx.drawImage(base, sx, sy, side, side, 0, 0, size, size)
      ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size)
    }).catch(() => { if (!cancelled) setFailed(true) })
    return () => { cancelled = true }
  }, [src, gender])
  if (failed) return <span className={cn('grid place-items-center text-xs text-fg-subtle', className)}>Lỗi ảnh</span>
  return <canvas ref={ref} aria-hidden className={cn('object-cover', className)} />
}
