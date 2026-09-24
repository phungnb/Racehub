import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { serverEnv } from '@/shared/config/env.server'
import { mapStravaActivity, summarize, syncWindowStart, tokenNeedsRefresh, type StravaSummaryActivity, type SyncSummary } from './mapping'

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

// ---------------------------------------------------------------------
// Đồng bộ bài chạy
// ---------------------------------------------------------------------

const STRAVA_API = 'https://www.strava.com/api/v3'

interface ConnectionRow {
  user_id: string
  provider_user_id: string
  access_token: string | null
  refresh_token: string | null
  expires_at: string | null
  last_synced_at: string | null
}

/** Lấy access token còn hạn; tự làm mới và lưu lại nếu sắp hết hạn. */
export async function getValidStravaToken(admin: SupabaseClient, userId: string): Promise<{ token: string; conn: ConnectionRow }> {
  const { data: conn, error } = await admin
    .from('connected_accounts')
    .select('user_id, provider_user_id, access_token, refresh_token, expires_at, last_synced_at')
    .eq('user_id', userId).eq('provider', 'STRAVA').maybeSingle<ConnectionRow>()
  if (error) throw new Error(`STRAVA_CONNECTION_READ_FAILED:${error.message}`)
  if (!conn) throw new Error('STRAVA_NOT_CONNECTED')
  if (conn.access_token && !tokenNeedsRefresh(conn.expires_at)) return { token: conn.access_token, conn }
  if (!conn.refresh_token) throw new Error('STRAVA_REAUTH_REQUIRED')

  const res = await fetch('https://www.strava.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: serverEnv.stravaClientIdRequired,
      client_secret: serverEnv.stravaClientSecret,
      grant_type: 'refresh_token',
      refresh_token: conn.refresh_token,
    }),
    cache: 'no-store',
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || !data?.access_token) throw new Error(res.status === 400 || res.status === 401 ? 'STRAVA_REAUTH_REQUIRED' : `STRAVA_REFRESH_FAILED:${res.status}`)

  const expiresAt = new Date(data.expires_at * 1000).toISOString()
  await admin.from('connected_accounts')
    .update({ access_token: data.access_token, refresh_token: data.refresh_token, expires_at: expiresAt })
    .eq('user_id', userId).eq('provider', 'STRAVA')
  return { token: data.access_token, conn: { ...conn, access_token: data.access_token, expires_at: expiresAt } }
}

async function stravaGet<T>(token: string, path: string): Promise<T> {
  const res = await fetch(`${STRAVA_API}${path}`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' })
  if (res.status === 429) throw new Error('STRAVA_RATE_LIMITED')
  if (res.status === 401) throw new Error('STRAVA_REAUTH_REQUIRED')
  if (!res.ok) throw new Error(`STRAVA_API_${res.status}`)
  return res.json() as Promise<T>
}

async function ingest(admin: SupabaseClient, userId: string, a: StravaSummaryActivity) {
  const { data, error } = await admin.rpc('ingest_provider_activity', {
    p_user_id: userId, p_source: 'STRAVA', p_external_id: String(a.id), p_activity: mapStravaActivity(a),
  })
  if (error) throw new Error(`INGEST_FAILED:${error.message}`)
  return data as Record<string, unknown>
}

/** Đồng bộ các bài chạy mới của một người (tối đa 30 ngày, 3 trang × 100 bài). */
export async function syncStravaActivities(admin: SupabaseClient, userId: string): Promise<SyncSummary> {
  const { token, conn } = await getValidStravaToken(admin, userId)
  const after = Math.floor(syncWindowStart(conn.last_synced_at).getTime() / 1000)
  const results: Record<string, unknown>[] = []
  for (let page = 1; page <= 3; page++) {
    const list = await stravaGet<StravaSummaryActivity[]>(token, `/athlete/activities?after=${after}&per_page=100&page=${page}`)
    // Xử lý từ cũ đến mới để trần thưởng/ngày và thứ tự thử thách đúng thời gian
    for (const a of [...list].reverse()) results.push(await ingest(admin, userId, a))
    if (list.length < 100) break
  }
  await admin.from('connected_accounts').update({ last_synced_at: new Date().toISOString() })
    .eq('user_id', userId).eq('provider', 'STRAVA')
  return summarize(results)
}

/** Xử lý một sự kiện webhook của Strava. */
export async function handleStravaWebhookEvent(admin: SupabaseClient, event: {
  object_type: string; aspect_type: string; object_id: number; owner_id: number; updates?: Record<string, string>
}) {
  const { data: conn } = await admin.from('connected_accounts').select('user_id')
    .eq('provider', 'STRAVA').eq('provider_user_id', String(event.owner_id)).maybeSingle<{ user_id: string }>()
  if (!conn) return { result: 'UNKNOWN_ATHLETE' }

  if (event.object_type === 'athlete' && event.updates?.authorized === 'false') {
    await admin.rpc('unlink_provider_connection', { p_user_id: conn.user_id, p_provider: 'STRAVA' })
    return { result: 'DEAUTHORIZED' }
  }
  if (event.object_type !== 'activity') return { result: 'IGNORED' }
  if (event.aspect_type === 'delete') {
    const { data } = await admin.rpc('remove_provider_activity', { p_source: 'STRAVA', p_external_id: String(event.object_id) })
    return data
  }
  const { token } = await getValidStravaToken(admin, conn.user_id)
  const activity = await stravaGet<StravaSummaryActivity>(token, `/activities/${event.object_id}`)
  return ingest(admin, conn.user_id, activity)
}
