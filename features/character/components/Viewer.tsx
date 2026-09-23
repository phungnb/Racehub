'use client'

import dynamic from 'next/dynamic'
import { Loader2 } from 'lucide-react'
import type { CharacterViewerProps } from '../three/CharacterViewer'

// three.js chỉ tải khi cần (không vào bundle chính, không chạy phía server)
const CharacterViewer = dynamic(() => import('../three/CharacterViewer'), {
  ssr: false,
  loading: () => (
    <div className="grid size-full place-items-center text-fg-subtle" aria-label="Đang tải nhân vật">
      <Loader2 className="size-6 animate-spin" aria-hidden />
    </div>
  ),
})

/** Ảnh tĩnh khi máy không hỗ trợ WebGL hoặc tải mô hình lỗi */
function StaticFallback({ gender }: { gender: 'male' | 'female' }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- ảnh tĩnh trong /public
    <img src={`/avatars/runner_${gender}.png`} alt="" className="mx-auto h-full object-contain" />
  )
}

export function Viewer(props: CharacterViewerProps) {
  return <CharacterViewer {...props} fallback={props.fallback ?? <StaticFallback gender={props.gender} />} />
}
