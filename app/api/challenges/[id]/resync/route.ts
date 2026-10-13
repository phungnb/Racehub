import { NextResponse, type NextRequest } from 'next/server'
import { createSupabaseAdminClient, createSupabaseServerClient } from '@/shared/lib/supabase-server'
import { backfillStravaActivities } from '@/features/integrations/server'

// "Đồng bộ lại dữ liệu" của thử thách: BQT CLB / người tạo / admin kéo lại bài Strava của thành viên từ ngày bắt đầu thử thách.
// Chia lô để an toàn với hạn mức Strava: client gọi lần lượt từng thành viên (mỗi lần ≤ 3 trang × 100 bài), xem 3 bước ở dưới.
export const maxDuration = 60

const MEMBER_ERRORS: Record<string, string> = {
  STRAVA_NOT_CONNECTED: 'Chưa kết nối Strava',
  STRAVA_REAUTH_REQUIRED: 'Kết nối Strava đã hết hạn, cần liên kết lại',
}

interface Targets { title: string; status: string; start_date: string; end_date: string; members: { user_id: string; name: string | null }[]; not_connected: number }

const RPC_ERRORS: Record<string, [number, string]> = {
  AUTH_REQUIRED: [401, 'Cần đăng nhập.'],
  FORBIDDEN: [403, 'Chỉ Ban quản trị CLB, người tạo thử thách hoặc admin được đồng bộ lại.'],
  CHALLENGE_NOT_FOUND: [404, 'Không tìm thấy thử thách.'],
  CHALLENGE_CLOSED: [409, 'Thử thách đã đóng.'],
}

export async function POST(req: NextRequest, ctx: RouteContext<'/api/challenges/[id]/resync'>) {
  const { id } = await ctx.params
  const body = await req.json().catch(() => ({})) as { step?: string; userId?: string; page?: number }
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'AUTH_REQUIRED', message: RPC_ERRORS.AUTH_REQUIRED[1] }, { status: 401 })

  const fail = (message: string) => {
    const code = message.match(/[A-Z][A-Z_]{5,}/)?.[0] ?? 'SERVER_ERROR'
    const [status, text] = RPC_ERRORS[code] ?? [500, 'Không đồng bộ lại được. Vui lòng thử lại.']
    if (status === 500) console.error('[challenges/resync]', message)
    return NextResponse.json({ error: code, message: text }, { status })
  }

  // Bước 1 "targets": danh sách thành viên đã nối Strava + khoảng thời gian cần lấy (quyền kiểm ở RPC, theo người đang đăng nhập)
  const { data: targets, error } = await supabase.rpc('challenge_resync_targets', { p_challenge_id: id })
  if (error) return fail(error.message)
  const t = targets as Targets
  if (body.step !== 'member' && body.step !== 'finish') return NextResponse.json(t)

  // Bước 3 "finish": tính lại các bài đã có vào thử thách (sau khi lấy xong tất cả thành viên)
  if (body.step === 'finish') {
    const { data, error: e2 } = await supabase.rpc('challenge_resync_apply', { p_challenge_id: id })
    if (e2) return fail(e2.message)
    return NextResponse.json(data)
  }

  // Bước 2 "member": lấy một lô bài Strava của một thành viên (phải thuộc danh sách ở bước 1)
  if (!body.userId || !t.members.some((m) => m.user_id === body.userId)) {
    return NextResponse.json({ error: 'NOT_A_TARGET', message: 'Người này không nằm trong thử thách hoặc chưa nối Strava.' }, { status: 400 })
  }
  const until = new Date(Math.min(Date.parse(t.end_date), Date.now() + 86_400_000))
  try {
    const r = await backfillStravaActivities(createSupabaseAdminClient(), body.userId, {
      since: new Date(t.start_date), until, page: Number.isInteger(body.page) ? body.page : 1,
    })
    return NextResponse.json(r)
  } catch (e) {
    const code = e instanceof Error ? e.message.split(':')[0] : 'SERVER_ERROR'
    if (MEMBER_ERRORS[code]) return NextResponse.json({ error: code, message: MEMBER_ERRORS[code] }, { status: 200 })
    if (code === 'STRAVA_RATE_LIMITED') return NextResponse.json({ error: code, message: 'Strava đang giới hạn lượt truy cập.' }, { status: 429 })
    console.error('[challenges/resync]', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'SERVER_ERROR', message: 'Không lấy được dữ liệu Strava của thành viên này.' }, { status: 500 })
  }
}
