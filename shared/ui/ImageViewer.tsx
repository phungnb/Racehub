'use client'

import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

/** Xem ảnh toàn màn hình (ảnh đại diện, ảnh bài viết…): chạm nền / nút X / phím Esc để đóng */
export function ImageViewer({ src, alt = '', onClose }: { src: string | null; alt?: string; onClose: () => void }) {
  useEffect(() => {
    if (!src) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev }
  }, [src, onClose])
  if (!src || typeof document === 'undefined') return null
  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={alt || 'Xem ảnh'} onClick={onClose}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 p-4 pt-[calc(1rem+env(safe-area-inset-top))] pb-[calc(1rem+env(safe-area-inset-bottom))]">
      <button type="button" onClick={onClose} aria-label="Đóng"
        className="absolute right-3 top-[calc(0.75rem+env(safe-area-inset-top))] grid size-11 place-items-center rounded-full bg-white/15 text-white hover:bg-white/25">
        <X className="size-6" aria-hidden />
      </button>
      {/* eslint-disable-next-line @next/next/no-img-element -- ảnh ngoài (Strava / Supabase Storage) */}
      <img src={src} alt={alt} onClick={(e) => e.stopPropagation()}
        className="max-h-full max-w-full rounded-2xl object-contain shadow-2xl" />
    </div>,
    document.body,
  )
}
