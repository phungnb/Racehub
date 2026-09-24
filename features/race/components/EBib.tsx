'use client'

import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { cn } from '@/shared/lib/cn'
import { BIB_SIZE, drawBib, type BibData, type BibDesign } from '../model/bib'

/** e-BIB vẽ theo thiết kế của BTC; ref trả về canvas để tải ảnh */
export const EBib = forwardRef<HTMLCanvasElement | null, { design: Partial<BibDesign> | null | undefined; data: BibData; className?: string }>(
  function EBib({ design, data, className }, ref) {
    const canvas = useRef<HTMLCanvasElement>(null)
    useImperativeHandle(ref, () => canvas.current!, [])
    const key = JSON.stringify([design, data])
    useEffect(() => {
      let alive = true
      const off = document.createElement('canvas')
      void drawBib(off, design, data).then(() => {           // vẽ ngoài màn hình rồi chép sang → không nhấp nháy khi đổi thiết kế
        if (!alive || !canvas.current) return
        canvas.current.width = off.width
        canvas.current.height = off.height
        canvas.current.getContext('2d')!.drawImage(off, 0, 0)
      })
      return () => { alive = false }
    }, [key]) // eslint-disable-line react-hooks/exhaustive-deps
    return (
      <canvas ref={canvas} width={BIB_SIZE.w} height={BIB_SIZE.h} aria-label={`BIB ${data.bib}`}
        className={cn('aspect-[7/5] w-full rounded-xl shadow-lg shadow-black/30', className)} />
    )
  })

export function downloadCanvas(c: HTMLCanvasElement | null, name: string) {
  if (!c) return
  const a = document.createElement('a')
  a.href = c.toDataURL('image/png')
  a.download = name
  a.click()
}
