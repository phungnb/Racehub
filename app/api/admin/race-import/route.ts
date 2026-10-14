import { NextResponse, type NextRequest } from 'next/server'
import { createSupabaseServerClient } from '@/shared/lib/supabase-server'
import { parseRacePage } from '@/shared/lib/race-import'
import { FetchError, fetchHtml } from '@/shared/lib/safe-fetch'
import { isSearchResultsUrl } from '@/shared/lib/race-scan'

// Race → "Dán link trang giải": máy chủ tải trang BTC và trả GỢI Ý (tên, ngày, nơi, cự ly…) để admin chỉnh rồi lưu.
// Không tự lưu / đăng. Chỉ admin gọi được; chặn địa chỉ nội bộ (SSRF) — xem shared/lib/safe-fetch.ts.
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'AUTH_REQUIRED' }, { status: 401 })
  const { data: isAdmin } = await supabase.rpc('is_system_admin')
  if (!isAdmin) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })

  const body = (await req.json().catch(() => ({}))) as { url?: string }
  if (isSearchResultsUrl(String(body.url ?? ''))) return NextResponse.json({ error: 'SEARCH_URL' }, { status: 422 })
  try {
    const { html, url } = await fetchHtml(String(body.url ?? '').trim())
    return NextResponse.json({ ok: true, source_url: url.toString(), draft: parseRacePage(html) })
  } catch (e) {
    const code = e instanceof FetchError ? e.code : 'BAD_URL'
    return NextResponse.json({ error: code }, { status: code === 'FETCH_FAILED' ? 502 : code === 'NOT_HTML' ? 422 : 400 })
  }
}
