import 'server-only'
import { serverEnv } from '@/shared/config/env.server'

export const STRAVA_SCOPES = 'read,activity:read_all'
export const STRAVA_CALLBACK_PATH = '/api/strava/callback'

export interface StravaTokenResponse {
  access_token: string
  refresh_token: string
  expires_at: number
  scope?: string
  athlete?: { id: number; firstname?: string; lastname?: string }
}

export function buildStravaAuthorizeUrl(origin: string, state: string) {
  const url = new URL('https://www.strava.com/oauth/authorize')
  url.searchParams.set('client_id', serverEnv.stravaClientIdRequired)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('redirect_uri', `${origin}${STRAVA_CALLBACK_PATH}`)
  url.searchParams.set('approval_prompt', 'auto')
  url.searchParams.set('scope', STRAVA_SCOPES)
  url.searchParams.set('state', state)
  return url.toString()
}

export async function exchangeStravaCode(code: string): Promise<StravaTokenResponse> {
  const res = await fetch('https://www.strava.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: serverEnv.stravaClientIdRequired,
      client_secret: serverEnv.stravaClientSecret,
      code,
      grant_type: 'authorization_code',
    }),
    cache: 'no-store',
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || !data?.access_token) {
    throw new Error(`STRAVA_TOKEN_EXCHANGE_FAILED:${res.status}`)
  }
  return data as StravaTokenResponse
}

export async function deauthorizeStrava(accessToken: string) {
  // Lỗi ở đây không chặn việc ngắt kết nối phía RaceHub.
  await fetch('https://www.strava.com/oauth/deauthorize', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: 'no-store',
  }).catch(() => undefined)
}
