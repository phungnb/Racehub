import { NextResponse, type NextRequest } from 'next/server'
import { createSupabaseAdminClient, createSupabaseServerClient } from '@/shared/lib/supabase-server'
import { STRAVA_YEAR_SCAN_SINCE, backfillStravaActivities } from '@/features/integrations/server'

// Đại sảnh CLB → "Quét Strava cho cả CLB": ban quản trị CLB (hoặc admin hệ thống) kéo lại bài chạy từ 1/1/2026 của MỘT thành viên.
// Client gọi lần lượt từng thành viên, mỗi thành viên theo từng trang (≤ 3 trang × 100 bài mỗi lần); nhập bài idempotent nên chạy lại an toàn.
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const USER_ERRORS: Record<string, string> = {
  STRAVA_NOT_CONNECTED: 'Chưa kết nối Strava.',
  STRAVA_REAUTH_REQUIRED: 'Kết nối Strava đã hết hạn, cần liên kết lại.',
}

export async function POST(req: NextRequest, ctx: RouteContext<'/api/clubs/[id]/strava-scan'>) {
  const { id: clubId } = await ctx.params
  const body = await req.json().catch(() => ({})) as { userId?: string; page?: number }
  if (typeof body.userId !== 'string') return NextResponse.json({ error: 'BAD_REQUEST', message: 'Thiếu thành viên cần quét.' }, { status: 400 })
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'AUTH_REQUIRED', message: 'Cần đăng nhập.' }, { status: 401 })

  const admin = createSupabaseAdminClient()
  const { data: me } = await admin.from('club_members').select('role, status').eq('club_id', clubId).eq('user_id', user.id)
    .maybeSingle<{ role: string; status: string }>()
  const clubStaff = me?.status === 'APPROVED' && (me.role === 'OWNER' || me.role === 'CAPTAIN')
  if (!clubStaff) {
    const { data: isAdmin } = await supabase.rpc('is_system_admin')
    if (!isAdmin) return NextResponse.json({ error: 'FORBIDDEN', message: 'Chỉ ban quản trị CLB mới quét được cho cả CLB.' }, { status: 403 })
  }
  // Chỉ quét thành viên đã được duyệt của chính CLB này
  const { data: target } = await admin.from('club_members').select('user_id').eq('club_id', clubId).eq('user_id', body.userId).eq('status', 'APPROVED').maybeSingle()
  if (!target) return NextResponse.json({ error: 'NOT_A_MEMBER', message: 'Người này không phải thành viên của CLB.' }, { status: 400 })

  try {
    const r = await backfillStravaActivities(admin, body.userId, {
      since: STRAVA_YEAR_SCAN_SINCE, until: new Date(Date.now() + 86_400_000), page: Number.isInteger(body.page) ? body.page : 1,
    })
    return NextResponse.json({ summary: r.summary, nextPage: r.nextPage, rateLimited: r.rateLimited })
  } catch (err) {
    const code = err instanceof Error ? err.message.split(':')[0] : 'SERVER_ERROR'
    // Người chưa nối / hết hạn Strava: không phải lỗi hệ thống, client bỏ qua người này
    if (USER_ERRORS[code]) return NextResponse.json({ error: code, message: USER_ERRORS[code] }, { status: 200 })
    if (code === 'STRAVA_RATE_LIMITED') return NextResponse.json({ error: code, message: 'Strava đang giới hạn lượt truy cập.' }, { status: 429 })
    console.error('[clubs/strava-scan]', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'SERVER_ERROR', message: 'Không lấy được dữ liệu Strava của người này.' }, { status: 500 })
  }
}
