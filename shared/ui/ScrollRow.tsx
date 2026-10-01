'use client'

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/shared/lib/cn'

/**
 * Hàng cuộn ngang (thanh tab, hàng chip): khi còn mục bị che sẽ hiện mũi tên + vệt mờ ở mép để người dùng biết cuộn được,
 * bấm mũi tên để cuộn; mục đang chọn (aria-current="page" / aria-selected="true") tự cuộn vào giữa khi `activeKey` đổi.
 */
export function ScrollRow({ children, className, innerClassName, activeKey, label, role }: {
  children: ReactNode; className?: string; innerClassName?: string; activeKey?: string; label?: string; role?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [edge, setEdge] = useState({ left: false, right: false })

  const update = useCallback(() => {
    const el = ref.current
    if (!el) return
    const left = el.scrollLeft > 4
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 4
    setEdge((e) => (e.left === left && e.right === right ? e : { left, right }))
  }, [])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    Array.from(el.children).forEach((c) => ro.observe(c))
    return () => ro.disconnect()
  }, [update])

  useEffect(() => {
    const el = ref.current
    const active = el?.querySelector<HTMLElement>('[aria-current="page"],[aria-selected="true"]')
    if (!el || !active) return
    el.scrollTo({ left: Math.max(0, active.offsetLeft - (el.clientWidth - active.offsetWidth) / 2), behavior: 'smooth' })
  }, [activeKey])

  const by = (dir: -1 | 1) => ref.current?.scrollBy({ left: dir * ref.current.clientWidth * 0.7, behavior: 'smooth' })

  return (
    <div className={cn('relative', className)}>
      <div ref={ref} onScroll={update} role={role} aria-label={label}
        className={cn('relative flex overflow-x-auto overscroll-x-contain scrollbar-none', innerClassName)}>
        {children}
      </div>
      {edge.left && (
        <button type="button" tabIndex={-1} aria-label="Cuộn sang trái" onClick={() => by(-1)}
          className="absolute inset-y-0 left-0 grid w-9 place-items-center bg-gradient-to-r from-bg via-bg/90 to-transparent text-fg-muted hover:text-fg">
          <ChevronLeft className="size-5" aria-hidden />
        </button>
      )}
      {edge.right && (
        <button type="button" tabIndex={-1} aria-label="Cuộn sang phải" onClick={() => by(1)}
          className="absolute inset-y-0 right-0 grid w-9 place-items-center bg-gradient-to-l from-bg via-bg/90 to-transparent text-fg-muted hover:text-fg">
          <ChevronRight className="size-5 animate-pulse" aria-hidden />
        </button>
      )}
    </div>
  )
}
