import { NextResponse, type NextRequest } from 'next/server'
import { createSupabaseAdminClient } from '@/shared/lib/supabase-server'
import { isCronAuthorized } from '@/shared/lib/cron-auth'

// 00:10 giờ VN thứ Hai (xem vercel.json): chốt league tuần trước — lên / xuống hạng, thưởng top 3.
// Bình thường league được chốt ngay khi có người mở trang chủ; đây là lưới an toàn. Idempotent.
export const maxDuration = 60

export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req.headers.get('authorization'))) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const { data, error } = await createSupabaseAdminClient().rpc('settle_due_leagues')
  if (error) {
    console.error('[cron/leagues]', error.message)
    return NextResponse.json({ error: 'FAILED' }, { status: 500 })
  }
  return NextResponse.json({ settled: data })
}
