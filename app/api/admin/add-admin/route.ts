import { NextResponse, type NextRequest } from 'next/server'
import { createSupabaseAdminClient, createSupabaseServerClient } from '@/shared/lib/supabase-server'

// Quản trị → Người dùng → "Thêm admin bằng email":
//  • email đã có tài khoản → cấp quyền admin ngay (qua RPC của chính admin đang thao tác: ghi nhật ký, áp quy tắc quản trị);
//  • chưa có → gửi thư mời đăng ký (Supabase Auth), tài khoản mới được cấp quyền admin luôn.
// Chỉ admin hệ thống gọi được. Khóa service role chỉ dùng ở máy chủ để gửi thư mời, không trả gì ra ngoài.
export const dynamic = 'force-dynamic'

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

export async function POST(req: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'AUTH_REQUIRED' }, { status: 401 })
  const { data: isAdmin } = await supabase.rpc('is_system_admin')
  if (!isAdmin) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })

  const body = (await req.json().catch(() => ({}))) as { email?: string }
  const email = String(body.email ?? '').trim().toLowerCase()
  if (!EMAIL.test(email) || email.length > 200) return NextResponse.json({ error: 'INVALID_EMAIL' }, { status: 400 })

  const found = await supabase.rpc('admin_find_user_by_email', { p_email: email })
  if (found.error) return NextResponse.json({ error: found.error.message }, { status: 400 })
  let target = (found.data as { id: string; display_name: string | null; role: string } | null)
  let invited = false
  if (!target) {
    const admin = createSupabaseAdminClient()
    const { data, error } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo: `${req.nextUrl.origin}/login` })
    if (error || !data.user) return NextResponse.json({ error: 'INVITE_FAILED', detail: error?.message ?? null }, { status: 400 })
    target = { id: data.user.id, display_name: null, role: 'MEMBER' }
    invited = true
  }
  if (target.role !== 'SYSTEM_ADMIN') {
    const r = await supabase.rpc('admin_set_user_role', { p_user: target.id, p_role: 'SYSTEM_ADMIN', p_reason: `Thêm admin bằng email ${email}` })
    if (r.error) return NextResponse.json({ error: r.error.message }, { status: 400 })
  }
  return NextResponse.json({ ok: true, invited, already: target.role === 'SYSTEM_ADMIN', name: target.display_name })
}
