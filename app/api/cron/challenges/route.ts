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
  // Thử thách tự lặp lại: tạo kỳ kế tiếp trước khi kỳ hiện tại kết thúc (migration 007600) — sau khi đã cấp lượt tháng mới
  const recurring = await admin.rpc('spawn_recurring_challenges')
  if (recurring.error) console.error('[cron/challenges] recurring', recurring.error.message)
  // Hợp đồng tổ chức hết hạn → trả gói cũ cho CLB được tài trợ Pro (migration 008300)
  const orgs = await admin.rpc('expire_org_plans')
  if (orgs.error) console.error('[cron/challenges] orgs', orgs.error.message)
  return NextResponse.json({ settled: data, battles: battles.data ?? null, cups: cups.data ?? null, credits: credits.data ?? null,
    recurring: recurring.data ?? null, orgs: orgs.data ?? null })
}
