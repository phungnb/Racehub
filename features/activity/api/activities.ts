import { supabase } from '@/shared/lib/supabase'
import { normalizeActivity, type ActivitySummary } from '../model/activity'

export type { ActivitySummary }

export async function listMyRecentActivities(userId: string, limit = 10): Promise<ActivitySummary[]> {
  const { data, error } = await supabase
    .from('activities')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return (data ?? []).map(normalizeActivity)
}
