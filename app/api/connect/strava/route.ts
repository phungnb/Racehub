import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/shared/lib/supabase-server'
import { createOAuthState, OAUTH_NONCE_COOKIE, OAUTH_RETURN_COOKIE } from '@/shared/lib/oauth-state'
import { getPublicOrigin } from '@/shared/lib/request-url'
import { serverEnv } from '@/shared/config/env.server'
import { buildStravaAuthorizeUrl } from '@/features/integrations/server'
import { safeNext } from '@/shared/config/routes'

// Bắt đầu kết nối Strava. Người dùng được xác định từ phiên đăng nhập (cookie),
// KHÔNG từ tham số URL.
export async function GET(request: Request) {
  const origin = getPublicOrigin(request)
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.redirect(new URL('/?strava_error=auth_required', origin))
  }

  const { state, nonce, maxAge } = createOAuthState(user.id, 'STRAVA', serverEnv.oauthStateSecret)
  const response = NextResponse.redirect(buildStravaAuthorizeUrl(origin, state))
  response.cookies.set(OAUTH_NONCE_COOKIE, nonce, {
    httpOnly: true,
    secure: origin.startsWith('https'),
    sameSite: 'lax',
    path: '/api/strava',
    maxAge,
  })
  // ?next=/welcome?step=club → kết nối xong quay lại đúng bước onboarding (chỉ nhận đường dẫn nội bộ)
  const next = new URL(request.url).searchParams.get('next')
  if (next) {
    response.cookies.set(OAUTH_RETURN_COOKIE, safeNext(next, '/me'), {
      httpOnly: true, secure: origin.startsWith('https'), sameSite: 'lax', path: '/api/strava', maxAge,
    })
  }
  return response
}
