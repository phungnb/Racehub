import { supabase } from '@/shared/lib/supabase'
import { normalizeActivity, type ActivitySummary } from '../model/activity'

export type { ActivitySummary }

export async function listMyRecentActivities(userId: string, limit = 10): Promise<ActivitySummary[]> {
  const { data, error } = await supabase
    .from('activities')
    .select('*')
    .eq('user_id', userId)
    .neq('status', 'DELETED')
    .order('started_at', { ascending: false, nullsFirst: false })
    .limit(limit)
  if (error) throw error
  return (data ?? []).map(normalizeActivity)
}
