// Nền tự vẽ dùng chung (Vinh danh thử thách, Victory Studio): không lo bản quyền, đổi màu theo bảng màu
import type { Palette, Size } from './engine'

export type Backdrop = 'podium' | 'rays' | 'confetti' | 'speed' | 'gold' | 'neon' | 'paper' | 'gradient' | 'stadium' | 'minimal'

export function rng(seed: number) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}

/** Vẽ nền trang trí (sau khi đã tô màu nền) */
export function paintBackdrop(ctx: CanvasRenderingContext2D, style: Backdrop, c: Palette, size: Size) {
  const { w, h } = size
  const m = Math.min(w, h)
  ctx.save()
  switch (style) {
    case 'podium': {
      const g = ctx.createLinearGradient(0, 0, 0, h)
      g.addColorStop(0, c.bg); g.addColorStop(1, '#000000')
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h)
      // đèn sân khấu
      for (const [x, a] of [[0.15, 0.25], [0.5, 0.32], [0.85, 0.25]] as const) {
        const sg = ctx.createLinearGradient(0, 0, 0, h * 0.8)
        sg.addColorStop(0, `rgba(255,255,255,${a})`); sg.addColorStop(1, 'rgba(255,255,255,0)')
        ctx.fillStyle = sg
        ctx.beginPath(); ctx.moveTo(w * x - m * 0.03, 0); ctx.lineTo(w * x + m * 0.03, 0); ctx.lineTo(w * x + m * 0.28, h * 0.8); ctx.lineTo(w * x - m * 0.28, h * 0.8); ctx.fill()
      }
      const fg = ctx.createRadialGradient(w / 2, h * 0.92, 0, w / 2, h * 0.92, w * 0.6)
      fg.addColorStop(0, c.band); fg.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.globalAlpha = 0.55; ctx.fillStyle = fg; ctx.fillRect(0, h * 0.6, w, h * 0.4)
      break
    }
    case 'gold': {
      const g = ctx.createLinearGradient(0, 0, w, h)
      g.addColorStop(0, '#1a1406'); g.addColorStop(0.5, c.bg); g.addColorStop(1, '#1a1406')
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h)
      const gold = ctx.createLinearGradient(0, 0, w, h)
      gold.addColorStop(0, '#8a5d0d'); gold.addColorStop(0.3, '#f7d774'); gold.addColorStop(0.5, '#b8861b'); gold.addColorStop(0.7, '#fff3b0'); gold.addColorStop(1, '#8a5d0d')
      ctx.strokeStyle = gold; ctx.lineWidth = m * 0.012; ctx.strokeRect(m * 0.035, m * 0.035, w - m * 0.07, h - m * 0.07)
      ctx.lineWidth = m * 0.003; ctx.strokeRect(m * 0.055, m * 0.055, w - m * 0.11, h - m * 0.11)
      ctx.globalAlpha = 0.06; ctx.fillStyle = '#f7d774'
      for (let i = -2; i < 6; i++) { ctx.beginPath(); ctx.moveTo(i * w * 0.25, 0); ctx.lineTo(i * w * 0.25 + w * 0.08, 0); ctx.lineTo(i * w * 0.25 + w * 0.08 + h * 0.5, h); ctx.lineTo(i * w * 0.25 + h * 0.5, h); ctx.fill() }
      break
    }
    case 'rays': {
      const cx = w / 2, cy = h * 0.42, R = Math.hypot(w, h)
      ctx.fillStyle = c.band; ctx.globalAlpha = 0.28
      for (let i = 0; i < 24; i += 2) {
        const a0 = (Math.PI * 2 * i) / 24, a1 = (Math.PI * 2 * (i + 1)) / 24
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a0) * R, cy + Math.sin(a0) * R); ctx.lineTo(cx + Math.cos(a1) * R, cy + Math.sin(a1) * R); ctx.fill()
      }
      ctx.globalAlpha = 1
      const rg = ctx.createRadialGradient(cx, cy, 0, cx, cy, m * 0.6)
      rg.addColorStop(0, 'rgba(255,255,255,0.85)'); rg.addColorStop(1, 'rgba(255,255,255,0)')
      ctx.fillStyle = rg; ctx.fillRect(0, 0, w, h)
      break
    }
    case 'confetti': {
      const r = rng(7)
      const cols = [c.band, c.accent, '#facc15', '#22c55e', '#38bdf8']
      for (let i = 0; i < 140; i++) {
        const x = r() * w, y = r() * h
        if (y > h * 0.22 && y < h * 0.9 && x > w * 0.1 && x < w * 0.9 && r() < 0.75) continue       // chừa vùng giữa cho chữ
        ctx.save(); ctx.translate(x, y); ctx.rotate(r() * Math.PI)
        ctx.fillStyle = cols[i % cols.length]; ctx.globalAlpha = 0.85
        if (i % 3 === 0) { ctx.beginPath(); ctx.arc(0, 0, m * 0.006, 0, Math.PI * 2); ctx.fill() } else ctx.fillRect(-m * 0.012, -m * 0.004, m * 0.024, m * 0.008)
        ctx.restore()
      }
      break
    }
    case 'speed': {
      const r = rng(3)
      for (let i = 0; i < 40; i++) {
        ctx.globalAlpha = 0.08 + r() * 0.2
        ctx.fillStyle = i % 3 ? c.band : c.accent
        const y = r() * h, len = w * (0.3 + r() * 0.5), x = r() * w - len / 2, th = m * (0.003 + r() * 0.01)
        ctx.save(); ctx.translate(x, y); ctx.rotate(-0.35); ctx.fillRect(0, 0, len, th); ctx.restore()
      }
      break
    }
    case 'stadium': {
      // đường chạy điền kinh: các làn cong phía dưới
      ctx.fillStyle = c.band
      ctx.beginPath(); ctx.ellipse(w / 2, h * 1.18, w * 0.95, h * 0.5, 0, 0, Math.PI * 2); ctx.fill()
      ctx.strokeStyle = 'rgba(255,255,255,0.75)'; ctx.lineWidth = m * 0.004
      for (let i = 0; i < 6; i++) { ctx.beginPath(); ctx.ellipse(w / 2, h * 1.18, w * (0.95 - i * 0.05), h * (0.5 - i * 0.035), 0, Math.PI, Math.PI * 2); ctx.stroke() }
      ctx.fillStyle = c.bg
      ctx.beginPath(); ctx.ellipse(w / 2, h * 1.18, w * 0.64, h * 0.29, 0, 0, Math.PI * 2); ctx.fill()
      const tg = ctx.createLinearGradient(0, 0, 0, h * 0.6)
      tg.addColorStop(0, 'rgba(0,0,0,0.35)'); tg.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = tg; ctx.fillRect(0, 0, w, h * 0.6)
      break
    }
    case 'neon': {
      ctx.strokeStyle = c.band; ctx.globalAlpha = 0.22; ctx.lineWidth = 1.5
      const hy = h * 0.72
      for (let i = -12; i <= 12; i++) { ctx.beginPath(); ctx.moveTo(w / 2, hy); ctx.lineTo(w / 2 + i * w * 0.12, h); ctx.stroke() }
      for (let i = 0; i < 8; i++) { const y = hy + (h - hy) * Math.pow(i / 8, 1.8); ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke() }
      ctx.globalAlpha = 1
      ctx.shadowColor = c.accent; ctx.shadowBlur = m * 0.03; ctx.strokeStyle = c.accent; ctx.lineWidth = m * 0.004
      ctx.strokeRect(m * 0.04, m * 0.04, w - m * 0.08, h - m * 0.08)
      break
    }
    case 'gradient': {
      const g = ctx.createLinearGradient(0, 0, w, h)
      g.addColorStop(0, c.bg); g.addColorStop(1, c.band)
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h)
      ctx.globalAlpha = 0.2; ctx.fillStyle = c.accent
      ctx.beginPath(); ctx.arc(w * 0.9, h * 0.1, m * 0.45, 0, Math.PI * 2); ctx.fill()
      ctx.beginPath(); ctx.arc(w * 0.05, h * 0.92, m * 0.35, 0, Math.PI * 2); ctx.fill()
      break
    }
    case 'paper': {
      ctx.strokeStyle = c.band; ctx.lineWidth = m * 0.008; ctx.strokeRect(m * 0.035, m * 0.035, w - m * 0.07, h - m * 0.07)
      ctx.lineWidth = m * 0.002; ctx.strokeRect(m * 0.052, m * 0.052, w - m * 0.104, h - m * 0.104)
      break
    }
    case 'minimal':
      ctx.fillStyle = c.accent; ctx.fillRect(0, 0, w, m * 0.018)
      ctx.fillStyle = c.band; ctx.fillRect(0, h - m * 0.018, w, m * 0.018)
      break
  }
  ctx.restore()
}
