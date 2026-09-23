import { NextResponse } from 'next/server'
import { createSupabaseAdminClient, createSupabaseServerClient } from '@/shared/lib/supabase-server'
import { syncStravaActivities } from '@/features/integrations/strava/strava.server'

// Nút "Đồng bộ ngay": kéo bài chạy mới từ Strava cho người đang đăng nhập.
export const maxDuration = 60

const MESSAGES: Record<string, [number, string]> = {
  STRAVA_NOT_CONNECTED: [400, 'Bạn chưa kết nối Strava.'],
  STRAVA_REAUTH_REQUIRED: [401, 'Kết nối Strava đã hết hạn. Hãy hủy và liên kết lại.'],
  STRAVA_RATE_LIMITED: [429, 'Strava đang giới hạn lượt truy cập. Thử lại sau 15 phút.'],
}

export async function POST() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'AUTH_REQUIRED' }, { status: 401 })

  const admin = createSupabaseAdminClient()
  // Chống bấm liên tục: tối đa 1 lần / 60 giây
  const { data: conn } = await admin.from('connected_accounts').select('last_synced_at')
    .eq('user_id', user.id).eq('provider', 'STRAVA').maybeSingle<{ last_synced_at: string | null }>()
  if (conn?.last_synced_at && Date.now() - new Date(conn.last_synced_at).getTime() < 60_000) {
    return NextResponse.json({ error: 'TOO_SOON', message: 'Vừa đồng bộ xong, thử lại sau 1 phút.' }, { status: 429 })
  }

  try {
    const summary = await syncStravaActivities(admin, user.id)
    return NextResponse.json(summary)
  } catch (err) {
    const code = err instanceof Error ? err.message.split(':')[0] : 'SERVER_ERROR'
    const [status, message] = MESSAGES[code] ?? [500, 'Không đồng bộ được Strava. Vui lòng thử lại.']
    if (status === 500) console.error('[strava/sync]', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: code, message }, { status })
  }
}
