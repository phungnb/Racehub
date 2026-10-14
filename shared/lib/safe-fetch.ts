import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

// Tải trang web do admin chỉ định: chặn địa chỉ nội bộ (SSRF), chuyển hướng tối đa 3 lần, giới hạn dung lượng và thời gian.
export const BOT_UA = 'RaceHubBot/1.0 (+https://racehub.vn; admin-approved race listing)'
export class FetchError extends Error {
  constructor(public code: 'BAD_URL' | 'FETCH_FAILED' | 'NOT_HTML') { super(code) }
}

export function privateIp(ip: string): boolean {
  if (ip.includes(':')) {
    const v = ip.toLowerCase()
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v)
    if (mapped) return privateIp(mapped[1])
    return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || /^fe[89ab]/.test(v)
  }
  const [a, b] = ip.split('.').map(Number)
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224
}

async function assertPublic(u: URL) {
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new FetchError('BAD_URL')
  if (u.port && u.port !== '80' && u.port !== '443') throw new FetchError('BAD_URL')
  const host = u.hostname.replace(/^\[|\]$/g, '')
  const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true }).catch(() => [])
  if (!addrs.length || addrs.some((a) => privateIp(a.address))) throw new FetchError('BAD_URL')
}

/** Trả { html, url } (url cuối sau chuyển hướng). Ném FetchError. */
export async function fetchHtml(input: string | URL, opts: { timeoutMs?: number; maxBytes?: number } = {}): Promise<{ html: string; url: URL }> {
  let url: URL
  try { url = new URL(input) } catch { throw new FetchError('BAD_URL') }
  let res: Response | null = null
  try {
    for (let hop = 0; hop < 4; hop++) {
      await assertPublic(url)
      res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(opts.timeoutMs ?? 8000), headers: { 'user-agent': BOT_UA, accept: 'text/html' } })
      const loc = res.headers.get('location')
      if (res.status >= 300 && res.status < 400 && loc) { url = new URL(loc, url); res = null; continue }
      break
    }
  } catch (e) { throw e instanceof FetchError ? e : new FetchError('FETCH_FAILED') }
  if (!res || !res.ok) throw new FetchError('FETCH_FAILED')
  if (!/text\/html|application\/xhtml/i.test(res.headers.get('content-type') ?? '')) throw new FetchError('NOT_HTML')
  const max = opts.maxBytes ?? 1_000_000
  const reader = res.body?.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  while (reader) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.length
    if (size > max) { await reader.cancel(); break }
    chunks.push(value)
  }
  return { html: new TextDecoder('utf-8').decode(Buffer.concat(chunks)), url }
}

/** robots.txt: true nếu cho phép bot vào đường dẫn (nhóm User-agent: * hoặc RaceHubBot). Lỗi tải robots → cho phép. */
export async function robotsAllows(url: URL): Promise<boolean> {
  try {
    await assertPublic(url)
    const res = await fetch(new URL('/robots.txt', url), { redirect: 'follow', signal: AbortSignal.timeout(5000), headers: { 'user-agent': BOT_UA } })
    if (!res.ok) return true
    return robotsAllowsPath(await res.text(), url.pathname + url.search)
  } catch { return true }
}

export function robotsAllowsPath(txt: string, path: string): boolean {
  let applies = false
  let inAgents = false
  const disallow: string[] = []
  const allow: string[] = []
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim()
    const m = /^([a-z-]+)\s*:\s*(.*)$/i.exec(line)
    if (!m) continue
    const k = m[1].toLowerCase(); const v = m[2].trim()
    if (k === 'user-agent') {
      if (!inAgents) applies = false
      inAgents = true
      if (v === '*' || /racehubbot/i.test(v)) applies = true
    } else {
      inAgents = false
      if (!applies) continue
      if (k === 'disallow' && v) disallow.push(v)
      else if (k === 'allow' && v) allow.push(v)
    }
  }
  const longest = (rules: string[]) => rules.filter((r) => path.startsWith(r.replace(/\*$/, ''))).reduce((n, r) => Math.max(n, r.length), -1)
  return longest(allow) >= longest(disallow)
}
