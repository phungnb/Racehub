// Vẽ VÙNG QUAY lên canvas để ghi video (chỉnh sửa lần 7): tên lượt quay, giải đang quay, ô quay (tên chạy / người trúng),
// bảng người trúng, mã cam kết. Không vẽ nút bấm nào (Chấp nhận / Huỷ kết quả, thanh công cụ) — video chỉ có màn hình quay.
// Không vẽ ảnh đại diện: ảnh từ nguồn khác làm canvas "bẩn" → trình duyệt chặn ghi.
import type { DrawWinner, LuckyDraw } from '../api/drawApi'
import type { PrizeProgress } from '../model/stage'

export interface StageSnapshot {
  d: LuckyDraw
  progress: PrizeProgress[]
  phase: 'idle' | 'spinning' | 'landed'
  shown: DrawWinner | null
  reel: { name: string; n: number } | null
  curName: string | null
  /** Lần cuối có người trúng mới (ms) — làm hiệu ứng sáng lên vài giây */
  landedAt: number
}

const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'

function cssColor(name: string, fallback: string) {
  if (typeof document === 'undefined') return fallback
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || fallback
}

/** Cỡ chữ lớn nhất ≤ max để vừa chiều rộng */
function fit(ctx: CanvasRenderingContext2D, text: string, max: number, width: number, weight = 800) {
  let size = max
  for (; size > 14; size -= 2) {
    ctx.font = `${weight} ${size}px ${FONT}`
    if (ctx.measureText(text).width <= width) break
  }
  return size
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

export function paintStage(ctx: CanvasRenderingContext2D, W: number, H: number, s: StageSnapshot, now = Date.now()) {
  const coin = cssColor('--color-coin', '#f5b301')
  const { d } = s
  // Nền
  ctx.fillStyle = '#07090d'
  ctx.fillRect(0, 0, W, H)
  const g = ctx.createRadialGradient(W / 2, 0, 0, W / 2, 0, H * 0.9)
  g.addColorStop(0, 'rgba(245,179,1,0.22)')
  g.addColorStop(1, 'rgba(245,179,1,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, W, H)

  // Đầu: tên lượt quay, trực tiếp, nhà tài trợ
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'
  ctx.fillStyle = '#fff'
  ctx.font = `700 ${fit(ctx, d.title, 34, W * 0.6, 700)}px ${FONT}`
  ctx.fillText(d.title, 40, 48)
  const won = d.winners.filter((w) => w.status === 'WON').length
  const total = s.progress.reduce((a, p) => a + p.qty, 0)
  ctx.font = `500 20px ${FONT}`
  ctx.fillStyle = 'rgba(255,255,255,0.6)'
  const live = d.status === 'LIVE'
  if (live) {
    ctx.fillStyle = '#ff4d5e'
    ctx.beginPath(); ctx.arc(46, 88, 6, 0, Math.PI * 2); ctx.fill()
    ctx.font = `800 20px ${FONT}`
    ctx.fillText('TRỰC TIẾP', 60, 88)
  }
  ctx.font = `500 20px ${FONT}`
  ctx.fillStyle = 'rgba(255,255,255,0.6)'
  ctx.fillText(`${d.entrant_count ?? d.eligible_now ?? 0} người trong danh sách · ${won}/${total} suất đã trao`, live ? 180 : 40, 88)
  if (d.sponsor?.name) {
    ctx.textAlign = 'right'
    ctx.font = `600 22px ${FONT}`
    ctx.fillStyle = 'rgba(255,255,255,0.8)'
    ctx.fillText(`Tài trợ: ${d.sponsor.name}`, W - 40, 48)
  }

  // Giải đang quay
  const pending = d.status === 'PENDING'
  const label = s.shown ? s.shown.prize : (d.status === 'DONE' || pending) && s.phase === 'idle' ? 'KẾT QUẢ' : s.curName ?? 'Đã trao hết giải'
  ctx.textAlign = 'center'
  ctx.fillStyle = coin
  ctx.font = `800 ${fit(ctx, label.toUpperCase(), 30, W * 0.8)}px ${FONT}`
  ctx.fillText(label.toUpperCase(), W / 2, H * 0.24)

  // Ô quay
  const bx = W * 0.1, by = H * 0.31, bw = W * 0.8, bh = H * 0.34
  const landed = s.phase === 'landed' && !!s.shown
  const glow = landed ? Math.max(0, 1 - (now - s.landedAt) / 4000) : 0
  roundRect(ctx, bx, by, bw, bh, 36)
  ctx.fillStyle = landed ? 'rgba(245,179,1,0.10)' : 'rgba(255,255,255,0.04)'
  ctx.fill()
  ctx.lineWidth = 4
  ctx.strokeStyle = landed ? coin : 'rgba(255,255,255,0.15)'
  if (glow > 0) { ctx.shadowColor = coin; ctx.shadowBlur = 60 * glow }
  ctx.stroke()
  ctx.shadowBlur = 0
  const cy = by + bh / 2
  if (landed && s.shown) {
    ctx.fillStyle = '#fff'
    ctx.font = `800 ${fit(ctx, s.shown.name, 96, bw - 60)}px ${FONT}`
    ctx.fillText(s.shown.name, W / 2, cy - 18)
    ctx.fillStyle = coin
    ctx.font = `700 30px ${FONT}`
    ctx.fillText('Chúc mừng! 🎉', W / 2, cy + 58)
  } else if (s.reel) {
    ctx.fillStyle = 'rgba(255,255,255,0.9)'
    ctx.font = `800 ${fit(ctx, s.reel.name, 96, bw - 60)}px ${FONT}`
    ctx.fillText(s.reel.name, W / 2, cy)
  } else {
    const t = pending ? 'Chờ ban tổ chức xác nhận' : d.status === 'DONE' ? 'Đã công bố' : d.status === 'READY' ? 'Chuẩn bị quay' : 'Sẵn sàng'
    ctx.fillStyle = 'rgba(255,255,255,0.4)'
    ctx.font = `700 ${fit(ctx, t, 60, bw - 60, 700)}px ${FONT}`
    ctx.fillText(t, W / 2, cy)
  }

  // Bảng người trúng: tối đa 8 người gần nhất
  const list = d.winners.filter((w) => w.status === 'WON').sort((a, b) => b.position - a.position).slice(0, 8)
  if (list.length) {
    ctx.textAlign = 'left'
    const top = H * 0.71, colW = (W - 80) / 2
    list.forEach((w, i) => {
      const x = 40 + (i % 2) * colW, y = top + Math.floor(i / 2) * 34
      ctx.fillStyle = coin
      ctx.font = `700 18px ${FONT}`
      const p = `${w.prize}: `
      ctx.fillText(p, x, y)
      const pw = ctx.measureText(p).width
      ctx.fillStyle = '#fff'
      ctx.font = `600 ${fit(ctx, w.name, 20, colW - pw - 20, 600)}px ${FONT}`
      ctx.fillText(w.name, x + pw, y)
    })
  }

  // Chân: mã cam kết + giờ ghi (để đối chiếu video với kết quả)
  ctx.textAlign = 'left'
  ctx.font = `500 16px ${FONT}`
  ctx.fillStyle = 'rgba(255,255,255,0.5)'
  ctx.fillText(d.seed_hash ? `Mã cam kết: ${d.seed_hash}` : 'Thứ tự trúng do máy chủ chốt khi bắt đầu', 40, H - 30)
  ctx.textAlign = 'right'
  ctx.fillText(`RaceHub · ${new Date(now).toLocaleString('vi-VN')}`, W - 40, H - 30)
}
