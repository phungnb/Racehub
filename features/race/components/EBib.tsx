'use client'

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { cn } from '@/shared/lib/cn'
import { BIB_SIZE, drawBib, type BibData, type StoredDesign } from '../model/bib'
import type { Layout, Size } from '../model/design'
import './designFonts'

/** Canvas vẽ một thiết kế (BIB / chứng nhận): vẽ ngoài màn hình rồi chép sang → không nhấp nháy khi đổi thiết kế */
export const DesignCanvas = forwardRef<HTMLCanvasElement | null, {
  size: Size; draw: (c: HTMLCanvasElement) => Promise<Layout>; drawKey: string; label: string; className?: string; onLayout?: (l: Layout) => void
}>(
  function DesignCanvas({ size, draw, drawKey, label, className, onLayout }, ref) {
    const canvas = useRef<HTMLCanvasElement>(null)
    useImperativeHandle(ref, () => canvas.current!, [])
    // Font tải xong sau lần vẽ đầu (lần đầu dùng font đó) → vẽ lại cho đúng font
    const [fontTick, setFontTick] = useState(0)
    useEffect(() => {
      const fonts = document.fonts
      if (!fonts?.addEventListener) return
      const on = () => setFontTick((t) => t + 1)
      fonts.addEventListener('loadingdone', on)
      return () => fonts.removeEventListener('loadingdone', on)
    }, [])
    useEffect(() => {
      let alive = true
      const off = document.createElement('canvas')
      void draw(off).then((layout) => {
        if (!alive || !canvas.current) return
        onLayout?.(layout)
        canvas.current.width = off.width
        canvas.current.height = off.height
        canvas.current.getContext('2d')!.drawImage(off, 0, 0)
      })
      return () => { alive = false }
    }, [drawKey, fontTick]) // eslint-disable-line react-hooks/exhaustive-deps
    return (
      <canvas ref={canvas} width={size.w} height={size.h} aria-label={label} style={{ aspectRatio: `${size.w} / ${size.h}` }}
        className={cn('w-full rounded-xl shadow-lg shadow-black/30', className)} />
    )
  })

/** e-BIB vẽ theo thiết kế của BTC; ref trả về canvas để tải ảnh */
export const EBib = forwardRef<HTMLCanvasElement | null, {
  design: StoredDesign | null | undefined; data: BibData; className?: string; editing?: boolean; onLayout?: (l: Layout) => void
}>(
  function EBib({ design, data, className, editing, onLayout }, ref) {
    return (
      <DesignCanvas ref={ref} size={BIB_SIZE} label={`BIB ${data.bib}`} className={className} onLayout={onLayout}
        drawKey={JSON.stringify([design, data, editing])} draw={(c) => drawBib(c, design, data, { editing })} />
    )
  })

export function downloadCanvas(c: HTMLCanvasElement | null, name: string) {
  if (!c) return
  const a = document.createElement('a')
  a.href = c.toDataURL('image/png')
  a.download = name
  a.click()
}
