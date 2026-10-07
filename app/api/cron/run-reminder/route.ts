import { NextResponse, type NextRequest } from 'next/server'
import { createSupabaseAdminClient } from '@/shared/lib/supabase-server'
import { isCronAuthorized } from '@/shared/lib/cron-auth'

// 17:30 giờ VN mỗi ngày (xem vercel.json): nhắc runner có bài hợp lệ gần nhất cách 3–30 ngày.
// Mỗi người tối đa 1 lần / 7 ngày (kiểm trong DB), nên gọi lại không nhắc thêm. Migration 013600.
export const maxDuration = 60

export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req.headers.get('authorization'))) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const admin = createSupabaseAdminClient()
  const { data, error } = await admin.rpc('send_run_reminders')
  if (error) {
    console.error('[cron/run-reminder]', error.message)
    return NextResponse.json({ error: 'FAILED' }, { status: 500 })
  }
  return NextResponse.json({ reminded: data })
}
