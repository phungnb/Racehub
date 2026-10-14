import 'server-only'

// Tìm kiếm web bằng Tavily (TAVILY_API_KEY, gói miễn phí 1.000 lượt / tháng, không cần thẻ).
// Google Programmable Search API đã đóng cho khách hàng mới; Brave Search API không còn gói miễn phí.
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

async function tavily(key: string, query: string, count: number): Promise<string[]> {
  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST', signal: AbortSignal.timeout(15_000),
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({ query, search_depth: 'basic', max_results: Math.min(count, 20), country: 'vietnam' }),
  }).catch(() => null)
  if (!res) throw new SearchError('SEARCH_FAILED')
  if (res.status === 429 || res.status === 432 || res.status === 433) throw new SearchError('SEARCH_LIMIT')
  if (!res.ok) throw new SearchError('SEARCH_FAILED')
  const j = (await res.json().catch(() => null)) as { results?: { url?: string }[] } | null
  return usableResultUrls((j?.results ?? []).map((r) => r.url ?? ''), count)
}

export async function searchWeb(query: string, count = 20): Promise<string[]> {
  const key = process.env.TAVILY_API_KEY?.trim()
  if (!key) throw new SearchError('NO_SEARCH_KEY')
  return tavily(key, query, count)
}
