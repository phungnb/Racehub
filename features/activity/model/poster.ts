// Vẽ ảnh chia sẻ bài chạy lên canvas (chạy ở trình duyệt). Hai khổ: Story 9:16 và vuông 1:1.
import { formatDuration, formatKm, formatNumber, formatPace } from '@/shared/lib/format'
import { fitRoute, thin, type LatLng } from './route'

export type PosterFormat = 'story' | 'square'
export const POSTER_SIZE: Record<PosterFormat, { w: number; h: number }> = { story: { w: 1080, h: 1920 }, square: { w: 1080, h: 1080 } }

export interface PosterData {
  title: string
  startedAt: string
  distanceM: number
  movingS: number
  paceS: number
  elevationM: number
  name: string
  level: number | null
  route: LatLng[]
  /** Nhân vật đầy đủ (khung 900×1350), null = không vẽ */
  character: HTMLCanvasElement | null
  /** Tên miền hiện ở chân ảnh */
  site: string
  /** Bài lấy từ Strava → ghi "Powered by Strava" trên ảnh (bắt buộc theo Strava Brand Guidelines) */
  fromStrava?: boolean
}

const C = { bg1: '#0a0d12', bg2: '#141a24', brand: '#b6ff3b', fg: '#f2f5f9', muted: '#8b95a5', end: '#ff4d4f' }

function fonts() {
  const root = getComputedStyle(document.documentElement)
  const sans = root.getPropertyValue('--font-be-vietnam').trim() || 'system-ui, sans-serif'
  const mono = root.getPropertyValue('--font-jetbrains').trim() || 'ui-monospace, monospace'
  return { sans, mono }
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

/** Tự xuống dòng, tối đa `lines` dòng (dòng cuối có "…") */
function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number, lines: number): string[] {
  const words = text.split(/\s+/)
  const out: string[] = []
  let cur = ''
  for (const w of words) {
    const t = cur ? `${cur} ${w}` : w
    if (ctx.measureText(t).width <= maxW) { cur = t; continue }
    if (cur) out.push(cur)
    cur = w
    if (out.length === lines) break
  }
  if (out.length < lines && cur) out.push(cur)
  if (out.length === lines && words.join(' ') !== out.join(' ')) {
    let last = out[lines - 1]
    while (last && ctx.measureText(`${last}…`).width > maxW) last = last.slice(0, -1)
    out[lines - 1] = `${last.trimEnd()}…`
  }
  return out.slice(0, lines)
}

function drawRoute(ctx: CanvasRenderingContext2D, route: LatLng[], x: number, y: number, w: number, h: number) {
  const pts = fitRoute(thin(route, 800), w, h, 20).map(([px, py]) => [px + x, py + y] as const)
  if (pts.length < 2) return false
  const path = () => { ctx.beginPath(); pts.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py))) }
  ctx.save()
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  ctx.shadowColor = C.brand
  ctx.shadowBlur = 40
  ctx.strokeStyle = 'rgba(182,255,59,0.35)'
  ctx.lineWidth = 22
  path(); ctx.stroke()
  ctx.shadowBlur = 0
  ctx.strokeStyle = C.brand
  ctx.lineWidth = 10
  path(); ctx.stroke()
  const dot = ([px, py]: readonly [number, number], fill: string) => {
    ctx.beginPath(); ctx.arc(px, py, 16, 0, Math.PI * 2); ctx.fillStyle = C.bg1; ctx.fill()
    ctx.beginPath(); ctx.arc(px, py, 10, 0, Math.PI * 2); ctx.fillStyle = fill; ctx.fill()
  }
  dot(pts[0], C.brand)
  dot(pts[pts.length - 1], C.end)
  ctx.restore()
  return true
}

/** Nhân vật trong thẻ bo góc (cắt giữa khung cho vừa tỉ lệ thẻ) */
function drawCharacter(ctx: CanvasRenderingContext2D, img: HTMLCanvasElement, x: number, y: number, w: number, h: number) {
  const r = img.width / img.height, rt = w / h
  const sw = rt < r ? img.height * rt : img.width
  const sh = rt < r ? img.height : img.width / rt
  ctx.save()
  roundRect(ctx, x, y, w, h, 40)
  ctx.clip()
  ctx.drawImage(img, (img.width - sw) / 2, 0, sw, sh, x, y, w, h)
  // Mờ dần phía dưới cho hòa vào nền
  const g = ctx.createLinearGradient(0, y + h * 0.7, 0, y + h)
  g.addColorStop(0, 'rgba(10,13,18,0)')
  g.addColorStop(1, 'rgba(10,13,18,0.85)')
  ctx.fillStyle = g
  ctx.fillRect(x, y, w, h)
  ctx.restore()
  ctx.save()
  roundRect(ctx, x, y, w, h, 40)
  ctx.lineWidth = 4
  ctx.strokeStyle = 'rgba(182,255,59,0.6)'
  ctx.stroke()
  ctx.restore()
}

export async function drawPoster(canvas: HTMLCanvasElement, d: PosterData, format: PosterFormat) {
  await document.fonts?.ready
  const { w: W, h: H } = POSTER_SIZE[format]
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')!
  const { sans, mono } = fonts()
  const story = format === 'story'
  const M = 80

  // Nền
  const bg = ctx.createLinearGradient(0, 0, 0, H)
  bg.addColorStop(0, C.bg2)
  bg.addColorStop(1, C.bg1)
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, W, H)
  const glow = ctx.createRadialGradient(W * 0.5, H * (story ? 0.3 : 0.35), 0, W * 0.5, H * (story ? 0.3 : 0.35), W * 0.7)
  glow.addColorStop(0, 'rgba(182,255,59,0.14)')
  glow.addColorStop(1, 'rgba(182,255,59,0)')
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, W, H)

  // Đầu trang: logo + ngày
  ctx.textBaseline = 'alphabetic'
  ctx.font = `800 56px ${sans}`
  ctx.fillStyle = C.fg
  ctx.fillText('RACE', M, 120)
  ctx.fillStyle = C.brand
  ctx.fillText('HUB', M + ctx.measureText('RACE').width, 120)
  const date = new Date(d.startedAt).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Asia/Ho_Chi_Minh' })
  ctx.font = `500 34px ${sans}`
  ctx.fillStyle = C.muted
  ctx.textAlign = 'right'
  ctx.fillText(date, W - M, 118)
  ctx.textAlign = 'left'

  // Vùng tuyến chạy
  const routeBox = story ? { x: M, y: 180, w: W - 2 * M, h: 800 } : { x: M, y: 160, w: d.character ? 560 : W - 2 * M, h: 420 }
  const hasRoute = drawRoute(ctx, d.route, routeBox.x, routeBox.y, routeBox.w, routeBox.h)
  if (!hasRoute) {
    // Không có bản đồ: chữ km lớn làm điểm nhấn
    ctx.font = `800 ${story ? 420 : 260}px ${mono}`
    ctx.fillStyle = 'rgba(182,255,59,0.07)'
    ctx.textAlign = 'center'
    ctx.fillText(formatKm(d.distanceM), W / 2, routeBox.y + routeBox.h * 0.72)
    ctx.textAlign = 'left'
  }

  // Nhân vật
  const charBox = story ? { x: 620, y: 1030, w: 380, h: 660 } : { x: 700, y: 160, w: 300, h: 440 }
  if (d.character) drawCharacter(ctx, d.character, charBox.x, charBox.y, charBox.w, charBox.h)

  // Số liệu
  const statW = story && d.character ? 480 : W - 2 * M
  let y = story ? 1090 : 650
  ctx.font = `700 ${story ? 44 : 38}px ${sans}`
  ctx.fillStyle = C.fg
  for (const line of wrap(ctx, d.title, statW, 2)) { ctx.fillText(line, M, y); y += story ? 54 : 46 }
  // Số km lớn: tự thu nhỏ cho vừa cột (không đè lên nhân vật)
  const km = formatKm(d.distanceM)
  ctx.font = `700 ${story ? 52 : 44}px ${sans}`
  const unitW = ctx.measureText('km').width + 12
  let size = story ? 170 : 130
  ctx.font = `800 ${size}px ${mono}`
  while (size > 60 && ctx.measureText(km).width + unitW > statW) { size -= 6; ctx.font = `800 ${size}px ${mono}` }
  y += size * 0.78
  ctx.fillStyle = C.brand
  ctx.fillText(km, M - 4, y)
  const kmW = ctx.measureText(km).width
  ctx.font = `700 ${story ? 52 : 44}px ${sans}`
  ctx.fillStyle = C.fg
  ctx.fillText('km', M + kmW + 8, y)

  const stats: [string, string][] = [
    ['Pace', `${formatPace(d.paceS)} /km`],
    ['Thời gian', formatDuration(d.movingS)],
    ['Leo dốc', `${formatNumber(Math.round(d.elevationM))} m`],
  ]
  if (story) {
    y += 80
    for (const [label, value] of stats) {
      ctx.font = `500 28px ${sans}`
      ctx.fillStyle = C.muted
      ctx.fillText(label, M, y)
      ctx.font = `700 48px ${mono}`
      ctx.fillStyle = C.fg
      ctx.fillText(value, M, y + 54)
      y += 116
    }
  } else {
    y += 70
    const colW = (W - 2 * M) / 3
    stats.forEach(([label, value], i) => {
      ctx.font = `500 28px ${sans}`
      ctx.fillStyle = C.muted
      ctx.fillText(label, M + i * colW, y)
      ctx.font = `700 42px ${mono}`
      ctx.fillStyle = C.fg
      ctx.fillText(value, M + i * colW, y + 50)
    })
  }

  // Chân trang
  ctx.fillStyle = 'rgba(255,255,255,0.08)'
  ctx.fillRect(M, H - (story ? 130 : 96), W - 2 * M, 2)
  const fy = H - (story ? 70 : 44)
  ctx.font = `700 34px ${sans}`
  ctx.fillStyle = C.fg
  const who = d.level ? `${d.name} · Lv.${d.level}` : d.name
  ctx.fillText(wrap(ctx, who, W * 0.55, 1)[0] ?? '', M, fy)
  ctx.font = `600 30px ${sans}`
  ctx.fillStyle = C.brand
  ctx.textAlign = 'right'
  ctx.fillText(d.site, W - M, fy)
  if (d.fromStrava) {
    ctx.font = `700 24px ${sans}`
    ctx.fillStyle = '#FC5200'
    ctx.fillText('Powered by Strava', W - M, fy - (story ? 42 : 36))
  }
  ctx.textAlign = 'left'
}

export const posterFileName = (startedAt: string) => `racehub-${new Date(startedAt).toISOString().slice(0, 10)}.png`
