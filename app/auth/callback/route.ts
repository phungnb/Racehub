import { NextResponse, type NextRequest } from 'next/server'
import { createSupabaseServerClient } from '@/shared/lib/supabase-server'
import { getPublicOrigin } from '@/shared/lib/request-url'
import { safeNext } from '@/shared/config/routes'

// Đăng nhập Google / Apple quay về đây với ?code=… (PKCE): đổi mã lấy phiên, ghi cookie, rồi tới trang cần đến.
// Mã xác minh PKCE nằm trong cookie do trình duyệt (hoặc WebView của app) tạo lúc bấm nút đăng nhập.
export async function GET(request: NextRequest) {
  const origin = getPublicOrigin(request)
  const url = request.nextUrl
  const next = safeNext(url.searchParams.get('next'))
  const fail = (reason: string) => NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(reason)}&next=${encodeURIComponent(next)}`)

  const oauthError = url.searchParams.get('error_description') ?? url.searchParams.get('error')
  if (oauthError) return fail(/denied|cancel/i.test(oauthError) ? 'cancelled' : 'oauth')
  const code = url.searchParams.get('code')
  if (!code) return fail('oauth')

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.auth.exchangeCodeForSession(code)
  if (error) return fail(/verifier/i.test(error.message) ? 'verifier' : 'oauth')
  return NextResponse.redirect(`${origin}${next}`)
}
