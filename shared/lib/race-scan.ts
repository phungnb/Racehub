import type { RaceDraft } from './race-import'

// Quét nguồn giải → ứng viên → sàng lọc (hàm thuần). Kết quả chỉ vào HÀNG CHỜ; admin duyệt mới đăng.
export type CandidateStatus = 'PENDING' | 'FILTERED'
export interface Screened { status: CandidateStatus; score: number; reason: string | null }

const SKIP_EXT = /\.(?:jpe?g|png|gif|webp|svg|pdf|zip|docx?|xlsx?|css|js|mp4|mp3)(?:$|\?)/i
const SKIP_PATH = /\/(?:login|dang-nhap|dang-ky|register|cart|gio-hang|tag|category|author|feed|wp-json|wp-admin|search|tim-kiem|contact|lien-he)(?:\/|$)/i

/** Liên kết cùng tên miền trong trang nguồn, bỏ trùng và rác, tối đa `limit`. Ưu tiên đường dẫn có từ khóa giải chạy. */
export function extractEventLinks(html: string, base: URL, limit = 30): string[] {
  const seen = new Set<string>()
  const hits: { url: string; rank: number }[] = []
  for (const m of html.matchAll(/<a\b[^>]*?href\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
    let u: URL
    try { u = new URL((m[1] ?? m[2] ?? '').trim(), base) } catch { continue }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') continue
    if (u.hostname.replace(/^www\./, '') !== base.hostname.replace(/^www\./, '')) continue
    u.hash = ''
    const key = u.toString()
    if (seen.has(key) || key === base.toString() || u.pathname === '/' || SKIP_EXT.test(u.pathname + u.search) || SKIP_PATH.test(u.pathname)) continue
    seen.add(key)
    hits.push({ url: key, rank: /marathon|run|race|giai|chay|trail|event|su-kien/i.test(u.pathname) ? 0 : 1 })
  }
  return hits.sort((a, b) => a.rank - b.rank).slice(0, limit).map((h) => h.url)
}

const RACEY = /marathon|half\s*marathon|trail|ultra|giải\s*chạy|chạy\s*bộ|\brun\b|running|\brace\b|\b\d{1,3}\s*k(?:m)?\b|bán\s*marathon/i

/** Sàng lọc tự động: loại trang không phải giải chạy, thiếu ngày, đã qua hoặc quá xa. Bị loại vẫn lưu (FILTERED) để admin cứu lại. */
export function screenCandidate(d: RaceDraft, nowMs: number): Screened {
  const filtered = (reason: string): Screened => ({ status: 'FILTERED', score: 0, reason })
  if (d.title.trim().length < 3) return filtered('Thiếu tên')
  if (!RACEY.test(`${d.title} ${d.description}`)) return filtered('Không giống giải chạy')
  if (!d.race_date) return filtered('Không đọc được ngày')
  const t = Date.parse(`${d.race_date}T00:00:00+07:00`)
  if (Number.isNaN(t)) return filtered('Ngày không hợp lệ')
  if (t < nowMs - 86_400_000) return filtered('Giải đã diễn ra')
  if (t > nowMs + 540 * 86_400_000) return filtered('Ngày quá xa (>18 tháng)')
  const score = 40 + (d.distances.length ? 20 : 0) + (d.location ? 15 : 0) + (d.image_url ? 10 : 0) + (d.organizer ? 10 : 0) + (d.description ? 5 : 0)
  return { status: 'PENDING', score, reason: null }
}
