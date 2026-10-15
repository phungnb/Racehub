import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { ExtractError, candidateKey, extractRaces, extractionEnabled } from './race-extract'
import { parseRacePage } from './race-import'
import { extractEventLinks, screenCandidate } from './race-scan'
import { FetchError, fetchHtml, robotsAllows } from './safe-fetch'
import { SearchError, searchWeb } from './web-search'

// Quét MỘT nguồn: tải trang lịch → lấy liên kết → tải từng trang mới → đọc + sàng lọc → ghi vào hàng chờ (race_candidates).
// Không đăng gì. Lịch sự với trang nguồn: tôn trọng robots.txt, tối đa MAX_PAGES trang mới / nguồn / lần, tuần tự có nghỉ.
const MAX_PAGES = 12
const PAUSE_MS = 700
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

interface ScanResult { source_id: string; found: number; pending: number; filtered: number; error: string | null }

type Source = { id: string; url: string | null; kind?: string | null; query?: string | null }

export async function scanSource(db: SupabaseClient, src: Source, deadlineMs: number): Promise<ScanResult> {
  const out: ScanResult = { source_id: src.id, found: 0, pending: 0, filtered: 0, error: null }
  try {
    let links: string[]
    if (src.kind === 'SEARCH') {
      links = await searchWeb(src.query ?? '')
    } else {
      const { html, url: base } = await fetchHtml(src.url ?? '')
      if (!(await robotsAllows(base))) throw new FetchError('BAD_URL')
      links = extractEventLinks(html, base)
      // Có AI: đọc chính trang này trước (bài tổng hợp 16 giải = 16 dòng), rồi mới đến các trang con
      if (extractionEnabled()) links = [base.toString(), ...links.filter((l) => l !== base.toString())]
    }
    await ingestLinks(db, src.id, links, deadlineMs, out)
  } catch (e) {
    out.error = e instanceof FetchError || e instanceof SearchError || e instanceof ExtractError ? e.code : 'SCAN_FAILED'
  }
  await db.from('race_sources').update({ last_scanned_at: new Date().toISOString(), last_error: out.error }).eq('id', src.id)
  return out
}

async function ingestLinks(db: SupabaseClient, sourceId: string, links: string[], deadlineMs: number, out: ScanResult) {
  if (!links.length) return
  const [{ data: seenC }, { data: seenL }] = await Promise.all([
    db.from('race_candidates').select('url').in('url', links),
    db.from('race_listings').select('source_url,reg_url').or(`source_url.in.(${links.map((l) => `"${l}"`).join(',')}),reg_url.in.(${links.map((l) => `"${l}"`).join(',')})`),
  ])
  const seen = new Set<string>([...(seenC ?? []).map((r: { url: string }) => r.url.toLowerCase()),
    ...(seenL ?? []).flatMap((r: { source_url: string | null; reg_url: string | null }) => [r.source_url, r.reg_url]).filter((x): x is string => !!x).map((x) => x.toLowerCase())])
  let fresh = links.filter((l) => !seen.has(l.toLowerCase()))
  const ai = extractionEnabled()
  if (ai) {
    // Với AI mỗi giải lưu dưới "trang#tên-ngày": trang đã có giải nào trong hàng chờ thì khỏi đọc (và khỏi tốn tiền) lại
    const keep: string[] = []
    for (const l of fresh) {
      const { count } = await db.from('race_candidates').select('id', { count: 'exact', head: true }).like('url', `${l.replace(/[\\%_]/g, '\\$&')}#%`)
      if (!count) keep.push(l)
    }
    fresh = keep
  }
  fresh = fresh.slice(0, MAX_PAGES)
  const today = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10)
  for (const link of fresh) {
    if (Date.now() > deadlineMs) break
    try {
      const page = await fetchHtml(link, { timeoutMs: 6000 })
      if (!(await robotsAllows(page.url))) continue
      const pageUrl = page.url.toString()
      if (ai) {
        const { races } = await extractRaces(page.html, pageUrl, today)
        if (!races.length) {
          const { error } = await db.from('race_candidates').insert({ source_id: sourceId, url: `${pageUrl.split('#')[0]}#khong-co-giai`, title: parseRacePage(page.html).title || pageUrl, score: 0, status: 'FILTERED', filter_reason: 'Không thấy giải chạy nào trong trang' })
          if (!error) { out.found++; out.filtered++ }
        }
        for (const r of races) {
          const s = screenCandidate(r, Date.now())
          const loc = [r.location, r.province].filter((x, i, a) => x && !a.slice(0, i).some((y) => y.toLowerCase().includes(x.toLowerCase()))).join(', ')
          const desc = [r.description, r.reg_url && `Link đăng ký: ${r.reg_url}`].filter(Boolean).join('\n')
          const { error } = await db.from('race_candidates').insert({
            source_id: sourceId, url: candidateKey(pageUrl, r), title: r.title, race_date: r.race_date || null, end_date: r.end_date || null,
            location: loc || null, organizer: r.organizer || null, description: desc || null, distances: r.distances,
            kind: r.kind, reg_deadline: r.reg_deadline || null, reg_url: r.reg_url || null, race_url: r.race_url || null,
            score: s.score, status: s.status, filter_reason: s.reason,
          })
          if (!error) { out.found++; if (s.status === 'PENDING') out.pending++; else out.filtered++ }
        }
      } else {
        const d = parseRacePage(page.html)
        const s = screenCandidate(d, Date.now())
        const { error } = await db.from('race_candidates').insert({
          source_id: sourceId, url: pageUrl, title: d.title, race_date: d.race_date || null, end_date: d.end_date || null,
          location: d.location || null, organizer: d.organizer || null, image_url: /^https?:\/\//i.test(d.image_url) ? d.image_url : null,
          description: d.description || null, distances: d.distances, score: s.score, status: s.status, filter_reason: s.reason,
        })
        if (!error) { out.found++; if (s.status === 'PENDING') out.pending++; else out.filtered++ }
      }
    } catch (e) {
      if (e instanceof ExtractError && e.code !== 'AI_FAILED') throw e // hết hạn mức / sai khoá: dừng cả lần quét
      /* trang lỗi: bỏ qua, lần sau thử lại */
    }
    await sleep(PAUSE_MS)
  }
}
