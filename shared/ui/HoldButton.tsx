'use client'

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { cn } from '@/shared/lib/cn'

/** Nút phải GIỮ đủ lâu mới kích hoạt — tránh bấm nhầm khi đang chạy (MH 15). */
export function HoldButton({ onComplete, holdMs = 1500, children, className, label }: {
  onComplete: () => void; holdMs?: number; children: ReactNode; className?: string; label: string
}) {
  const [progress, setProgress] = useState(0)
  const raf = useRef<number | null>(null)
  const startAt = useRef<number | null>(null)

  const cancel = useCallback(() => {
    if (raf.current) cancelAnimationFrame(raf.current)
    raf.current = null
    startAt.current = null
    setProgress(0)
  }, [])

  const begin = useCallback(() => {
    if (startAt.current !== null) return
    startAt.current = performance.now()
    const step = () => {
      if (startAt.current === null) return
      const p = Math.min(1, (performance.now() - startAt.current) / holdMs)
      setProgress(p)
      if (p >= 1) {
        cancel()
        navigator.vibrate?.(60)
        onComplete()
        return
      }
      raf.current = requestAnimationFrame(step)
    }
    raf.current = requestAnimationFrame(step)
  }, [cancel, holdMs, onComplete])

  useEffect(() => cancel, [cancel])

  const R = 34
  const C = 2 * Math.PI * R
  return (
    <button
      type="button"
      aria-label={label}
      onPointerDown={begin} onPointerUp={cancel} onPointerLeave={cancel} onPointerCancel={cancel}
      onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); begin() } }}
      onKeyUp={cancel}
      onContextMenu={(e) => e.preventDefault()}
      className={cn('relative grid size-20 touch-none select-none place-items-center rounded-full', className)}
    >
      <svg className="absolute inset-0 -rotate-90" viewBox="0 0 80 80" aria-hidden>
        <circle cx="40" cy="40" r={R} fill="none" stroke="currentColor" strokeOpacity={0.2} strokeWidth="5" />
        <circle cx="40" cy="40" r={R} fill="none" stroke="currentColor" strokeWidth="5" strokeLinecap="round"
          strokeDasharray={C} strokeDashoffset={C * (1 - progress)} />
      </svg>
      {children}
    </button>
  )
}
