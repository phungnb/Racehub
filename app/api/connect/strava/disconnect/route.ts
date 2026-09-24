import { NextResponse } from 'next/server'
import { createSupabaseAdminClient, createSupabaseServerClient } from '@/shared/lib/supabase-server'
import { deauthorizeStrava } from '@/features/integrations/server'

export async function POST() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'AUTH_REQUIRED' }, { status: 401 })

  const admin = createSupabaseAdminClient()
  const { data: accessToken, error } = await admin.rpc('unlink_provider_connection', {
    p_user_id: user.id,
    p_provider: 'STRAVA',
  })
  if (error) {
    console.error('[strava/disconnect]', error.message)
    return NextResponse.json({ error: 'SERVER_ERROR' }, { status: 500 })
  }
  if (typeof accessToken === 'string' && accessToken) await deauthorizeStrava(accessToken)
  return NextResponse.json({ ok: true })
}
