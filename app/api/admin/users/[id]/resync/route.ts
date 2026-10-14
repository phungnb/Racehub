import { NextResponse, type NextRequest } from 'next/server'
import { createSupabaseAdminClient, createSupabaseServerClient } from '@/shared/lib/supabase-server'
import { backfillStravaActivities } from '@/features/integrations/server'

// Quản trị → Người dùng → "Đồng bộ lại": admin kéo lại bài Strava của MỘT người dùng.
// Khoảng thời gian = từ ngày bắt đầu sớm nhất trong các thử thách đang diễn ra mà người này tham gia (không có thì 30 ngày gần nhất).
// Chia lô như đồng bộ lại của thử thách (xem /api/challenges/[id]/resync): client gọi lần lượt, mỗi lần ≤ 3 trang × 100 bài.
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const USER_ERRORS: Record<string, string> = {
  STRAVA_NOT_CONNECTED: 'Người này chưa kết nối Strava.',
  STRAVA_REAUTH_REQUIRED: 'Kết nối Strava của người này đã hết hạn, cần liên kết lại.',
}

interface ChallengeRow { id: string; start_date: string; end_date: string }

export async function POST(req: NextRequest, ctx: RouteContext<'/api/admin/users/[id]/resync'>) {
  const { id } = await ctx.params
  const body = await req.json().catch(() => ({})) as { step?: string; page?: number }
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'AUTH_REQUIRED', message: 'Cần đăng nhập.' }, { status: 401 })
  const { data: isAdmin } = await supabase.rpc('is_system_admin')
  if (!isAdmin) return NextResponse.json({ error: 'FORBIDDEN', message: 'Chỉ admin được đồng bộ lại.' }, { status: 403 })

  const admin = createSupabaseAdminClient()
  const { data: conn } = await admin.from('connected_accounts').select('user_id').eq('user_id', id).eq('provider', 'STRAVA').maybeSingle()
  if (!conn) return NextResponse.json({ error: 'STRAVA_NOT_CONNECTED', message: USER_ERRORS.STRAVA_NOT_CONNECTED }, { status: 200 })

  const { data: parts } = await admin.from('challenge_participants')
    .select('challenges!inner(id, start_date, end_date, status)')
    .eq('profile_id', id).in('status', ['JOINED', 'COMPLETED']).eq('challenges.status', 'ACTIVE')
    .returns<{ challenges: ChallengeRow }[]>()
  const challenges = (parts ?? []).map((p) => p.challenges)
  const now = Date.now()
  const since = challenges.length ? new Date(Math.min(...challenges.map((c) => Date.parse(c.start_date)))) : new Date(now - 30 * 86_400_000)
  const until = new Date(now + 86_400_000)
  if (body.step !== 'member' && body.step !== 'finish') return NextResponse.json({ since, until, challenges: challenges.length })

  // Tính lại vào từng thử thách đang diễn ra (RPC kiểm quyền admin theo người đang đăng nhập; idempotent)
  if (body.step === 'finish') {
    let applied = 0
    for (const c of challenges) {
      const { data, error } = await supabase.rpc('challenge_resync_apply', { p_challenge_id: c.id })
      if (error) { console.error('[admin/users/resync]', error.message); return NextResponse.json({ error: 'SERVER_ERROR', message: 'Không tính lại được vào thử thách.' }, { status: 500 }) }
      applied += (data as { applied?: number } | null)?.applied ?? 0
    }
    return NextResponse.json({ applied })
  }

  try {
    const r = await backfillStravaActivities(admin, id, { since, until, page: Number.isInteger(body.page) ? body.page : 1 })
    return NextResponse.json(r)
  } catch (e) {
    const code = e instanceof Error ? e.message.split(':')[0] : 'SERVER_ERROR'
    if (USER_ERRORS[code]) return NextResponse.json({ error: code, message: USER_ERRORS[code] }, { status: 200 })
    if (code === 'STRAVA_RATE_LIMITED') return NextResponse.json({ error: code, message: 'Strava đang giới hạn lượt truy cập.' }, { status: 429 })
    console.error('[admin/users/resync]', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'SERVER_ERROR', message: 'Không lấy được dữ liệu Strava của người này.' }, { status: 500 })
  }
}
