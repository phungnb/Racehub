import { NextResponse, type NextRequest } from 'next/server'
import { createSupabaseAdminClient } from '@/shared/lib/supabase-server'
import { isCronAuthorized } from '@/shared/lib/cron-auth'

// Nhắc sự kiện CLB trong 12 giờ tới (idempotent). Nhắc chính diễn ra "lười" khi thành viên mở tab Lịch;
// cron này là lưới an toàn. Vercel Hobby chỉ cho cron hằng ngày: 23:00 UTC = 06:00 giờ VN.
export const maxDuration = 60

export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req.headers.get('authorization'))) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const { data, error } = await createSupabaseAdminClient().rpc('remind_upcoming_events')
  if (error) {
    console.error('[cron/events]', error.message)
    return NextResponse.json({ error: 'FAILED' }, { status: 500 })
  }
  return NextResponse.json({ reminded: data })
}
