// Tài khoản Strava đang liên kết (migration 015200): tên, username, ảnh, athlete id. Không lộ token.
import { supabase } from '@/shared/lib/supabase'

export interface StravaAccount {
  athlete_id: string
  name: string | null
  username: string | null
  avatar_url: string | null
  connected_at: string | null
  last_synced_at: string | null
}

interface ConnectionRow {
  provider: string; provider_user_id: string; connected_at: string | null; last_synced_at: string | null
  external_name?: string | null; external_username?: string | null; external_avatar_url?: string | null
}

export async function myStravaAccount(): Promise<StravaAccount | null> {
  const { data, error } = await supabase.rpc('my_provider_connections')
  if (error) throw error
  const r = ((data ?? []) as ConnectionRow[]).find((c) => c.provider === 'STRAVA')
  if (!r) return null
  return {
    athlete_id: r.provider_user_id, name: r.external_name ?? null, username: r.external_username ?? null,
    avatar_url: r.external_avatar_url ?? null, connected_at: r.connected_at, last_synced_at: r.last_synced_at,
  }
}

/** Kết nối cũ chưa có tên / ảnh → nhờ server lấy từ Strava rồi lưu lại */
export async function refreshStravaAccount(): Promise<boolean> {
  const res = await fetch('/api/strava/account', { method: 'POST' })
  const body = await res.json().catch(() => ({}))
  return res.ok && Boolean(body?.ok)
}

export const stravaProfileUrl = (athleteId: string) => `https://www.strava.com/athletes/${encodeURIComponent(athleteId)}`
