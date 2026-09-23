import { NextResponse, after } from 'next/server'
import { cookies } from 'next/headers'
import { createSupabaseAdminClient, createSupabaseServerClient } from '@/shared/lib/supabase-server'
import { OAUTH_NONCE_COOKIE, verifyOAuthState } from '@/shared/lib/oauth-state'
import { getPublicOrigin } from '@/shared/lib/request-url'
import { serverEnv } from '@/shared/config/env.server'
import { exchangeStravaCode, syncStravaActivities } from '@/features/integrations/server'

function back(origin: string, params: Record<string, string>) {
  const url = new URL('/me', origin)
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v))
  const res = NextResponse.redirect(url)
  res.cookies.set(OAUTH_NONCE_COOKIE, '', { path: '/api/strava', maxAge: 0 })
  return res
}

export async function GET(request: Request) {
  const origin = getPublicOrigin(request)
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')

  if (url.searchParams.get('error') || !code || !state) {
    return back(origin, { strava_error: 'access_denied' })
  }

  // 1. Kiểm tra state: chữ ký, hạn dùng, nonce khớp cookie của trình duyệt này
  const cookieStore = await cookies()
  const check = verifyOAuthState(state, cookieStore.get(OAUTH_NONCE_COOKIE)?.value, 'STRAVA', serverEnv.oauthStateSecret)
  if (!check.ok) {
    console.warn('[strava/callback] state không hợp lệ:', check.reason)
    return back(origin, { strava_error: 'invalid_state' })
  }

  // 2. Người đang đăng nhập phải là người đã bắt đầu luồng
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || user.id !== check.payload.uid) {
    return back(origin, { strava_error: 'invalid_state' })
  }

  try {
    // 3. Đổi code lấy token (secret chỉ nằm ở server)
    const token = await exchangeStravaCode(code)
    const athleteId = String(token.athlete?.id ?? '')
    if (!athleteId) throw new Error('STRAVA_NO_ATHLETE')

    // 4. Lưu token vào schema private qua RPC chỉ service role gọi được
    const admin = createSupabaseAdminClient()
    const { error } = await admin.rpc('link_provider_connection', {
      p_user_id: user.id,
      p_provider: 'STRAVA',
      p_external_user_id: athleteId,
      p_access_token: token.access_token,
      p_refresh_token: token.refresh_token,
      p_expires_at: new Date(token.expires_at * 1000).toISOString(),
      p_scopes: (token.scope ?? '').split(',').filter(Boolean),
    })
    if (error) {
      if (error.message.includes('PROVIDER_ACCOUNT_CONFLICT')) {
        return back(origin, { strava_error: 'account_conflict' })
      }
      console.error('[strava/callback] link_provider_connection:', error.message)
      return back(origin, { strava_error: 'server_error' })
    }
    // Kéo luôn bài chạy 30 ngày gần nhất (chạy sau khi đã chuyển hướng người dùng)
    after(async () => {
      try {
        const summary = await syncStravaActivities(admin, user.id)
        console.info('[strava/callback] backfill', JSON.stringify(summary))
      } catch (err) {
        console.error('[strava/callback] backfill', err instanceof Error ? err.message : err)
      }
    })
    return back(origin, { strava_success: 'true' })
  } catch (err) {
    console.error('[strava/callback]', err instanceof Error ? err.message : err)
    return back(origin, { strava_error: 'server_error' })
  }
}
