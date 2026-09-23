'use client'

import { useMemo } from 'react'
import { modelUrl, type CharacterItem, type Gender, type Slot } from '../model/catalog'
import type { ViewerItem } from '../three/CharacterViewer'

/** Bộ đồ (mã theo ô) → danh sách mô hình cho trình hiển thị 3D */
export function useViewerItems(items: CharacterItem[] | undefined, equipped: Partial<Record<Slot, string>>, gender: Gender): ViewerItem[] {
  return useMemo(() => {
    const byCode = new Map((items ?? []).map((i) => [i.code, i]))
    const out: ViewerItem[] = []
    for (const code of Object.values(equipped)) {
      const it = code ? byCode.get(code) : undefined
      const url = it && modelUrl(it, gender)
      if (it && url) out.push({ slot: it.slot, url, color: it.color, color2: it.color2 })
    }
    return out
  }, [items, equipped, gender])
}
