// Hình học họa tiết (vẽ trong hộp bao của vùng mặt nạ, toạ độ cục bộ 0..w, 0..h). Chỉ vẽ độ phủ (trắng / trong suốt);
// màu + nếp vải do PaperDoll áp lại bằng tintPixel nên họa tiết "ăn" vào vải như màu nền.
import type { Gender, PatternKind, TintSlot } from './catalog'

export function drawPattern(c: CanvasRenderingContext2D, slot: TintSlot, kind: PatternKind, w: number, h: number, gender: Gender = 'male') {
  c.fillStyle = '#fff'
  c.strokeStyle = '#fff'
  switch (kind) {
    case 'sides':
      if (slot === 'bottom') { c.fillRect(w * 0.02, 0, w * 0.07, h); c.fillRect(w * 0.91, 0, w * 0.07, h) }
      // áo nam có tay: viền từ nách xuống, sát mép thân; áo nữ (ba lỗ): sát mép hộp
      else if (gender === 'male') { c.fillRect(w * 0.165, h * 0.3, w * 0.055, h); c.fillRect(w * 0.78, h * 0.3, w * 0.055, h) }
      else { c.fillRect(0, h * 0.25, w * 0.1, h); c.fillRect(w * 0.9, h * 0.25, w * 0.1, h) }
      break
    case 'shoulders':
      c.fillRect(0, 0, w, h * 0.2)
      break
    case 'sash':
      c.save(); c.translate(w / 2, h * 0.45); c.rotate(-Math.PI / 4.6); c.fillRect(-w, -h * 0.07, 2 * w, h * 0.14); c.restore()
      break
    case 'chevron':
      c.lineWidth = h * 0.07; c.lineJoin = 'miter'
      c.beginPath(); c.moveTo(-w * 0.05, h * 0.16); c.lineTo(w / 2, h * 0.42); c.lineTo(w * 1.05, h * 0.16); c.stroke()
      break
    case 'hoops': {
      const n = slot === 'socks' ? 3 : 6
      const top = slot === 'socks' ? 0.04 : 0.12
      const span = slot === 'socks' ? 0.4 : 0.88
      for (let k = 0; k < n; k++) if (k % 2 === 0) c.fillRect(0, h * (top + (span * k) / n), w, (h * span) / n)
      break
    }
    case 'stripes':
      for (let x = w * 0.04; x < w; x += w / 9) c.fillRect(x, 0, w / 24, h)
      break
    case 'half':
      c.fillRect(w / 2, 0, w / 2, h)
      break
    case 'gradient': {
      const g = c.createLinearGradient(0, h * 0.3, 0, h)
      g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(255,255,255,1)')
      c.fillStyle = g; c.fillRect(0, 0, w, h)
      break
    }
    case 'hem':
      c.fillRect(0, h * 0.84, w, h * 0.16)
      break
    case 'band':
      c.fillRect(0, 0, w, h * 0.2)
      break
  }
}
