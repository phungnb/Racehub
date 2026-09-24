// Giấy chứng nhận hoàn thành giải chạy ảo (vẽ canvas ở trình duyệt, khổ 4:5 hợp chia sẻ mạng xã hội)
import { distanceLabel, racePace, raceTime } from './race'

export interface CertificateData {
  race: string
  organizer: string
  name: string
  bib: string
  distanceKm: number
  timeS: number
  rank: number | null
  finishers: number
  date: string
  site: string
}

export const CERT_SIZE = { w: 1080, h: 1350 }

function fonts() {
  const root = getComputedStyle(document.documentElement)
  return {
    sans: root.getPropertyValue('--font-be-vietnam').trim() || 'system-ui, sans-serif',
    mono: root.getPropertyValue('--font-jetbrains').trim() || 'ui-monospace, monospace',
  }
}

/** Co chữ cho vừa bề ngang */
function fit(ctx: CanvasRenderingContext2D, text: string, font: (px: number) => string, start: number, maxW: number) {
  let px = start
  ctx.font = font(px)
  while (ctx.measureText(text).width > maxW && px > 18) { px -= 2; ctx.font = font(px) }
  return px
}

export function drawCertificate(canvas: HTMLCanvasElement, d: CertificateData) {
  const { w, h } = CERT_SIZE
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  const { sans, mono } = fonts()
  const brand = '#b6ff3b', gold = '#ffc53d', fg = '#f2f5f9', muted = '#8b95a5'

  const bg = ctx.createLinearGradient(0, 0, w, h)
  bg.addColorStop(0, '#0e131b'); bg.addColorStop(1, '#05070a')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, w, h)
  // vệt chéo tốc độ
  ctx.save()
  ctx.globalAlpha = 0.08
  ctx.fillStyle = brand
  for (let i = 0; i < 6; i++) {
    ctx.beginPath()
    ctx.moveTo(-200 + i * 260, h)
    ctx.lineTo(80 + i * 260, h)
    ctx.lineTo(560 + i * 260, 0)
    ctx.lineTo(280 + i * 260, 0)
    ctx.fill()
  }
  ctx.restore()
  // khung viền
  ctx.strokeStyle = 'rgba(182,255,59,0.55)'
  ctx.lineWidth = 4
  ctx.strokeRect(40, 40, w - 80, h - 80)
  ctx.strokeStyle = 'rgba(182,255,59,0.18)'
  ctx.lineWidth = 2
  ctx.strokeRect(56, 56, w - 112, h - 112)

  ctx.textAlign = 'center'
  ctx.fillStyle = brand
  ctx.font = `800 34px ${sans}`
  ctx.fillText('RACEHUB', w / 2, 150)
  ctx.fillStyle = muted
  ctx.font = `600 30px ${sans}`
  ctx.fillText('GIẤY CHỨNG NHẬN HOÀN THÀNH', w / 2, 215)

  ctx.fillStyle = fg
  fit(ctx, d.race, (px) => `800 ${px}px ${sans}`, 58, w - 200)
  ctx.fillText(d.race, w / 2, 320)
  ctx.fillStyle = muted
  ctx.font = `500 28px ${sans}`
  ctx.fillText(`Tổ chức bởi ${d.organizer}`, w / 2, 372)

  ctx.fillStyle = muted
  ctx.font = `500 30px ${sans}`
  ctx.fillText('Chứng nhận vận động viên', w / 2, 480)
  ctx.fillStyle = gold
  fit(ctx, d.name, (px) => `800 ${px}px ${sans}`, 84, w - 180)
  ctx.fillText(d.name, w / 2, 575)
  ctx.fillStyle = fg
  ctx.font = `600 32px ${mono}`
  ctx.fillText(`BIB ${d.bib}`, w / 2, 630)

  ctx.fillStyle = muted
  ctx.font = `500 30px ${sans}`
  ctx.fillText('đã hoàn thành cự ly', w / 2, 720)
  ctx.fillStyle = brand
  ctx.font = `900 96px ${sans}`
  ctx.fillText(distanceLabel(d.distanceKm), w / 2, 820)

  // 3 ô số liệu
  const stats: [string, string][] = [
    ['Thành tích', raceTime(d.timeS)],
    ['Pace', racePace(d.timeS / d.distanceKm)],
    ['Hạng', d.rank ? `${d.rank}/${d.finishers}` : '—'],
  ]
  const bw = 290, gap = 25, x0 = (w - bw * 3 - gap * 2) / 2
  stats.forEach(([label, value], i) => {
    const x = x0 + i * (bw + gap)
    ctx.fillStyle = 'rgba(255,255,255,0.05)'
    ctx.beginPath()
    ctx.roundRect(x, 900, bw, 170, 28)
    ctx.fill()
    ctx.fillStyle = muted
    ctx.font = `600 26px ${sans}`
    ctx.fillText(label, x + bw / 2, 955)
    ctx.fillStyle = fg
    fit(ctx, value, (px) => `800 ${px}px ${mono}`, 54, bw - 30)
    ctx.fillText(value, x + bw / 2, 1030)
  })

  ctx.fillStyle = muted
  ctx.font = `500 28px ${sans}`
  ctx.fillText(d.date, w / 2, 1160)
  ctx.fillStyle = 'rgba(182,255,59,0.8)'
  ctx.font = `600 26px ${sans}`
  ctx.fillText(d.site, w / 2, 1250)
}
