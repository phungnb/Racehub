import 'server-only'

// Tìm kiếm web bằng Brave Search API (khóa BRAVE_SEARCH_API_KEY, gói miễn phí ~2.000 lượt / tháng).
// Google Programmable Search API đã đóng cho khách hàng mới, nên không dùng.
export class SearchError extends Error {
  constructor(public code: 'NO_SEARCH_KEY' | 'SEARCH_FAILED' | 'SEARCH_LIMIT') { super(code) }
}

// Mạng xã hội / video: không đọc được bằng tải trang thường
const SKIP_HOST = /(^|\.)(facebook|fb|instagram|tiktok|youtube|youtu|twitter|x|pinterest|zalo|linkedin|reddit|google|bing)\.(com|be|me|vn)$/i

export function usableResultUrls(urls: string[], limit: number): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of urls) {
    let u: URL
    try { u = new URL(raw) } catch { continue }
    if ((u.protocol !== 'https:' && u.protocol !== 'http:') || SKIP_HOST.test(u.hostname) || /\.(pdf|jpe?g|png|zip|docx?|xlsx?)$/i.test(u.pathname)) continue
    u.hash = ''
    const k = u.toString()
    if (seen.has(k)) continue
    seen.add(k); out.push(k)
    if (out.length >= limit) break
  }
  return out
}

export async function searchWeb(query: string, count = 20): Promise<string[]> {
  const key = process.env.BRAVE_SEARCH_API_KEY?.trim()
  if (!key) throw new SearchError('NO_SEARCH_KEY')
  const url = new URL('https://api.search.brave.com/res/v1/web/search')
  url.searchParams.set('q', query)
  url.searchParams.set('count', String(Math.min(count, 20)))
  url.searchParams.set('country', 'vn')
  url.searchParams.set('search_lang', 'vi')
  url.searchParams.set('safesearch', 'moderate')
  const res = await fetch(url, { headers: { accept: 'application/json', 'x-subscription-token': key }, signal: AbortSignal.timeout(10_000) }).catch(() => null)
  if (!res) throw new SearchError('SEARCH_FAILED')
  if (res.status === 429) throw new SearchError('SEARCH_LIMIT')
  if (!res.ok) throw new SearchError('SEARCH_FAILED')
  const j = (await res.json().catch(() => null)) as { web?: { results?: { url?: string }[] } } | null
  return usableResultUrls((j?.web?.results ?? []).map((r) => r.url ?? ''), count)
}
