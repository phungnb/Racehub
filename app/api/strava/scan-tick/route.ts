import { NextResponse } from 'next/server'
import { createSupabaseAdminClient, createSupabaseServerClient } from '@/shared/lib/supabase-server'
import { runStravaScanJob } from '@/features/integrations/server'

// Đồng bộ ngầm của app gọi kèm: lấy tiếp một lô việc quét Strava của chính người này, rồi tiện thể chạy vài việc dang dở của người khác
// (thành viên ít mở app) — để cả CLB được quét xong sớm mà không phải chờ cron hằng đêm. Không có việc → trả về ngay.
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const BUDGET_MS = 40_000
const OTHERS_PER_TICK = 3

export async function POST() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'AUTH_REQUIRED' }, { status: 401 })
  try {
    const admin = createSupabaseAdminClient()
    const started = Date.now()
    const own = await runStravaScanJob(admin, user.id)
    let others = 0
    if (!own.rateLimited) {
      const { data: jobs } = await admin.from('strava_scan_jobs').select('user_id').eq('status', 'PENDING').neq('user_id', user.id)
        .order('updated_at', { ascending: true }).limit(OTHERS_PER_TICK).returns<{ user_id: string }[]>()
      for (const j of jobs ?? []) {
        if (Date.now() - started > BUDGET_MS) break
        try {
          const r = await runStravaScanJob(admin, j.user_id)
          if (r.ran) others++
          if (r.rateLimited) break
        } catch (e) {
          console.error('[strava/scan-tick] user', j.user_id, e instanceof Error ? e.message : e)
        }
      }
    }
    return NextResponse.json({ ...own, others })
  } catch (err) {
    console.error('[strava/scan-tick]', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'SERVER_ERROR' }, { status: 500 })
  }
}
