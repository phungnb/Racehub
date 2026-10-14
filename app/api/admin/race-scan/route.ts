import { NextResponse, type NextRequest } from 'next/server'
import { createSupabaseAdminClient, createSupabaseServerClient } from '@/shared/lib/supabase-server'
import { scanSource } from '@/shared/lib/race-scan-run'

// Race → Hàng chờ duyệt → "Quét ngay": quét một nguồn do admin chọn, kết quả vào hàng chờ (không tự đăng).
export const maxDuration = 60
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'AUTH_REQUIRED' }, { status: 401 })
  const { data: isAdmin } = await supabase.rpc('is_system_admin')
  if (!isAdmin) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
  const body = (await req.json().catch(() => ({}))) as { source_id?: string }
  if (!body.source_id || !/^[0-9a-f-]{36}$/i.test(body.source_id)) return NextResponse.json({ error: 'BAD_REQUEST' }, { status: 400 })
  // Đọc nguồn bằng phiên của admin (RLS) rồi mới quét bằng khóa máy chủ
  const { data: src } = await supabase.from('race_sources').select('id,url').eq('id', body.source_id).maybeSingle()
  if (!src) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
  const result = await scanSource(createSupabaseAdminClient(), src, Date.now() + 50_000)
  return NextResponse.json({ ok: true, result })
}
