import { NextResponse, type NextRequest } from 'next/server'
import { createSupabaseAdminClient } from '@/shared/lib/supabase-server'
import { isCronAuthorized } from '@/shared/lib/cron-auth'

// 00:05 giờ VN mỗi ngày (xem vercel.json): tất toán các thử thách và trận CLB đấu CLB đã kết thúc quá 2 giờ.
// Bình thường thử thách được tất toán ngay khi có người mở trang chi tiết; đây là lưới an toàn. Idempotent.
export const maxDuration = 60

export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req.headers.get('authorization'))) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const admin = createSupabaseAdminClient()
  const { data, error } = await admin.rpc('settle_due_challenges')
  if (error) {
    console.error('[cron/challenges]', error.message)
    return NextResponse.json({ error: 'FAILED' }, { status: 500 })
  }
  // Trận CLB đấu CLB (migration 002600); lỗi ở đây không chặn phần thử thách
  const battles = await admin.rpc('settle_due_club_battles')
  if (battles.error) console.error('[cron/challenges] battles', battles.error.message)
  // Thách đấu nhiều CLB (migration 003600)
  const cups = await admin.rpc('settle_due_club_cups')
  if (cups.error) console.error('[cron/challenges] cups', cups.error.message)
  // Lượt tạo thử thách tháng mới cho gói VIP / CLB Pro (migration 003800)
  const credits = await admin.rpc('issue_due_credits')
  if (credits.error) console.error('[cron/challenges] credits', credits.error.message)
  return NextResponse.json({ settled: data, battles: battles.data ?? null, cups: cups.data ?? null, credits: credits.data ?? null })
}
