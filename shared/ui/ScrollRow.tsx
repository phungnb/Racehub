'use client'

import { useCallback, useEffect, useRef, useState, type HTMLAttributes, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/shared/lib/cn'

const ACTIVE = '[aria-current="page"],[aria-selected="true"],[aria-checked="true"],[aria-pressed="true"]'

/**
 * Hàng cuộn ngang (thanh tab, hàng chip): khi còn mục bị che sẽ hiện mũi tên + vệt mờ ở mép để người dùng biết cuộn được,
 * bấm mũi tên để cuộn; mục đang chọn (aria-current / aria-selected / aria-checked / aria-pressed) tự cuộn vào giữa khi đổi.
 * `className` cho khung ngoài (lề), `innerClassName` cho hàng (khoảng cách, đệm); thuộc tính còn lại (role, aria-*) gắn vào hàng.
 */
export function ScrollRow({ children, className, innerClassName, activeKey, label, ...rest }: {
  children: ReactNode; className?: string; innerClassName?: string; activeKey?: string; label?: string
} & Omit<HTMLAttributes<HTMLDivElement>, 'className' | 'children'>) {
  const ref = useRef<HTMLDivElement>(null)
  const [edge, setEdge] = useState({ left: false, right: false })

  const update = useCallback(() => {
    const el = ref.current
    if (!el) return
    const left = el.scrollLeft > 4
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 4
    setEdge((e) => (e.left === left && e.right === right ? e : { left, right }))
  }, [])

  const center = useCallback((smooth: boolean) => {
    const el = ref.current
    const active = el?.querySelector<HTMLElement>(ACTIVE)
    if (!el || !active || el.scrollWidth <= el.clientWidth) return
    el.scrollTo({ left: Math.max(0, active.offsetLeft - (el.clientWidth - active.offsetWidth) / 2), behavior: smooth ? 'smooth' : 'auto' })
  }, [])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    Array.from(el.children).forEach((c) => ro.observe(c))
    // Mục được chọn đổi (bấm tab, đổi bộ lọc) → cuộn mục đó vào giữa
    const mo = new MutationObserver((list) => {
      if (list.some((m) => m.type === 'childList' || (m.target as HTMLElement).matches?.(ACTIVE))) { center(true); update() }
    })
    mo.observe(el, { subtree: true, childList: true, attributeFilter: ['aria-current', 'aria-selected', 'aria-checked', 'aria-pressed'] })
    return () => { ro.disconnect(); mo.disconnect() }
  }, [update, center])

  useEffect(() => { center(true) }, [activeKey, center])

  const by = (dir: -1 | 1) => ref.current?.scrollBy({ left: dir * ref.current.clientWidth * 0.7, behavior: 'smooth' })

  return (
    <div className={cn('relative', className)}>
      <div ref={ref} onScroll={update} aria-label={label} {...rest}
        className={cn('relative flex overflow-x-auto overscroll-x-contain scrollbar-none', innerClassName)}>
        {children}
      </div>
      {edge.left && (
        <button type="button" tabIndex={-1} aria-label="Cuộn sang trái" onClick={() => by(-1)}
          className="absolute inset-y-0 left-0 z-10 grid w-9 place-items-center bg-gradient-to-r from-bg via-bg/90 to-transparent text-fg-muted hover:text-fg">
          <ChevronLeft className="size-5" aria-hidden />
        </button>
      )}
      {edge.right && (
        <button type="button" tabIndex={-1} aria-label="Cuộn sang phải" onClick={() => by(1)}
          className="absolute inset-y-0 right-0 z-10 grid w-9 place-items-center bg-gradient-to-l from-bg via-bg/90 to-transparent text-fg-muted hover:text-fg">
          <ChevronRight className="size-5 animate-pulse" aria-hidden />
        </button>
      )}
    </div>
  )
}
