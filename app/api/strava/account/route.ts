import { NextResponse } from 'next/server'
import { createSupabaseAdminClient, createSupabaseServerClient } from '@/shared/lib/supabase-server'
import { refreshStravaIdentity } from '@/features/integrations/server'

// Trang Tôi: kết nối Strava cũ chưa có tên / ảnh → lấy từ Strava một lần rồi lưu (migration 015200).
// `force` (nút "Làm mới") chỉ chạy tối đa 1 lần / phút nhờ identity_synced_at.
export async function POST() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'AUTH_REQUIRED' }, { status: 401 })

  const admin = createSupabaseAdminClient()
  const { data: row } = await admin.from('connected_accounts').select('identity_synced_at')
    .eq('user_id', user.id).eq('provider', 'STRAVA').maybeSingle<{ identity_synced_at: string | null }>()
  if (!row) return NextResponse.json({ error: 'STRAVA_NOT_CONNECTED' }, { status: 400 })
  if (row.identity_synced_at && Date.now() - new Date(row.identity_synced_at).getTime() < 60_000) {
    return NextResponse.json({ ok: true, skipped: true })
  }
  const identity = await refreshStravaIdentity(admin, user.id, { force: true })
  return NextResponse.json({ ok: Boolean(identity) })
}
