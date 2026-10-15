import { NextResponse } from 'next/server'
import { createSupabaseAdminClient, createSupabaseServerClient } from '@/shared/lib/supabase-server'
import { runStravaScanJob } from '@/features/integrations/server'

// Đồng bộ ngầm của app gọi kèm: nếu người này có việc quét Strava (ban quản trị CLB bật) thì lấy tiếp một lô. Không có việc → trả về ngay.
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'AUTH_REQUIRED' }, { status: 401 })
  try {
    return NextResponse.json(await runStravaScanJob(createSupabaseAdminClient(), user.id))
  } catch (err) {
    console.error('[strava/scan-tick]', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'SERVER_ERROR' }, { status: 500 })
  }
}
