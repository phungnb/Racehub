import { NextResponse } from 'next/server'
import { createSupabaseAdminClient, createSupabaseServerClient } from '@/shared/lib/supabase-server'
import { deauthorizeStrava } from '@/features/integrations/server'

// Xoá tài khoản (Apple 5.1.1(v), Luật BVDLCN 2025) — xem migration 006800.
// 1. Thu hồi quyền Strava  2. Xoá / ẩn danh dữ liệu (RPC, chạy với quyền của chính người dùng)
// 3. Xoá ảnh đã tải lên  4. Xoá mềm tài khoản đăng nhập (email bị làm rối → đăng ký lại được như người mới)
const USER_BUCKETS = ['avatars', 'club-media', 'race-media', 'uniform-media']

export async function POST(req: Request) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'AUTH_REQUIRED' }, { status: 401 })
  const body = await req.json().catch(() => null) as { confirm?: string } | null

  const admin = createSupabaseAdminClient()
  const { error } = await supabase.rpc('delete_my_account', { p_confirm: body?.confirm ?? '' })
  if (error) {
    const code = ['CONFIRM_REQUIRED', 'ADMIN_CANNOT_DELETE', 'TRANSFER_CLUB_FIRST'].find((c) => error.message.includes(c))
    if (code) return NextResponse.json({ error: code }, { status: 400 })
    console.error('[account/delete]', error.message)
    return NextResponse.json({ error: 'SERVER_ERROR' }, { status: 500 })
  }

  // Các bước dưới là "cố gắng hết sức": dữ liệu đã được xoá / ẩn danh ở bước trên
  const { data: token } = await admin.rpc('unlink_provider_connection', { p_user_id: user.id, p_provider: 'STRAVA' })
  if (typeof token === 'string' && token) await deauthorizeStrava(token).catch(() => undefined)
  for (const bucket of USER_BUCKETS) {
    const { data: files } = await admin.storage.from(bucket).list(user.id, { limit: 1000 })
    if (files?.length) await admin.storage.from(bucket).remove(files.map((f) => `${user.id}/${f.name}`))
  }
  const { error: authError } = await admin.auth.admin.deleteUser(user.id, true)
  if (authError) console.error('[account/delete] auth', authError.message)
  return NextResponse.json({ ok: true })
}
