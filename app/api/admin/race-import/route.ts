import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { NextResponse, type NextRequest } from 'next/server'
import { createSupabaseServerClient } from '@/shared/lib/supabase-server'
import { parseRacePage } from '@/shared/lib/race-import'

// Race → "Dán link trang giải": máy chủ tải trang BTC và trả GỢI Ý (tên, ngày, nơi, cự ly…) để admin chỉnh rồi lưu.
// Không tự lưu / đăng. Chỉ admin gọi được; chặn địa chỉ nội bộ (SSRF), tối đa 3 lần chuyển hướng, 1 MB, 8 giây.
export const dynamic = 'force-dynamic'

const MAX_BYTES = 1_000_000

function privateIp(ip: string): boolean {
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
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('BAD_URL')
  if (u.port && u.port !== '80' && u.port !== '443') throw new Error('BAD_URL')
  const host = u.hostname.replace(/^\[|\]$/g, '')
  const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true })
  if (!addrs.length || addrs.some((a) => privateIp(a.address))) throw new Error('BAD_URL')
}

export async function POST(req: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'AUTH_REQUIRED' }, { status: 401 })
  const { data: isAdmin } = await supabase.rpc('is_system_admin')
  if (!isAdmin) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })

  const body = (await req.json().catch(() => ({}))) as { url?: string }
  let url: URL
  try { url = new URL(String(body.url ?? '').trim()) } catch { return NextResponse.json({ error: 'BAD_URL' }, { status: 400 }) }

  try {
    let res: Response | null = null
    for (let hop = 0; hop < 4; hop++) {
      await assertPublic(url)
      res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(8000), headers: { 'user-agent': 'RaceHubBot/1.0 (+admin import)', accept: 'text/html' } })
      const loc = res.headers.get('location')
      if (res.status >= 300 && res.status < 400 && loc) { url = new URL(loc, url); res = null; continue }
      break
    }
    if (!res || !res.ok) return NextResponse.json({ error: 'FETCH_FAILED' }, { status: 502 })
    if (!/text\/html|application\/xhtml/i.test(res.headers.get('content-type') ?? '')) return NextResponse.json({ error: 'NOT_HTML' }, { status: 422 })
    const reader = res.body?.getReader()
    const chunks: Uint8Array[] = []
    let size = 0
    while (reader) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.length
      if (size > MAX_BYTES) { await reader.cancel(); break }
      chunks.push(value)
    }
    const html = new TextDecoder('utf-8').decode(Buffer.concat(chunks))
    return NextResponse.json({ ok: true, source_url: url.toString(), draft: parseRacePage(html) })
  } catch {
    return NextResponse.json({ error: 'BAD_URL' }, { status: 400 })
  }
}
