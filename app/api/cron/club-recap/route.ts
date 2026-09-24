import { NextResponse, type NextRequest } from 'next/server'
import { createSupabaseAdminClient } from '@/shared/lib/supabase-server'
import { isCronAuthorized } from '@/shared/lib/cron-auth'

// Sáng thứ Hai (07:00 giờ VN, xem vercel.json): đăng bài "Tổng kết tuần" cho mọi CLB có người chạy.
// Idempotent phía DB — gọi lại không tạo bài trùng.
export const maxDuration = 60

export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req.headers.get('authorization'))) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const { data, error } = await createSupabaseAdminClient().rpc('post_weekly_club_recaps')
  if (error) {
    console.error('[cron/club-recap]', error.message)
    return NextResponse.json({ error: 'FAILED' }, { status: 500 })
  }
  return NextResponse.json({ posted: data })
}
