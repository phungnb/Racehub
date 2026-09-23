import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/shared/lib/supabase-server'
import { routes } from '@/shared/config/routes'

// Trang gốc: chuyển tới Trang chủ hoặc Đăng nhập.
// Hỗ trợ link cũ dạng /?tab=profile&strava_success=true và /?tab=club&clubId=...
export default async function RootPage({ searchParams }: PageProps<'/'>) {
  const params = await searchParams
  const tab = typeof params.tab === 'string' ? params.tab : null
  const passthrough = new URLSearchParams()
  for (const key of ['strava_success', 'strava_error', 'clubId']) {
    const v = params[key]
    if (typeof v === 'string') passthrough.set(key, v)
  }
  const qs = passthrough.toString() ? `?${passthrough}` : ''

  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect(routes.login)

  if (tab === 'profile') redirect(`${routes.me}${qs}`)
  if (tab === 'club') redirect(`${routes.clubs}${qs}`)
  redirect(routes.home)
}
