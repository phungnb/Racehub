import { NextResponse, type NextRequest } from 'next/server'
import { createSupabaseAdminClient, createSupabaseServerClient } from '@/shared/lib/supabase-server'
import { backfillStravaActivities } from '@/features/integrations/server'

// Đại sảnh CLB → "Quét Strava từ 1/1/2026": người dùng tự kéo lại toàn bộ bài chạy từ đầu năm (một lần).
// Chia lô như đồng bộ lại của thử thách: client gọi lần lượt, mỗi lần ≤ 3 trang × 100 bài; nhập bài idempotent nên chạy lại an toàn.
export const dynamic = 'force-dynamic'
export const maxDuration = 60

/** 0h ngày 1/1/2026 giờ Việt Nam */
const YEAR_SCAN_SINCE = new Date('2026-01-01T00:00:00+07:00')

const MESSAGES: Record<string, [number, string]> = {
  STRAVA_NOT_CONNECTED: [400, 'Bạn chưa kết nối Strava.'],
  STRAVA_REAUTH_REQUIRED: [401, 'Kết nối Strava đã hết hạn. Hãy hủy và liên kết lại.'],
  STRAVA_RATE_LIMITED: [429, 'Strava đang giới hạn lượt truy cập. Thử lại sau 15 phút.'],
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as { page?: number }
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'AUTH_REQUIRED', message: 'Cần đăng nhập.' }, { status: 401 })
  try {
    const r = await backfillStravaActivities(createSupabaseAdminClient(), user.id, {
      since: YEAR_SCAN_SINCE, until: new Date(Date.now() + 86_400_000), page: Number.isInteger(body.page) ? body.page : 1,
    })
    return NextResponse.json({ summary: r.summary, nextPage: r.nextPage, rateLimited: r.rateLimited })
  } catch (err) {
    const code = err instanceof Error ? err.message.split(':')[0] : 'SERVER_ERROR'
    const [status, message] = MESSAGES[code] ?? [500, 'Không quét được Strava. Vui lòng thử lại.']
    if (status === 500) console.error('[strava/backfill-year]', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: code, message }, { status })
  }
}
