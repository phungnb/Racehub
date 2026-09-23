import { NextResponse, type NextRequest } from 'next/server'
import { createSupabaseAdminClient } from '@/shared/lib/supabase-server'
import { isCronAuthorized } from '@/shared/lib/cron-auth'

// 00:05 giờ VN mỗi ngày (xem vercel.json): tất toán các thử thách đã kết thúc quá 2 giờ.
// Bình thường thử thách được tất toán ngay khi có người mở trang chi tiết; đây là lưới an toàn. Idempotent.
export const maxDuration = 60

export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req.headers.get('authorization'))) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const { data, error } = await createSupabaseAdminClient().rpc('settle_due_challenges')
  if (error) {
    console.error('[cron/challenges]', error.message)
    return NextResponse.json({ error: 'FAILED' }, { status: 500 })
  }
  return NextResponse.json({ settled: data })
}
