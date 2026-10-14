import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { parseRacePage } from './race-import'
import { extractEventLinks, screenCandidate } from './race-scan'
import { FetchError, fetchHtml, robotsAllows } from './safe-fetch'

// Quét MỘT nguồn: tải trang lịch → lấy liên kết → tải từng trang mới → đọc + sàng lọc → ghi vào hàng chờ (race_candidates).
// Không đăng gì. Lịch sự với trang nguồn: tôn trọng robots.txt, tối đa MAX_PAGES trang mới / nguồn / lần, tuần tự có nghỉ.
const MAX_PAGES = 12
const PAUSE_MS = 700
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export interface ScanResult { source_id: string; found: number; pending: number; filtered: number; error: string | null }

export async function scanSource(db: SupabaseClient, src: { id: string; url: string }, deadlineMs: number): Promise<ScanResult> {
  const out: ScanResult = { source_id: src.id, found: 0, pending: 0, filtered: 0, error: null }
  try {
    const { html, url: base } = await fetchHtml(src.url)
    if (!(await robotsAllows(base))) throw new FetchError('BAD_URL')
    const links = extractEventLinks(html, base)
    if (links.length) {
      const [{ data: seenC }, { data: seenL }] = await Promise.all([
        db.from('race_candidates').select('url').in('url', links),
        db.from('race_listings').select('source_url,reg_url').or(`source_url.in.(${links.map((l) => `"${l}"`).join(',')}),reg_url.in.(${links.map((l) => `"${l}"`).join(',')})`),
      ])
      const seen = new Set<string>([...(seenC ?? []).map((r: { url: string }) => r.url.toLowerCase()),
        ...(seenL ?? []).flatMap((r: { source_url: string | null; reg_url: string | null }) => [r.source_url, r.reg_url]).filter((x): x is string => !!x).map((x) => x.toLowerCase())])
      const fresh = links.filter((l) => !seen.has(l.toLowerCase())).slice(0, MAX_PAGES)
      for (const link of fresh) {
        if (Date.now() > deadlineMs) break
        try {
          const page = await fetchHtml(link, { timeoutMs: 6000 })
          if (!(await robotsAllows(page.url))) continue
          const d = parseRacePage(page.html)
          const s = screenCandidate(d, Date.now())
          const { error } = await db.from('race_candidates').insert({
            source_id: src.id, url: page.url.toString(), title: d.title, race_date: d.race_date || null, end_date: d.end_date || null,
            location: d.location || null, organizer: d.organizer || null, image_url: /^https?:\/\//i.test(d.image_url) ? d.image_url : null,
            description: d.description || null, distances: d.distances, score: s.score, status: s.status, filter_reason: s.reason,
          })
          if (!error) { out.found++; if (s.status === 'PENDING') out.pending++; else out.filtered++ }
        } catch { /* trang lỗi: bỏ qua, lần sau thử lại */ }
        await sleep(PAUSE_MS)
      }
    }
  } catch (e) {
    out.error = e instanceof FetchError ? e.code : 'SCAN_FAILED'
  }
  await db.from('race_sources').update({ last_scanned_at: new Date().toISOString(), last_error: out.error }).eq('id', src.id)
  return out
}
