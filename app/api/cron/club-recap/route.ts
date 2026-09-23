import { NextResponse, type NextRequest } from 'next/server'
import { timingSafeEqual } from 'node:crypto'
import { createSupabaseAdminClient } from '@/shared/lib/supabase-server'
import { serverEnv } from '@/shared/config/env.server'

// Sáng thứ Hai (07:00 giờ VN, xem vercel.json): đăng bài "Tổng kết tuần" cho mọi CLB có người chạy.
// Idempotent phía DB — gọi lại không tạo bài trùng.
export const maxDuration = 60

function authorized(req: NextRequest) {
  const got = Buffer.from(req.headers.get('authorization') ?? '')
  const want = Buffer.from(`Bearer ${serverEnv.cronSecret}`)
  return got.length === want.length && timingSafeEqual(got, want)
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const { data, error } = await createSupabaseAdminClient().rpc('post_weekly_club_recaps')
  if (error) {
    console.error('[cron/club-recap]', error.message)
    return NextResponse.json({ error: 'FAILED' }, { status: 500 })
  }
  return NextResponse.json({ posted: data })
}
