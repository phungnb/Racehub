import { NextResponse, type NextRequest } from 'next/server'
import { createSupabaseAdminClient } from '@/shared/lib/supabase-server'
import { isCronAuthorized } from '@/shared/lib/cron-auth'
import { runStravaScanJob } from '@/features/integrations/server'

// 03:00 giờ VN mỗi ngày (xem vercel.json): chạy tiếp các việc quét Strava còn dang dở của thành viên không mở app.
// Dừng ngay khi Strava giới hạn lượt gọi hoặc hết ~45 giây; lần sau chạy tiếp đúng trang. Idempotent.
export const maxDuration = 60

const BUDGET_MS = 45_000

export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req.headers.get('authorization'))) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const admin = createSupabaseAdminClient()
  const { data: jobs, error } = await admin.from('strava_scan_jobs').select('user_id').eq('status', 'PENDING')
    .order('updated_at', { ascending: true }).limit(50).returns<{ user_id: string }[]>()
  if (error) {
    console.error('[cron/strava-scan]', error.message)
    return NextResponse.json({ error: 'FAILED' }, { status: 500 })
  }
  const started = Date.now()
  let ran = 0
  let done = 0
  let rateLimited = false
  for (const j of jobs ?? []) {
    if (Date.now() - started > BUDGET_MS) break
    try {
      const r = await runStravaScanJob(admin, j.user_id)
      if (r.ran) ran++
      if (r.done) done++
      if (r.rateLimited) { rateLimited = true; break }
    } catch (e) {
      console.error('[cron/strava-scan] user', j.user_id, e instanceof Error ? e.message : e)
    }
  }
  return NextResponse.json({ pending: jobs?.length ?? 0, ran, done, rateLimited })
}
