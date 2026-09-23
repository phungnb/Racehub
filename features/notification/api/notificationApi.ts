// Thông báo trong app (chuông) và mức thông báo theo CLB.
import { supabase } from '@/shared/lib/supabase'

export type NotificationLevel = 'ALL' | 'IMPORTANT' | 'NONE'

export interface AppNotification {
  id: string
  club_id: string | null
  actor_id: string | null
  kind: string
  title: string
  body: string | null
  link: string | null
  created_at: string
  read_at: string | null
  actor: { id: string; display_name: string | null; avatar_url: string | null } | null
}

type Row = Omit<AppNotification, 'actor'> & { actor: AppNotification['actor'] | AppNotification['actor'][] }

export async function listNotifications(limit = 50): Promise<AppNotification[]> {
  const { data, error } = await supabase.from('notifications')
    .select('id, club_id, actor_id, kind, title, body, link, created_at, read_at, actor:profiles!notifications_actor_id_fkey ( id, display_name, avatar_url )')
    .order('created_at', { ascending: false }).limit(limit)
  if (error) throw error
  return ((data ?? []) as unknown as Row[]).map((r) => ({ ...r, actor: Array.isArray(r.actor) ? r.actor[0] ?? null : r.actor }))
}

export async function countUnread(): Promise<number> {
  const { count, error } = await supabase.from('notifications').select('id', { count: 'exact', head: true }).is('read_at', null)
  if (error) throw error
  return count ?? 0
}

export async function markNotificationsRead(ids?: string[]) {
  const { error } = await supabase.rpc('mark_notifications_read', { p_ids: ids ?? null })
  if (error) throw error
}

export async function getClubNotificationLevel(clubId: string): Promise<NotificationLevel> {
  const { data, error } = await supabase.from('notification_settings').select('level').eq('club_id', clubId).maybeSingle()
  if (error) throw error
  return (data?.level as NotificationLevel | undefined) ?? 'ALL'
}

export async function setClubNotificationLevel(clubId: string, level: NotificationLevel) {
  const { error } = await supabase.rpc('set_club_notification_level', { p_club_id: clubId, p_level: level })
  if (error) throw error
}
