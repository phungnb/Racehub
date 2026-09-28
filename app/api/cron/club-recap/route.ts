import { NextResponse, type NextRequest } from 'next/server'
import { createSupabaseAdminClient } from '@/shared/lib/supabase-server'
import { isCronAuthorized } from '@/shared/lib/cron-auth'

// Hằng ngày 07:00 giờ VN (xem vercel.json): đăng "Tổng kết tuần" (tuần trước) và "Tổng kết tháng" (tháng trước) cho CLB bật tổng kết.
// Idempotent phía DB (009600) — mỗi kỳ chỉ đăng một lần, nên gọi hằng ngày chỉ có tác dụng ngày đầu kỳ (hoặc bù khi lần trước lỗi).
export const maxDuration = 60

export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req.headers.get('authorization'))) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const db = createSupabaseAdminClient()
  const week = await db.rpc('post_weekly_club_recaps')
  const month = await db.rpc('post_monthly_club_recaps')
  const error = week.error ?? month.error
  if (error) {
    console.error('[cron/club-recap]', error.message)
    return NextResponse.json({ error: 'FAILED' }, { status: 500 })
  }
  return NextResponse.json({ weekly: week.data, monthly: month.data })
}
