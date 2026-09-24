import { supabase } from '@/shared/lib/supabase'

export async function completeOnboarding(): Promise<string> {
  const { data, error } = await supabase.rpc('complete_onboarding')
  if (error) throw error
  return data as string
}
