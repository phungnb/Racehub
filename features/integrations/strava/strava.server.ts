import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { serverEnv } from '@/shared/config/env.server'
import { analyzeRun, compactStreams, isGpsJumpFlag, speedRulesFrom, stravaStreams, type FraudResult, type FraudStreams, type SpeedRules } from '@/features/activity/server'
import { toOps } from '@/shared/lib/ops'
import { mapStravaActivity, mapStravaDetail, summarize, syncWindowStart, tokenNeedsRefresh, type StravaSummaryActivity, type SyncSummary } from './mapping'

export const STRAVA_SCOPES = 'read,activity:read_all'
export const STRAVA_CALLBACK_PATH = '/api/strava/callback'

export interface StravaTokenResponse {
  access_token: string
  refresh_token: string
  expires_at: number
  scope?: string
  athlete?: StravaAthlete
}

/** Hồ sơ VĐV Strava (phần dùng để người dùng / admin nhận ra tài khoản đã nối) */
export interface StravaAthlete { id: number; username?: string | null; firstname?: string; lastname?: string; profile?: string | null; profile_medium?: string | null }

/** {name, username, avatar_url} lưu vào connected_accounts (migration 015200). Ảnh mặc định của Strava ("avatar/athlete/...") bỏ qua */
export function stravaIdentity(a: StravaAthlete | undefined | null) {
  if (!a) return null
  const photo = a.profile_medium || a.profile || ''
  return {
    name: [a.firstname, a.lastname].filter(Boolean).join(' ').trim().slice(0, 80) || null,
    username: a.username || null,
    avatar_url: /^https:\/\//.test(photo) ? photo : null,
  }
}

export function buildStravaAuthorizeUrl(origin: string, state: string) {
  const url = new URL('https://www.strava.com/oauth/authorize')
  url.searchParams.set('client_id', serverEnv.stravaClientIdRequired)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('redirect_uri', `${origin}${STRAVA_CALLBACK_PATH}`)
  // 'force': luôn hiện màn hình cấp quyền để người dùng thấy và đổi đúng tài khoản Strava (không tự duyệt bằng phiên cũ)
  url.searchParams.set('approval_prompt', 'force')
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

const RUN_SPORTS = new Set(['Run', 'TrailRun', 'VirtualRun'])
/** Chỉ phân tích sâu bài mới (tránh tốn hạn mức API Strava khi đồng bộ lại lịch sử) */
const FRAUD_RECENT_MS = 3 * 86_400_000
const STREAM_KEYS = 'time,distance,latlng,heartrate,cadence'

/**
 * Chấm điểm gian lận một bài chạy trước khi nhập (migration 002300): tải streams + pace các bài gần đây của người chạy.
 * Lỗi mạng / hết hạn mức → trả null, máy chủ CSDL vẫn áp luật cơ bản (không chặn việc nhập bài).
 */
let rulesCache: { at: number; rules: SpeedRules } | null = null
/** Ngưỡng tốc độ admin đặt (ops_policy.antiCheat) — nhớ 5 phút; lỗi → mặc định */
async function speedRules(admin: SupabaseClient): Promise<SpeedRules> {
  if (rulesCache && Date.now() - rulesCache.at < 5 * 60_000) return rulesCache.rules
  const { data, error } = await admin.rpc('ops_policy')
  const rules = speedRulesFrom(error ? null : toOps(data).antiCheat)
  rulesCache = { at: Date.now(), rules }
  return rules
}

interface Assessed { result: FraudResult; streams: FraudStreams | null; rules: SpeedRules; historyN: number }

async function assessRisk(admin: SupabaseClient, userId: string, token: string, a: StravaSummaryActivity): Promise<Assessed | null> {
  const n = mapStravaActivity(a)
  if (!RUN_SPORTS.has(n.sport_type) || n.distance_m < 200) return null
  const rules = await speedRules(admin)
  // Lần 7: hasGps = có tuyến (polyline); không có GPS hoàn toàn → chạy máy (ghi nhận + cảnh báo). Nhập tay → không ghi nhận.
  const summary = { sportType: n.sport_type, manual: n.manual, trainer: a.trainer === true, deviceName: n.device_name,
    distanceM: n.distance_m, movingS: n.moving_s, maxSpeedMps: n.max_speed_mps, hasGps: n.has_gps }
  if (n.manual || Date.now() - Date.parse(n.started_at) > FRAUD_RECENT_MS) return { result: analyzeRun(summary, null, [], rules), streams: null, rules, historyN: 0 }
  try {
    // Bài đã nhập (đồng bộ lại / webhook đổi tên) → không tải streams lần nữa
    const { data: existing } = await admin.from('activities').select('id').eq('source', 'STRAVA').eq('source_activity_id', String(a.id)).limit(1)
    if (existing?.length) return null
    const [raw, hist] = await Promise.all([
      stravaGet<Record<string, { data?: unknown[] }>>(token, `/activities/${a.id}/streams?keys=${STREAM_KEYS}&key_by_type=true`),
      admin.from('activities').select('moving_time_s, distance_m').eq('user_id', userId).eq('validation_status', 'APPROVED')
        .gte('distance_m', 2000).order('started_at', { ascending: false }).limit(30),
    ])
    const history = ((hist.data ?? []) as { moving_time_s: number; distance_m: number }[])
      .map((h) => h.moving_time_s / (h.distance_m / 1000))
    const streams = stravaStreams(raw)
    // Bản tóm tắt thiếu polyline (ẩn bản đồ) nhưng streams có latlng → vẫn là bài có GPS
    const withGps = { ...summary, hasGps: n.has_gps || !!streams?.latlng?.some((p) => Array.isArray(p) && p.length === 2) }
    return { result: analyzeRun(withGps, streams, history, rules), streams, rules, historyN: history.length }
  } catch (e) {
    console.warn('[strava] fraud streams', (e as Error).message)
    return { result: analyzeRun(summary, null, [], rules), streams: null, rules, historyN: 0 }
  }
}

async function ingest(admin: SupabaseClient, userId: string, a: StravaSummaryActivity, detailed = false, token?: string) {
  const assessed = token ? await assessRisk(admin, userId, token, a) : null
  const risk = assessed?.result ?? null
  const { data, error } = await admin.rpc('ingest_provider_activity', {
    p_user_id: userId, p_source: 'STRAVA', p_external_id: String(a.id),
    p_activity: { ...mapStravaActivity(a), ...(risk && assessed ? {
      risk: { verdict: risk.verdict, score: risk.score, level: risk.level, reason: risk.reason,
        // gpsJump: dấu hiệu chỉ do GPS nhảy (lần 7) — danh sách "Bài có cảnh báo" của ban quản trị hiển thị riêng
        flags: risk.flags.map((f) => ({ code: f.code, severity: f.severity, tier: f.tier ?? null, message: f.message, atS: f.atS ?? null, durationS: f.durationS ?? null,
          gpsJump: isGpsJumpFlag(f) || null })) },
      // Lưu vết: kết quả đầy đủ + đầu vào; dữ liệu gốc (rút gọn) chỉ giữ khi bài có dấu hiệu, để xét lại / chỉnh luật sau này
      analysis: {
        engine: risk.engine, verdict: risk.verdict, basis: risk.basis, score: risk.score, level: risk.level,
        independent: risk.independent, clean_distance_m: risk.cleanDistanceM, flags: risk.flags,
        inputs: { distance_m: a.distance ?? null, moving_s: a.moving_time ?? null, max_speed_mps: a.max_speed ?? null,
          stream_points: assessed.streams?.time.length ?? 0, history_runs: assessed.historyN, rules: assessed.rules },
        streams: assessed.streams && risk.flags.length ? compactStreams(assessed.streams) : null,
      } } : {}) },
  })
  if (error) throw new Error(`INGEST_FAILED:${error.message}`)
  const r = data as Record<string, unknown>
  if (r.result === 'IMPORTED' || r.result === 'UPDATED' || r.result === 'DUPLICATE') await saveDetail(admin, a, detailed)
  return r
}

/** Lưu tuyến chạy / từng km (migration 001900). Lỗi ở đây không được làm hỏng việc nhập bài. */
async function saveDetail(admin: SupabaseClient, a: StravaSummaryActivity, detailed: boolean) {
  const detail = mapStravaDetail(a, detailed)
  if (!detail) return
  const { error } = await admin.rpc('save_activity_detail', { p_source: 'STRAVA', p_external_id: String(a.id), p_detail: detail })
  if (error) console.warn('[strava] save_activity_detail', error.message)
}

/**
 * Lấy bản chi tiết một bài (polyline đầy đủ + từng km) khi chủ bài mở màn chi tiết lần đầu.
 * Đã có bản chi tiết thì không gọi lại Strava (giữ hạn mức API).
 */
export async function enrichStravaActivity(admin: SupabaseClient, userId: string, activityId: string): Promise<'OK' | 'SKIPPED' | 'NOT_FOUND'> {
  const { data } = await admin.rpc('activity_source_ref', { p_activity_id: activityId })
  const ref = data as { user_id: string; source: string; external_id: string | null; detailed: boolean; fetched_at: string | null } | null
  if (!ref || ref.user_id !== userId || ref.source !== 'STRAVA' || !ref.external_id) return 'NOT_FOUND'
  if (ref.detailed) return 'SKIPPED'
  const { token } = await getValidStravaToken(admin, userId)
  const a = await stravaGet<StravaSummaryActivity>(token, `/activities/${ref.external_id}`)
  await saveDetail(admin, a, true)
  return 'OK'
}

/**
 * Bổ sung tên + ảnh Strava cho kết nối cũ (nối trước migration 015200) hoặc làm mới khi `force`.
 * Trả null nếu chưa có migration / Strava lỗi — không bao giờ làm hỏng việc đồng bộ.
 */
export async function refreshStravaIdentity(admin: SupabaseClient, userId: string, opts: { token?: string; force?: boolean } = {}) {
  try {
    const { data: row, error } = await admin.from('connected_accounts').select('identity_synced_at')
      .eq('user_id', userId).eq('provider', 'STRAVA').maybeSingle<{ identity_synced_at: string | null }>()
    if (error || !row) return null
    if (row.identity_synced_at && !opts.force) return null
    const token = opts.token ?? (await getValidStravaToken(admin, userId)).token
    const identity = stravaIdentity(await stravaGet<StravaAthlete>(token, '/athlete'))
    if (!identity) return null
    const { error: e2 } = await admin.rpc('set_provider_identity', { p_user_id: userId, p_provider: 'STRAVA', p_identity: identity })
    return e2 ? null : identity
  } catch {
    return null
  }
}

/** Đồng bộ các bài chạy mới của một người (tối đa 30 ngày, 3 trang × 100 bài). */
export async function syncStravaActivities(admin: SupabaseClient, userId: string): Promise<SyncSummary> {
  const { token, conn } = await getValidStravaToken(admin, userId)
  const after = Math.floor(syncWindowStart(conn.last_synced_at).getTime() / 1000)
  await refreshStravaIdentity(admin, userId, { token })
  const results: Record<string, unknown>[] = []
  for (let page = 1; page <= 3; page++) {
    const list = await stravaGet<StravaSummaryActivity[]>(token, `/athlete/activities?after=${after}&per_page=100&page=${page}`)
    // Xử lý từ cũ đến mới để trần thưởng/ngày và thứ tự thử thách đúng thời gian
    for (const a of [...list].reverse()) results.push(await ingest(admin, userId, a, false, token))
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
  return ingest(admin, conn.user_id, activity, true, token)
}
