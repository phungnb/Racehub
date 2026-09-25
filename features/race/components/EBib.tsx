'use client'

import { forwardRef } from 'react'
import { DesignCanvas } from '@/shared/design/DesignCanvas'
import { BIB_SIZE, drawBib, type BibData, type StoredDesign } from '../model/bib'
import type { Layout } from '@/shared/design/engine'

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

export { DesignCanvas }
