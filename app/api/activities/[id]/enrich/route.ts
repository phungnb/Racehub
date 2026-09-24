import { NextResponse, type NextRequest } from 'next/server'
import { createSupabaseAdminClient, createSupabaseServerClient } from '@/shared/lib/supabase-server'
import { enrichStravaActivity } from '@/features/integrations/server'

// Chủ bài mở màn chi tiết lần đầu → lấy từng km + tuyến đầy đủ từ Strava rồi lưu (một lần mỗi bài).
export const maxDuration = 30

export async function POST(_req: NextRequest, ctx: RouteContext<'/api/activities/[id]/enrich'>) {
  const { id } = await ctx.params
  const { data: { user } } = await (await createSupabaseServerClient()).auth.getUser()
  if (!user) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  try {
    const result = await enrichStravaActivity(createSupabaseAdminClient(), user.id, id)
    return NextResponse.json({ result }, { status: result === 'NOT_FOUND' ? 404 : 200 })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    // Strava hết hạn mức / cần kết nối lại: không phải lỗi máy chủ, màn hình vẫn hiện dữ liệu đang có
    const known = msg === 'STRAVA_RATE_LIMITED' || msg === 'STRAVA_REAUTH_REQUIRED' || msg.startsWith('STRAVA_API_')
    if (!known) console.error('[activities/enrich]', msg)
    return NextResponse.json({ error: known ? msg : 'FAILED' }, { status: known ? 200 : 500 })
  }
}
