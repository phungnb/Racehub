// Đọc thông tin giải từ HTML trang BTC (hàm thuần, chạy ở máy chủ). Chỉ gợi ý để admin chỉnh rồi lưu — không tự đăng.
export interface RaceDraft {
  title: string
  race_date: string
  end_date: string
  location: string
  organizer: string
  image_url: string
  description: string
  distances: string[]
}

const decode = (s: string) =>
  s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Math.min(Number(n), 0x10ffff))).trim()

function meta(html: string, key: string): string {
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = m[0]
    const k = /(?:property|name)\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]?.toLowerCase()
    if (k !== key) continue
    const c = /content\s*=\s*"([^"]*)"|content\s*=\s*'([^']*)'/i.exec(tag)
    if (c) return decode(c[1] ?? c[2] ?? '')
  }
  return ''
}

const isoDate = (v: unknown): string => {
  const m = typeof v === 'string' ? /^(\d{4})-(\d{2})-(\d{2})/.exec(v) : null
  return m ? `${m[1]}-${m[2]}-${m[3]}` : ''
}

type Json = Record<string, unknown>
function findEvent(node: unknown): Json | null {
  if (Array.isArray(node)) { for (const x of node) { const r = findEvent(x); if (r) return r } return null }
  if (!node || typeof node !== 'object') return null
  const o = node as Json
  const t = o['@type']
  const types = Array.isArray(t) ? t : [t]
  if (types.some((x) => typeof x === 'string' && /Event$/.test(x))) return o
  return findEvent(o['@graph'])
}
const str = (v: unknown): string => (typeof v === 'string' ? v : '')

/** Cự ly thường gặp trong tiêu đề / mô tả: 5K, 10km, 21K, HM, 42K, FM… */
export function guessDistances(text: string): string[] {
  const out = new Set<string>()
  for (const m of text.matchAll(/\b(\d{1,3}(?:[.,]\d)?)\s*(?:k|km)\b/gi)) {
    const n = Number(m[1].replace(',', '.'))
    if (n >= 1 && n <= 250) out.add(`${n}K`)
  }
  if (/half\s*marathon|\bHM\b/i.test(text)) out.add('21K')
  if (/full\s*marathon|\bFM\b/i.test(text)) out.add('42K')
  return [...out].sort((a, b) => parseFloat(a) - parseFloat(b)).slice(0, 8)
}

export function parseRacePage(html: string): RaceDraft {
  let ev: Json | null = null
  for (const m of html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { ev = findEvent(JSON.parse(m[1])); if (ev) break } catch { /* bỏ qua khối JSON-LD hỏng */ }
  }
  const titleTag = decode(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '')
  const loc = ev?.location as Json | undefined
  const addr = loc?.address
  const place = [str(loc?.name), typeof addr === 'string' ? addr : str((addr as Json | undefined)?.streetAddress), str((addr as Json | undefined)?.addressLocality)].filter(Boolean).join(', ')
  const org = ev?.organizer as Json | undefined
  const img = ev?.image
  const title = decode(str(ev?.name) || meta(html, 'og:title') || titleTag).slice(0, 160)
  const description = decode(str(ev?.description) || meta(html, 'og:description') || meta(html, 'description')).slice(0, 3000)
  return {
    title,
    race_date: isoDate(ev?.startDate),
    end_date: isoDate(ev?.endDate),
    location: place.slice(0, 200),
    organizer: (str(org?.name) || meta(html, 'og:site_name')).slice(0, 160),
    image_url: (typeof img === 'string' ? img : Array.isArray(img) ? str(img[0]) : str((img as Json | undefined)?.url)) || meta(html, 'og:image'),
    description,
    distances: guessDistances(`${title} ${description}`),
  }
}
