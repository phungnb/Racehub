'use client'

import { useEffect, useRef } from 'react'

const COLORS = ['#f5b301', '#b6ff3b', '#ffffff', '#ff5d73', '#4cc9f0', '#ffd166']

/** Pháo giấy trên canvas (không cần thư viện): mỗi lần `fire` đổi thì bắn một đợt ~2,5 giây. Tắt khi người dùng chọn giảm chuyển động. */
export function Confetti({ fire }: { fire: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = ref.current
    if (!fire || !c || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    const ctx = c.getContext('2d')
    if (!ctx) return
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const w = (c.width = c.clientWidth * dpr), h = (c.height = c.clientHeight * dpr)
    const parts = Array.from({ length: 160 }, (_, i) => {
      const left = i % 2 === 0
      return {
        x: left ? w * 0.1 : w * 0.9, y: h * 0.75,
        vx: (left ? 1 : -1) * (4 + Math.random() * 9) * dpr, vy: -(10 + Math.random() * 12) * dpr,
        r: (3 + Math.random() * 4) * dpr, rot: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.3,
        color: COLORS[i % COLORS.length],
      }
    })
    const t0 = performance.now()
    let raf = 0
    const frame = (t: number) => {
      const age = t - t0
      ctx.clearRect(0, 0, w, h)
      ctx.globalAlpha = Math.max(0, 1 - Math.max(0, age - 1800) / 700)
      for (const p of parts) {
        p.vy += 0.35 * dpr; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.rot += p.vr
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.fillStyle = p.color
        ctx.fillRect(-p.r, -p.r / 2, p.r * 2, p.r); ctx.restore()
      }
      if (age < 2500) raf = requestAnimationFrame(frame)
      else ctx.clearRect(0, 0, w, h)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [fire])
  return <canvas ref={ref} aria-hidden className="pointer-events-none absolute inset-0 z-10 size-full" />
}
